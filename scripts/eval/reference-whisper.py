"""Reference transcript from the original PyTorch model, to compare with the in-browser engine.

  python -I scripts/eval/reference-whisper.py <media-file>

Needs torch, transformers and av (PyAV). Downloads Oriserve/Whisper-Hindi2Hinglish-Swift (~290 MB) on first use.
"""
import sys

import av
import numpy as np
import torch
from transformers import WhisperForConditionalGeneration, WhisperProcessor

path = sys.argv[1]
container = av.open(path)
resampler = av.AudioResampler(format="flt", layout="mono", rate=16000)
chunks = []
for frame in container.decode(audio=0):
    for out in resampler.resample(frame):
        chunks.append(out.to_ndarray().reshape(-1))
audio = np.concatenate(chunks).astype(np.float32)
print(f"audio: {len(audio) / 16000:.2f}s")

name = "Oriserve/Whisper-Hindi2Hinglish-Swift"
processor = WhisperProcessor.from_pretrained(name)
model = WhisperForConditionalGeneration.from_pretrained(name).eval()
features = processor(audio[: 30 * 16000], sampling_rate=16000, return_tensors="pt").input_features
for label, kwargs in (("en greedy", dict(language="en", task="transcribe")), ("hi greedy", dict(language="hi", task="transcribe")), ("auto", dict(task="transcribe"))):
    with torch.no_grad():
        ids = model.generate(features, num_beams=1, do_sample=False, max_new_tokens=200, **kwargs)
    print(f"[{label}]", processor.batch_decode(ids, skip_special_tokens=True)[0])
