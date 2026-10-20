"""校验导出模型：ONNX 前 1 标签 vs 夹具标注，并打印每条耗时。

用法：python3 scripts/emotion-parity-check.py <模型目录> <夹具目录>
模型目录里应有 labels.txt、以及 emotion2vec.int8.onnx 或（encoder.int8.onnx + head.bin）。
"""
import glob, os, sys, time, wave
import numpy as np
import onnxruntime as ort


def read_wav(path: str) -> np.ndarray:
    with wave.open(path) as handle:
        assert handle.getframerate() == 16000 and handle.getnchannels() == 1
        frames = handle.readframes(handle.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


def load_head(model_dir: str):
    path = os.path.join(model_dir, "head.bin")
    if not os.path.exists(path):
        return None
    raw = np.fromfile(path, dtype=np.float32)
    weight, bias = raw[: 9 * 768].reshape(9, 768), raw[9 * 768 :]
    return weight, bias


def main(model_dir: str, fixture_dir: str) -> None:
    with open(os.path.join(model_dir, "labels.txt"), encoding="utf8") as handle:
        labels = [line.split("/")[-1].strip() for line in handle if line.strip()]
    model_path = os.path.join(model_dir, "emotion2vec.int8.onnx")
    if not os.path.exists(model_path):
        model_path = os.path.join(model_dir, "encoder.int8.onnx")
    session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
    head = load_head(model_dir)
    name = session.get_inputs()[0].name
    expected = {}
    with open(os.path.join(fixture_dir, "labels.tsv"), encoding="utf8") as handle:
        next(handle)
        for line in handle:
            file_name, label = line.strip().split("\t")
            expected[file_name] = label
    hits = total = 0
    slowest = 0.0
    for path in sorted(glob.glob(os.path.join(fixture_dir, "*.wav"))):
        pcm = read_wav(path)
        start = time.time()
        out = session.run(None, {name: pcm[None, :].astype(np.float32)})[0]
        elapsed = time.time() - start
        slowest = max(slowest, elapsed)
        if head is not None:                       # 退回形态：自己算池化与头部
            pooled = out.mean(axis=1)[0]
            logits = head[0] @ pooled + head[1]
            probs = np.exp(logits - logits.max())
            probs /= probs.sum()
        else:
            probs = np.ravel(out)
        name_text = os.path.basename(path)
        want = expected.get(name_text, "?")
        got = labels[int(probs.argmax())]
        total += 1
        hits += 1 if got == want else 0
        print(f"{name_text:24s} expect={want:9s} got={got:10s} {elapsed * 1000:6.0f}ms")
    print(f"判对率: {hits}/{total}  最慢一条: {slowest * 1000:.0f}ms")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
