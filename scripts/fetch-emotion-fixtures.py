"""从 ESD（duanyu027/ESD）拉 3 个说话人 × 5 种情绪的 16k 单声道夹具。

数据集布局：每个说话人 1750 行 = 5 情绪 × 350 句；情绪块起点偏移 = 说话人起点 + {0,350,700,1050,1400}。
用法：python3 scripts/fetch-emotion-fixtures.py <输出目录>
"""
import json, os, subprocess, sys, urllib.request

LABELS = ["Angry", "Happy", "Neutral", "Sad", "Surprise"]
PER_SPEAKER = 1750
SPEAKERS = 3            # 取前 3 个说话人
API = ("https://datasets-server.huggingface.co/rows"
       "?dataset=duanyu027%2FESD&config=default&split=train&length=1&offset=")


def fetch(offset: int, tries: int = 5) -> dict:
    for _ in range(tries):
        try:
            return json.load(urllib.request.urlopen(API + str(offset), timeout=90))
        except Exception:
            pass
    raise SystemExit(f"拉取失败: offset={offset}")


def main(out_dir: str) -> None:
    os.makedirs(out_dir, exist_ok=True)
    table = []
    for speaker in range(SPEAKERS):
        base = speaker * PER_SPEAKER
        for i, label in enumerate(LABELS):
            data = fetch(base + i * 350)
            row = data["rows"][0]["row"]
            src = row["audio"][0]["src"]
            raw = os.path.join(out_dir, f"{label.lower()}_s{speaker}_raw.wav")
            dst = os.path.join(out_dir, f"{label.lower()}_s{speaker}.wav")
            urllib.request.urlretrieve(src, raw)
            subprocess.run(
                ["ffmpeg", "-hide_banner", "-v", "error", "-y", "-i", raw,
                 "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", dst],
                check=True)
            os.remove(raw)
            table.append(f"{os.path.basename(dst)}\t{label.lower()}")
    with open(os.path.join(out_dir, "labels.tsv"), "w", encoding="utf8") as handle:
        handle.write("file\texpected\n" + "\n".join(table) + "\n")
    print(f"夹具写好: {len(table)} 条 -> {out_dir}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/emotion-spike/fixtures")
