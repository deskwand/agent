#!/usr/bin/env bash
#
# 把 PP-OCRv6 small 的三个文件打成一个 tar.gz，并打印体积与 sha256。
#
# 为什么自己重打：与 TTS 模型同因 —— 上游只发原始权重，字典还要从 inference.yml 抽，
# 打包要做成一步可复现的操作。
#
# 用法：bash scripts/package-ocr-model.sh <输出目录>
set -euo pipefail

OUT="${1:?用法: package-ocr-model.sh <输出目录>}"
DET_REPO=PaddlePaddle/PP-OCRv6_small_det_onnx
REC_REPO=PaddlePaddle/PP-OCRv6_small_rec_onnx

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT" "$WORK/pack"

echo "下载模型 ..."
curl -fsSL -o "$WORK/pack/det.onnx" "https://huggingface.co/$DET_REPO/resolve/main/inference.onnx"
curl -fsSL -o "$WORK/pack/rec.onnx" "https://huggingface.co/$REC_REPO/resolve/main/inference.onnx"
curl -fsSL -o "$WORK/rec.yml"  "https://huggingface.co/$REC_REPO/resolve/main/inference.yml"

node "$(dirname "$0")/extract-ppocr-dict.mjs" "$WORK/rec.yml" "$WORK/pack/ppocrv6_dict.txt"

NAME="ppocrv6-small-$(shasum -a 256 "$WORK/pack/det.onnx" | cut -c1-8)"
tar -czf "$OUT/$NAME.tar.gz" -C "$WORK/pack" det.onnx rec.onnx ppocrv6_dict.txt

echo "产出: $OUT/$NAME.tar.gz"
ls -l "$OUT/$NAME.tar.gz"
tar -tzf "$OUT/$NAME.tar.gz"
shasum -a 256 "$OUT/$NAME.tar.gz"
