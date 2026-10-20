#!/usr/bin/env bash
# 打模型包：emotion2vec.int8.onnx + labels.txt，输出 tarball 与 sha256。
#
# 署名义务：模型是 emotion2vec（Alibaba FunASR），遵循 FunASR 模型开源协议 v1.1 ——
# 允许使用、复制、修改、分享（含派生模型），要求保留模型名与来源。
# Speech emotion recognition uses emotion2vec (Alibaba FunASR), licensed under the
# FunASR Model Open Source License Agreement v1.1.
# 用法：bash scripts/package-emotion-model.sh <模型产物目录> <输出目录>
set -euo pipefail
SRC="${1:?用法: package-emotion-model.sh <模型产物目录> <输出目录>}"
OUT="${2:?用法: package-emotion-model.sh <模型产物目录> <输出目录>}"
MODEL_ID="emotion2vec-plus-base-int8"
mkdir -p "$OUT"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
for f in emotion2vec.int8.onnx labels.txt; do
  if [ ! -f "$SRC/$f" ]; then echo "缺文件: $SRC/$f" >&2; exit 1; fi
  cp "$SRC/$f" "$WORK/$f"
done
# 顶层就是内容，**没有包装目录**：安装器用 strip 0（src/main/speech/installer.ts:216
# 与 src/main/ocr/installer.ts:128 同一条约定）。加一层目录会解成 models/<id>/<id>/…。
tar -czf "$OUT/$MODEL_ID.tar.gz" -C "$WORK" emotion2vec.int8.onnx labels.txt
shasum -a 256 "$OUT/$MODEL_ID.tar.gz" > "$OUT/$MODEL_ID.sha256"
du -h "$OUT/$MODEL_ID.tar.gz"
cat "$OUT/$MODEL_ID.sha256"
