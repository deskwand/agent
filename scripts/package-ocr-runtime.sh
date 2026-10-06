#!/usr/bin/env bash
#
# 为三个平台各打一个 OCR 运行时 tarball：ppu-paddle-ocr + ppu-ocv + opencv-js
# + @napi-rs/canvas（本平台预编译）+ onnxruntime-node（本平台，裁掉 DirectML 与别的平台）。
#
# 关键点：脚本不依赖所在机器的**架构**，三个平台一次跑完（但仍然依赖 shasum/curl/tar，在
# macOS 上跑）。所以不跑 npm install，而是直接从 registry 下 tarball 再按平台挑目录。
#
# 版本常量以 Task 1 记录的 package-lock 解析值为准（见 design-docs/2026-10-06-local-ocr-spike.md）。
#
# 用法：bash scripts/package-ocr-runtime.sh <输出目录>
set -euo pipefail

OUT="${1:?用法: package-ocr-runtime.sh <输出目录>}"
PPU_VERSION=6.6.0
PPU_OCV_VERSION=4.0.0
OPENCV_JS_VERSION=5.0.0-release.1
ORT_VERSION="${ORT_VERSION:?请设环境变量 ORT_VERSION（spike 记录的版本，1.30.0）}"
# onnxruntime-node 在 import 时 require 它（实测：遗漏就会 Cannot find module）
ONNX_COMMON_VERSION=1.30.0
CANVAS_VERSION=1.0.10
# onnxruntime-node 声明了但只在 postinstall（下 CUDA）用的，我们只用 CPU，故意不装
OMITTED_DEPS="adm-zip global-agent"
# 国内网络实测：npmmirror 比 registry.npmjs.org 快一个量级（见语音那条链的选择）
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

PPU_TGZ=$(fetch ppu-paddle-ocr "$PPU_VERSION")
PPU_OCV_TGZ=$(fetch ppu-ocv "$PPU_OCV_VERSION")
OPENCV_TGZ=$(fetch @techstark/opencv-js "$OPENCV_JS_VERSION")
ORT_TGZ=$(fetch onnxruntime-node "$ORT_VERSION")

# npm tarball 顶层是 package/，strip 1 解进 node_modules/<name>
unpack() { # unpack <tgz> <目标目录>
  mkdir -p "$2"
  tar -xzf "$1" -C "$2" --strip-components=1
}

for PLATFORM in darwin-arm64 win32-x64 linux-x64; do
  case "$PLATFORM" in
    darwin-arm64) CANVAS_PKG=@napi-rs/canvas-darwin-arm64; ORT_OS=darwin; ORT_ARCH=arm64 ;;
    win32-x64)    CANVAS_PKG=@napi-rs/canvas-win32-x64-msvc; ORT_OS=win32; ORT_ARCH=x64 ;;
    linux-x64)    CANVAS_PKG=@napi-rs/canvas-linux-x64-gnu; ORT_OS=linux; ORT_ARCH=x64 ;;
  esac
  CANVAS_TGZ=$(fetch "$CANVAS_PKG" "$CANVAS_VERSION")

  ROOT="$WORK/$PLATFORM"
  NM="$ROOT/node_modules"
  unpack "$PPU_TGZ"     "$NM/ppu-paddle-ocr"
  unpack "$PPU_OCV_TGZ" "$NM/ppu-ocv"
  unpack "$OPENCV_TGZ"  "$NM/@techstark/opencv-js"
  unpack "$CANVAS_TGZ"  "$NM/@napi-rs/canvas-$(basename "$CANVAS_PKG" | sed 's/^canvas-//')"
  unpack "$ORT_TGZ"     "$NM/onnxruntime-node"
  unpack "$(fetch onnxruntime-common "$ONNX_COMMON_VERSION")" "$NM/onnxruntime-common"
  # @napi-rs/canvas 是转发器包：加载器按名字找同级的平台包，所以主包也要在
  unpack "$(fetch @napi-rs/canvas "$CANVAS_VERSION")" "$NM/@napi-rs/canvas"

  # 裁：别的平台的 ORT 原生库、DirectML（我们只用 CPU）、CUDA。
  #
  # 路径形状必须先看一眼再删：onnxruntime-node 把库放在 `bin/napi-v6/<os>/<arch>/`
  # （如 `bin/darwin/arm64`、`bin/win32/x64`），不是 `bin/darwin-arm64`。
  ORT_BIN="$NM/onnxruntime-node/bin/napi-v6"
  if [ ! -d "$ORT_BIN" ]; then
    echo "错误: 没找到 $ORT_BIN —— 先 tar -tzf 看一眼真实布局再改本段" >&2
    exit 1
  fi
  find "$ORT_BIN" -mindepth 1 -maxdepth 1 -type d ! -name "$ORT_OS" -exec rm -rf {} +
  find "$ORT_BIN/$ORT_OS" -mindepth 1 -maxdepth 1 -type d ! -name "$ORT_ARCH" -exec rm -rf {} +
  # 断言而不是相信：只能剩一个 arch 子目录
  REMAINING=$(ls -1 "$ORT_BIN/$ORT_OS" | wc -l | tr -d ' ')
  if [ "$REMAINING" != "1" ]; then
    echo "错误: $ORT_BIN/$ORT_OS 下剩 $REMAINING 个目录，期望 1 个" >&2
    exit 1
  fi
  find "$NM" -name 'DirectML.dll' -delete
  find "$NM" -name 'libonnxruntime_providers_cuda*' -delete
  find "$NM" -name 'libonnxruntime_providers_tensorrt*' -delete

  # 依赖完整性：装了的包声明的非 optional 依赖必须都在，除非在 OMITTED_DEPS 里
  # （漏掉 onnxruntime-common 已经真实发生过一次：spike 里 npm 帮你装了，打包时不装就断）
  OMITTED_DEPS="$OMITTED_DEPS" node - "$NM" <<'NODE'
const { readdirSync, readFileSync, existsSync, statSync } = require("node:fs");
const { join } = require("node:path");
const nm = process.argv[2];
const omitted = new Set((process.env.OMITTED_DEPS || "").split(" ").filter(Boolean));
const names = readdirSync(nm).flatMap((entry) => {
  if (!entry.startsWith("@")) return [entry];
  return readdirSync(join(nm, entry)).map((sub) => `${entry}/${sub}`);
});
const missing = [];
for (const name of names) {
  const pkgPath = join(nm, name, "package.json");
  if (!existsSync(pkgPath) || !statSync(pkgPath).isFile()) continue;
  const deps = Object.keys(JSON.parse(readFileSync(pkgPath, "utf8")).dependencies || {});
  for (const dep of deps) {
    if (omitted.has(dep)) continue;
    if (!existsSync(join(nm, dep))) missing.push(`${name} → ${dep}`);
  }
}
if (missing.length) {
  console.error(`错误: 运行时缺依赖:\n  ${missing.join("\n  ")}`);
  process.exit(1);
}
console.log(`依赖完整性 ✓（${names.length} 个包，故意略过: ${[...omitted].join(", ")}）`);
NODE

  # 文件名带内容指纹（与模型包同形）：同版本改配方时不会覆盖同名旧对象，
  # 本地 sha256 校验也不会碰到 CDN 缓存里的旧字节
  TMP="$WORK/$PLATFORM.tar.gz"
  tar -czf "$TMP" -C "$ROOT" node_modules
  SHA8=$(shasum -a 256 "$TMP" | cut -c1-8)
  NAME="ocr-runtime-$PLATFORM-$ORT_VERSION-$SHA8"
  mv "$TMP" "$OUT/$NAME.tar.gz"
  echo "产出: $OUT/$NAME.tar.gz"
  ls -l "$OUT/$NAME.tar.gz"
  shasum -a 256 "$OUT/$NAME.tar.gz"
done
