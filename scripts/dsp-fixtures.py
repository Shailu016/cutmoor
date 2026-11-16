#!/usr/bin/env python3
"""Independent oracle fixtures for the TypeScript Whisper log-mel implementation.

This script deliberately does not share code with the TypeScript module. It builds
the same numbers from the published Whisper/librosa definitions using numpy:

  * 30 s of 16 kHz audio,
  * reflect padding by n_fft//2 on both sides (torch.stft center=True),
  * periodic Hann window,
  * exact n_fft-point numpy FFT, power spectrum, final frame dropped,
  * Slaney mel scale, htk=False, norm="slaney", over 0..8000 Hz,
  * log10(clip(x, 1e-10)), clamp to max-8, then (x+4)/4.

The JSON file contains, for each signal, the first five frames for every mel band
(the part most sensitive to framing/windowing mistakes) plus full-matrix min/max/mean.
Signals are described symbolically so the TypeScript test can regenerate exactly the
same Float32 samples; no large audio blobs are stored.

Run from the repository root:

    python scripts/dsp-fixtures.py

Requires only Python 3.11 + numpy (no scipy, librosa or torch).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

SAMPLE_RATE = 16_000
WINDOW_SAMPLES = 480_000
DEFAULT_N_FFT = 400
DEFAULT_HOP = 160
FIRST_FRAMES = 5
OUTPUT = Path("src/lib/captioning/dsp/fixtures/mel-fixtures.json")


def lcg_noise(count: int, seed: int, amplitude: float) -> np.ndarray:
    """Numerical-Recipes LCG; the TypeScript side uses Math.imul with the same constants."""
    state = seed & 0xFFFFFFFF
    values = np.empty(count, dtype=np.float64)
    for i in range(count):
        state = (1664525 * state + 1013904223) & 0xFFFFFFFF
        values[i] = (state / 4294967296.0) * 2.0 - 1.0
    return values * amplitude


def build_signal(spec: dict[str, Any]) -> np.ndarray:
    kind = spec["kind"]
    if kind == "tone":
        frequency = float(spec["frequencyHz"])
        amplitude = float(spec["amplitude"])
        n = np.arange(WINDOW_SAMPLES, dtype=np.float64)
        values = amplitude * np.sin(2.0 * np.pi * frequency * n / SAMPLE_RATE)
    elif kind == "lcg-noise":
        values = lcg_noise(WINDOW_SAMPLES, int(spec["seed"]), float(spec["amplitude"]))
    elif kind == "impulse":
        values = np.zeros(WINDOW_SAMPLES, dtype=np.float64)
        for item in spec["positions"]:
            values[int(item["index"])] = float(item["amplitude"])
    elif kind == "silence":
        values = np.zeros(WINDOW_SAMPLES, dtype=np.float64)
    else:
        raise ValueError(f"unknown signal kind: {kind}")
    # The TypeScript code receives Float32 samples, so quantise here as well.
    return np.asarray(values, dtype=np.float32).astype(np.float64)


def hz_to_mel(frequencies: np.ndarray) -> np.ndarray:
    frequencies = np.asarray(frequencies, dtype=np.float64)
    f_sp = 200.0 / 3.0
    mels = frequencies / f_sp
    min_log_hz = 1000.0
    min_log_mel = min_log_hz / f_sp
    logstep = np.log(6.4) / 27.0
    return np.where(
        frequencies >= min_log_hz,
        min_log_mel + np.log(np.maximum(frequencies, 1e-300) / min_log_hz) / logstep,
        mels,
    )


def mel_to_hz(mels: np.ndarray) -> np.ndarray:
    mels = np.asarray(mels, dtype=np.float64)
    f_sp = 200.0 / 3.0
    freqs = f_sp * mels
    min_log_hz = 1000.0
    min_log_mel = min_log_hz / f_sp
    logstep = np.log(6.4) / 27.0
    return np.where(
        mels >= min_log_mel,
        min_log_hz * np.exp(logstep * (mels - min_log_mel)),
        freqs,
    )


def mel_filterbank(n_mels: int, n_fft: int) -> np.ndarray:
    sr = SAMPLE_RATE
    fmin, fmax = 0.0, sr / 2.0
    fft_freqs = np.fft.rfftfreq(n=n_fft, d=1.0 / sr)
    mel_points = mel_to_hz(
        np.linspace(hz_to_mel(np.array(fmin)), hz_to_mel(np.array(fmax)), n_mels + 2)
    )
    fdiff = np.diff(mel_points)
    ramps = np.subtract.outer(mel_points, fft_freqs)

    weights = np.zeros((n_mels, fft_freqs.size), dtype=np.float64)
    for i in range(n_mels):
        lower = -ramps[i] / fdiff[i]
        upper = ramps[i + 2] / fdiff[i + 1]
        weights[i] = np.maximum(0.0, np.minimum(lower, upper))

    # norm="slaney": constant area per filter.
    enorm = 2.0 / (mel_points[2 : n_mels + 2] - mel_points[:n_mels])
    weights *= enorm[:, None]
    return weights


def log_mel_spectrogram(
    signal: np.ndarray,
    n_mels: int,
    n_fft: int = DEFAULT_N_FFT,
    hop: int = DEFAULT_HOP,
) -> np.ndarray:
    padded = np.pad(signal, (n_fft // 2, n_fft // 2), mode="reflect")
    window = 0.5 - 0.5 * np.cos(2.0 * np.pi * np.arange(n_fft) / n_fft)

    # Torch returns one extra centre-padded frame and Whisper drops it.
    n_frames = (padded.size - n_fft) // hop
    frames = np.lib.stride_tricks.sliding_window_view(padded, n_fft)[::hop][:n_frames]
    spectrum = np.fft.rfft(frames * window, n=n_fft, axis=1)
    power = spectrum.real**2 + spectrum.imag**2  # [frames, bins]
    mel = mel_filterbank(n_mels, n_fft) @ power.T  # [n_mels, frames]

    log_spec = np.log10(np.maximum(mel, 1e-10))
    log_spec = np.maximum(log_spec, log_spec.max() - 8.0)
    return (log_spec + 4.0) / 4.0


CASES: list[dict[str, Any]] = [
    {
        "name": "tone-440-80mel",
        "signal": {"kind": "tone", "frequencyHz": 440.0, "amplitude": 0.5},
        "options": {"nMels": 80, "nFft": 400, "hop": 160},
    },
    {
        "name": "tone-1234.5-128mel",
        "signal": {"kind": "tone", "frequencyHz": 1234.5, "amplitude": 0.25},
        "options": {"nMels": 128, "nFft": 400, "hop": 160},
    },
    {
        "name": "lcg-noise-80mel",
        "signal": {"kind": "lcg-noise", "seed": 123456789, "amplitude": 0.25},
        "options": {"nMels": 80, "nFft": 400, "hop": 160},
    },
    {
        "name": "impulse-80mel",
        "signal": {
            "kind": "impulse",
            "positions": [
                {"index": 12_345, "amplitude": 1.0},
                {"index": 100_000, "amplitude": -0.75},
            ],
        },
        "options": {"nMels": 80, "nFft": 400, "hop": 160},
    },
    {
        "name": "silence-80mel",
        "signal": {"kind": "silence"},
        "options": {"nMels": 80, "nFft": 400, "hop": 160},
    },
]


def main() -> None:
    cases_out = []
    for case in CASES:
        signal = build_signal(case["signal"])
        options = case["options"]
        result = log_mel_spectrogram(
            signal,
            int(options["nMels"]),
            int(options["nFft"]),
            int(options["hop"]),
        )
        if result.shape != (int(options["nMels"]), 3000):
            raise SystemExit(f"{case['name']}: unexpected shape {result.shape}")

        first_frames = [
            [round(float(result[m, frame]), 6) for m in range(result.shape[0])]
            for frame in range(FIRST_FRAMES)
        ]
        cases_out.append(
            {
                "name": case["name"],
                "signal": case["signal"],
                "options": options,
                "frames": int(result.shape[1]),
                "bins": int(result.shape[0]),
                "firstFrameCount": FIRST_FRAMES,
                "firstFrames": first_frames,
                "stats": {
                    "min": round(float(result.min()), 6),
                    "max": round(float(result.max()), 6),
                    "mean": round(float(result.mean()), 6),
                },
            }
        )
        print(
            f"{case['name']}: shape={result.shape} "
            f"min={result.min():.6f} max={result.max():.6f} mean={result.mean():.6f}"
        )

    document = {
        "description": "Oracle fixtures for src/lib/captioning/dsp/mel.ts (Whisper log-mel).",
        "tolerance": 1e-4,
        "sampleRate": SAMPLE_RATE,
        "windowSamples": WINDOW_SAMPLES,
        "cases": cases_out,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(document, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {OUTPUT}")


if __name__ == "__main__":
    main()
