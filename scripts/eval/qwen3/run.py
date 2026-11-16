#!/usr/bin/env python
"""Qwen3-ASR-0.6B ONNX feasibility spike: transcribe one media file on CPU.

This is an OFFLINE measurement tool, not part of the site. It proves whether the
third-party browser export (jiangzhuo9357/Qwen3-ASR-0.6B-ONNX, layout v2) can be
driven by plain onnxruntime in Python and what its text looks like on our clips.

What it does, exactly as the export's README/prompt_config.json prescribe:
  1. decode the file to 16 kHz mono float32 with PyAV;
  2. cut it into 30 s chunks (no overlap: boundary words can be lost, which is
     reported, not hidden);
  3. Whisper-compatible log-mel: 16 kHz, n_fft 400, hop 160, periodic Hann,
     centred with reflect padding, power spectrum, 128-bin Slaney filterbank,
     log10 floor 1e-10, clamp to max-8, (x+4)/4, drop the last frame;
  4. prompt = prefix_ids + A audio-pad ids + suffix_ids (+ language prefix),
     A = conv3(T % 100) + 13 * floor(T / 100), conv(t) = floor((t + 1) / 2);
  5. encoder(mel) -> audio features, embedded into the int8 embedding table;
  6. greedy decode with decoder_init / decoder_step until <|endoftext|>/<|im_end|>.

No timestamps come out of the model. If --json-out is given, every word is
written with startMs=endMs=0 so the project's gold scorer can still measure WER
(it only uses text for that); timing must not be read from that file.

Usage:
  python scripts/eval/qwen3/run.py --model-dir <dir> media.mp4 [more.mp4] \
      [--lang hi|auto|<iso>] [--chunk-seconds 30] [--json-out hyp.json]

Paths inside argv are normalised for Windows, so C:/... works from any shell.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import av
import numpy as np
import onnxruntime as ort
import tokenizers

SAMPLE_RATE = 16_000
N_FFT = 400
HOP = 160
N_MELS = 128


def load_audio(path: str) -> np.ndarray:
    """Decode any container PyAV understands to mono float32 at 16 kHz."""
    resampler = av.AudioResampler(format="flt", layout="mono", rate=SAMPLE_RATE)
    pieces: list[np.ndarray] = []
    with av.open(path) as container:
        if not container.streams.audio:
            raise SystemExit(f"no audio stream in {path}")
        stream = container.streams.audio[0]
        for frame in container.decode(stream):
            for out in resampler.resample(frame):
                pieces.append(out.to_ndarray().reshape(-1))
        for out in resampler.resample(None):
            pieces.append(out.to_ndarray().reshape(-1))
    if not pieces:
        raise SystemExit(f"decoded no audio from {path}")
    audio = np.concatenate(pieces).astype(np.float32)
    return audio


def log_mel(audio: np.ndarray, filters: np.ndarray) -> np.ndarray:
    """Whisper-compatible log-mel spectrogram, shape [128, T] (last frame dropped)."""
    # torch.stft(center=True, pad_mode="reflect") pads n_fft // 2 on both sides.
    pad = N_FFT // 2
    if audio.size <= pad:
        audio = np.pad(audio, (0, pad + 1 - audio.size))
    padded = np.pad(audio, (pad, pad), mode="reflect")
    frames = np.lib.stride_tricks.sliding_window_view(padded, N_FFT)[::HOP]
    window = np.hanning(N_FFT + 1)[:-1].astype(np.float32)  # periodic Hann
    spectrum = np.fft.rfft(frames * window, n=N_FFT, axis=1)
    power = (spectrum.real**2 + spectrum.imag**2).astype(np.float32)
    mel = power @ filters.T  # [T, 128]
    log_spec = np.log10(np.maximum(mel, 1e-10))
    log_spec = np.maximum(log_spec, log_spec.max() - 8.0)
    log_spec = (log_spec + 4.0) / 4.0
    return np.ascontiguousarray(log_spec[:-1].T, dtype=np.float32)


def audio_tokens(frames: int) -> int:
    def conv(t: int) -> int:
        return (t + 1) // 2

    return conv(conv(conv(frames % 100))) + 13 * (frames // 100)


class QwenAsr:
    """The three exported graphs plus the shared int8 embedding table."""

    def __init__(self, model_dir: str) -> None:
        model = Path(model_dir)
        cfg = json.loads((model / "prompt_config.json").read_text(encoding="utf-8"))
        variant = cfg["variants"]["q4"]
        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        so.intra_op_num_threads = max(1, min(8, os.cpu_count() or 1))
        t0 = time.perf_counter()
        self.encoder = ort.InferenceSession(str(model / variant["encoder"]), so, providers=["CPUExecutionProvider"])
        self.init = ort.InferenceSession(str(model / variant["decoder_init"]), so, providers=["CPUExecutionProvider"])
        self.step = ort.InferenceSession(str(model / variant["decoder_step"]), so, providers=["CPUExecutionProvider"])
        self.load_seconds = time.perf_counter() - t0

        embedding = cfg["embedding"]
        rows, width = embedding["shape"]
        self.embed = np.fromfile(model / embedding["file"], dtype=np.int8).reshape(rows, width)
        self.scales = np.fromfile(model / embedding["scales_file"], dtype=np.float32)
        if self.scales.size != rows:
            raise SystemExit(f"embedding scales: expected {rows}, got {self.scales.size}")

        filters_json = json.loads((model / cfg["mel"]["filters_file"]).read_text(encoding="utf-8"))
        data = filters_json["data"] if isinstance(filters_json, dict) else filters_json
        self.filters = np.asarray(data, dtype=np.float32)
        if self.filters.shape != (N_MELS, N_FFT // 2 + 1):
            raise SystemExit(f"mel filters: expected {(N_MELS, N_FFT // 2 + 1)}, got {self.filters.shape}")

        self.tokenizer = tokenizers.Tokenizer.from_file(str(model / "tokenizer.json"))
        self.prefix = cfg["prompt"]["prefix_ids"]
        self.suffix = cfg["prompt"]["suffix_ids"]
        self.pad_id = cfg["prompt"]["audio_pad_id"]
        self.eos = set(cfg["prompt"]["eos_ids"])
        self.asr_text_id = int(cfg["prompt"]["asr_text_id"])
        self.max_new = int(cfg["prompt"]["max_new_tokens"])
        self.lang_prefix = cfg.get("language_prefix_ids", {})

        self.encoder_in = self.encoder.get_inputs()[0].name
        self.encoder_out = self.encoder.get_outputs()[0].name
        self.init_in = [i.name for i in self.init.get_inputs()]
        self.init_out = [o.name for o in self.init.get_outputs()]
        self.step_in = [i.name for i in self.step.get_inputs()]
        self.step_out = [o.name for o in self.step.get_outputs()]

    def embed_ids(self, ids: list[int]) -> np.ndarray:
        table = self.embed[np.asarray(ids, dtype=np.int64)].astype(np.float32)
        return table * self.scales[np.asarray(ids, dtype=np.int64)][:, None]

    def transcribe_chunk(self, audio: np.ndarray, lang: str | None) -> tuple[str, dict]:
        mel = log_mel(audio, self.filters)
        t_enc = time.perf_counter()
        features = self.encoder.run([self.encoder_out], {self.encoder_in: mel[None, ...]})[0]
        enc_seconds = time.perf_counter() - t_enc

        n_audio = features.shape[1]
        ids = list(self.prefix) + [self.pad_id] * n_audio + list(self.suffix)
        if lang and lang != "auto" and lang in self.lang_prefix:
            ids += list(self.lang_prefix[lang])
        embeds = self.embed_ids(ids)
        pad_start = len(self.prefix)
        if features.shape[0] != 1 or features.shape[2] != embeds.shape[1]:
            raise SystemExit(f"encoder output {features.shape} does not fit embeddings {embeds.shape}")
        embeds[pad_start : pad_start + n_audio] = features[0]

        positions = np.arange(len(ids), dtype=np.int64)[None, :]
        t_dec = time.perf_counter()
        init_names = self.init_in
        init_feeds = {
            init_names[0]: embeds[None, ...],
            init_names[1]: positions,
        }
        init_values = self.init.run(self.init_out, init_feeds)
        init_result = dict(zip(self.init_out, init_values))
        logits = init_result["logits"]
        keys = init_result["present_keys"]
        values = init_result["present_values"]
        produced: list[int] = []
        position = len(ids)
        next_id = int(np.argmax(logits[0, -1]))
        while next_id not in self.eos and len(produced) < self.max_new:
            produced.append(next_id)
            step_embeds = self.embed_ids([next_id])
            step_names = self.step_in
            step_feeds = {
                step_names[0]: step_embeds[None, ...],
                step_names[1]: np.asarray([[position]], dtype=np.int64),
                step_names[2]: keys,
                step_names[3]: values,
            }
            step_values = self.step.run(self.step_out, step_feeds)
            step_result = dict(zip(self.step_out, step_values))
            logits = step_result["logits"]
            keys = step_result["present_keys"]
            values = step_result["present_values"]
            next_id = int(np.argmax(logits[0, -1]))
            position += 1
        dec_seconds = time.perf_counter() - t_dec

        # With language auto-detection the transcript is prefixed by
        # "<|language> <Name> <asr_text>". <asr_text> is an ordinary token, not a
        # special one, so cut the ids there instead of guessing how much text
        # the language name occupies.
        generated = len(produced)
        if self.asr_text_id in produced:
            produced = produced[produced.index(self.asr_text_id) + 1 :]
        text = self.tokenizer.decode(produced, skip_special_tokens=True).strip()
        if text.lower().startswith("language "):
            text = re.sub(r"^language\s+\S+\s*", "", text, count=1)
        stats = {
            "melFrames": int(mel.shape[1]),
            "audioTokens": int(n_audio),
            "encoderSeconds": round(enc_seconds, 3),
            "decodeSeconds": round(dec_seconds, 3),
            "tokens": generated,
            "ids": produced[:80],
        }
        return text.strip(), stats


def main(argv: list[str] | None = None) -> int:
    # Windows consoles default to cp1252; Devanagari output would crash the print.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("media", nargs="+", help="audio/video file(s) to transcribe")
    parser.add_argument("--model-dir", required=True, help="folder with the q4 ONNX files")
    parser.add_argument("--lang", default="hi", help='"hi" (forced), "auto", or another iso code')
    parser.add_argument("--chunk-seconds", type=float, default=30.0)
    parser.add_argument("--max-new-tokens", type=int, default=None, help="override the export's 256-token cap")
    parser.add_argument("--json-out", help="write a gold-scorer hypotheses file (text only, no times)")
    parser.add_argument("--print-ids", action="store_true", help="print the first generated token ids per chunk (debug)")
    parser.add_argument("--clip-id", action="append", default=[], help="clip id for --json-out (one per media, default: file stem)")
    args = parser.parse_args(argv)

    model = QwenAsr(args.model_dir)
    if args.max_new_tokens is not None:
        model.max_new = args.max_new_tokens
    print(f"model loaded in {model.load_seconds:.1f}s; encoder in={model.encoder_in} out={model.encoder_out}", flush=True)
    print(f"decoder_init in={model.init_in} out={model.init_out}", flush=True)
    print(f"decoder_step in={model.step_in} out={model.step_out}", flush=True)

    hyp_clips: dict[str, dict] = {}
    chunk_samples = int(args.chunk_seconds * SAMPLE_RATE)
    for index, media in enumerate(args.media):
        clip_id = args.clip_id[index] if index < len(args.clip_id) else Path(media).stem
        audio = load_audio(media)
        seconds = audio.size / SAMPLE_RATE
        print(f"\n=== {clip_id}: {media} ({seconds:.1f}s)", flush=True)
        words: list[str] = []
        clip_start = time.perf_counter()
        for offset in range(0, audio.size, chunk_samples):
            chunk = audio[offset : offset + chunk_samples]
            if chunk.size < SAMPLE_RATE // 10:
                continue
            t0 = time.perf_counter()
            text, stats = model.transcribe_chunk(chunk, args.lang)
            elapsed = time.perf_counter() - t0
            print(
                f"[chunk {offset / SAMPLE_RATE:6.1f}-{min(offset + chunk.size, audio.size) / SAMPLE_RATE:6.1f}s] "
                f"{elapsed:6.2f}s enc {stats['encoderSeconds']:.2f}s dec {stats['decodeSeconds']:.2f}s "
                f"tokens {stats['tokens']} rtf {elapsed / (chunk.size / SAMPLE_RATE):.3f}",
                flush=True,
            )
            print(text, flush=True)
            if args.print_ids:
                print(f"ids: {stats['ids']}", flush=True)
            words.extend(text.split())
        total = time.perf_counter() - clip_start
        print(f"[clip total {total:.2f}s, audio {seconds:.1f}s, rtf {total / max(seconds, 0.001):.3f}, {len(words)} words]", flush=True)
        hyp_clips[clip_id] = {
            "seconds": round(total, 2),
            "words": [
                {"text": w, "startMs": 0, "endMs": 0, "confidence": 1, "index": i, "windowIndex": 0}
                for i, w in enumerate(words)
            ],
        }

    if args.json_out:
        payload = {
            "model": "qwen3-asr-0.6b-onnx-int4",
            "backend": f"onnxruntime-{ort.__version__}-cpu",
            "device": os.environ.get("COMPUTERNAME", "cpu"),
            "clips": hyp_clips,
        }
        Path(args.json_out).write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"\nwrote {args.json_out}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
