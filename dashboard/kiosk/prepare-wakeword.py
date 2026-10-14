#!/usr/bin/env python3
"""Fetch pinned runtime/models. Downloads are cached outside version control."""
import hashlib
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parent / 'wake-deps'
FILES = [
    ('onnxruntime-android.aar', 'https://repo.maven.apache.org/maven2/com/microsoft/onnxruntime/onnxruntime-android/1.20.0/onnxruntime-android-1.20.0.aar', '07a8f71ef890afed8c6087a56220e6d558a492804276ee2dd7cb7f6262242027'),
    ('models/melspectrogram.onnx', 'https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/melspectrogram.onnx', 'ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f'),
    ('models/embedding_model.onnx', 'https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/embedding_model.onnx', '70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f'),
    ('models/hey_orbis.onnx', 'https://huggingface.co/protoLabsAI/hey-orbis-wakeword/resolve/a5c9064affdfb487114c7dda083e38e4390e153d/hey_orbis.onnx', 'b5b48bd13b094d2d8fac5155a3c35549bd8580b2edaf59bb774c4f89cfd72f66'),
]

for name, url, expected in FILES:
    destination = ROOT / name
    if destination.exists() and hashlib.sha256(destination.read_bytes()).hexdigest() == expected:
        continue
    print('Downloading', name, flush=True)
    with urllib.request.urlopen(url, timeout=120) as response:
        data = response.read(100 * 1024 * 1024)
    if hashlib.sha256(data).hexdigest() != expected:
        raise SystemExit('SHA-256 mismatch: ' + name)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp = destination.with_suffix(destination.suffix + '.partial')
    temp.write_bytes(data)
    temp.replace(destination)

print('Wake-word runtime and models verified.')
