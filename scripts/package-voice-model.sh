#!/usr/bin/env bash
#
# 把 sherpa-onnx 的模型目录打成只含必需文件的 .tar.gz，并打印 sha256。
#
# 为什么自己重打：上游发的是 .tar.bz2（Node 的 zlib 不解 bzip2），而且带了
# test_wavs/ 与 test_onnx.py 这些运行时用不到的东西。
#
# 用法：bash scripts/package-voice-model.sh <上游解开的模型目录> <输出目录>
set -euo pipefail

SRC="${1:?用法: package-voice-model.sh <模型目录> <输出目录>}"
OUT="${2:?用法: package-voice-model.sh <模型目录> <输出目录>}"
NAME="x-asr-480ms-zh-en-punct-int8"

# 只打运行时真正会读的 5 个文件（sherpa 的加载器要同目录拿到它们）
FILES=(encoder.int8.onnx decoder.onnx joiner.int8.onnx tokens.txt bpe.model)
for f in "${FILES[@]}"; do
  [ -f "$SRC/$f" ] || { echo "缺少 $SRC/$f" >&2; exit 1; }
done

mkdir -p "$OUT"
# 归档顶层就是这 5 个文件（strip 0）—— installer.ts 的 installModel 也用 strip 0，
# 两边必须一致。改成带包装目录会让文件多一级，加载器就找不到 bpe.model 了。
tar -czf "$OUT/$NAME.tar.gz" -C "$SRC" "${FILES[@]}"

shasum -a 256 "$OUT/$NAME.tar.gz"
ls -lh "$OUT/$NAME.tar.gz"
