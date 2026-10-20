#!/usr/bin/env bash
# 为三个平台各打一个 onnxruntime-node 运行时 tarball（只有 ORT，不带 OCR 的 opencv/paddle）。
# 形态与 OCR 的运行时一致：解包后是 node_modules 树，onnxruntime-node/bin/napi-v6/<os>/<arch>。
# 用法：ORT_VERSION=1.30.0 bash scripts/package-emotion-runtime.sh <输出目录>
set -euo pipefail
OUT="${1:?用法: package-emotion-runtime.sh <输出目录>}"
ORT_VERSION="${ORT_VERSION:-1.30.0}"
ONNX_COMMON_VERSION="${ONNX_COMMON_VERSION:-1.30.0}"
REGISTRY="${REGISTRY:-https://registry.npmmirror.com}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT" "$WORK/dl"

fetch() { # fetch <包名> <版本>
  local name="$1" version="$2"
  local file="$WORK/dl/$(echo "$name" | tr '/@' '__')-$version.tgz"
  curl -fsSL -o "$file" "$REGISTRY/$name/-/$(basename "$name")-$version.tgz"
  echo "$file"
}
unpack() { mkdir -p "$2"; tar -xzf "$1" -C "$2" --strip-components=1; }

ORT_TGZ=$(fetch onnxruntime-node "$ORT_VERSION")
COMMON_TGZ=$(fetch onnxruntime-common "$ONNX_COMMON_VERSION")

for PLATFORM in darwin-arm64 win32-x64 linux-x64; do
  case "$PLATFORM" in
    darwin-arm64) ORT_OS=darwin; ORT_ARCH=arm64 ;;
    win32-x64)    ORT_OS=win32;  ORT_ARCH=x64 ;;
    linux-x64)    ORT_OS=linux;  ORT_ARCH=x64 ;;
  esac
  ROOT="$WORK/$PLATFORM"; NM="$ROOT/node_modules"
  unpack "$ORT_TGZ" "$NM/onnxruntime-node"
  unpack "$COMMON_TGZ" "$NM/onnxruntime-common"
  ORT_BIN="$NM/onnxruntime-node/bin/napi-v6"
  [ -d "$ORT_BIN" ] || { echo "错误: 没找到 $ORT_BIN，先 tar -tzf 看真实布局" >&2; exit 1; }
  find "$ORT_BIN" -mindepth 1 -maxdepth 1 -type d ! -name "$ORT_OS" -exec rm -rf {} +
  find "$ORT_BIN/$ORT_OS" -mindepth 1 -maxdepth 1 -type d ! -name "$ORT_ARCH" -exec rm -rf {} +
  rm -f "$ORT_BIN/$ORT_OS/$ORT_ARCH/DirectML.dll" 2>/dev/null || true
  tar -czf "$OUT/emotion-runtime-$PLATFORM-$ORT_VERSION.tar.gz" -C "$ROOT" node_modules
  du -h "$OUT/emotion-runtime-$PLATFORM-$ORT_VERSION.tar.gz"
done
shasum -a 256 "$OUT"/emotion-runtime-*.tar.gz | tee "$OUT/runtime.sha256"
