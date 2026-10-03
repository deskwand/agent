#!/usr/bin/env bash
#
# 把 MeloTTS 的中英模型打成只含必需文件的 .tar.gz，并打印 sha256。
#
# 为什么自己重打：上游发的是 .tar.bz2，而 Node 的 zlib 不解 bzip2（实测用 Node 侧
# 解包会解出同长度但内容错的模型）。顺便去掉 README 与 133 字节的 model.int8.onnx 占位文件。
#
# 三个 .fst 是必需的：engine 的 `ruleFsts` 指向它们，缺了会把回复里所有数字丢光
# （12 / 3.14 / 2026 全走 OOV）。dict/ 是分词词表，上游自带，删掉是未经验证的质量赌博。
#
# 用法：bash scripts/package-tts-model.sh <上游解开的模型目录> <输出目录>
set -euo pipefail

SRC="${1:?用法: package-tts-model.sh <模型目录> <输出目录>}"
OUT="${2:?用法: package-tts-model.sh <模型目录> <输出目录>}"
NAME="vits-melo-tts-zh_en"

FILES=(model.onnx lexicon.txt tokens.txt dict date.fst number.fst phone.fst LICENSE)
for f in "${FILES[@]}"; do
  [ -e "$SRC/$f" ] || { echo "缺少 $SRC/$f" >&2; exit 1; }
done

mkdir -p "$OUT"
# 归档顶层就是这些文件（strip 0）—— installer.ts 的 installTtsModel 也用 strip 0，两边必须一致。
#
# 走 `gzip -n` 而不是 `tar -czf`：后者会在 gzip 头部写时间戳，同一个目录打两次哈希都不一样，
# 于是随包固定的 sha256 下次重跑就对不上。带上 -n 之后同一台机器、同一个源目录可复现。
tar -cf - -C "$SRC" "${FILES[@]}" | gzip -n > "$OUT/$NAME.tar.gz"

SHA="$(shasum -a 256 "$OUT/$NAME.tar.gz" | awk '{print $1}')"
echo "sha256: $SHA"
# 上传时**用内容寻址的键名**：同一个键传两次不同字节会被 CDN 缓存钉死
# （实测：重新上传后公网仍返回旧字节），文件名带哈希就永远不会撞。
echo "上传键名: $NAME-${SHA:0:8}.tar.gz"
ls -lh "$OUT/$NAME.tar.gz"
