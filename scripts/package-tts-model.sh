#!/usr/bin/env bash
#
# 把 TTS 模型打成只含必需文件的 .tar.gz，并打印 sha256。
#
# 为什么自己重打：上游发的是 .tar.bz2，而 Node 的 zlib 不解 bzip2（实测用 Node 侧
# 解包会解出同长度但内容错的模型）。顺便去掉 README 与 133 字节的 model.int8.onnx 占位文件。
#
# 中文模型（vits-melo-tts-zh_en）：
#   三个 .fst 是必需的：engine 的 `ruleFsts` 指向它们，缺了会把回复里所有数字丢光
#   （12 / 3.14 / 2026 全走 OOV）。dict/ 是分词词表，上游自带，删掉是未经验证的质量赌博。
# 英文模型（vits-melo-tts-en）：包里没有 dict/ 也没有任何 .fst（实测），所以清单就这些。
#   数字改由 src/main/tts/english-numbers.ts 在送引擎前转写。
#
# 语音模式的高速音色（matcha-icefall-zh-en）：
#   声码器 vocos-16khz-univ.onnx 与三个 -zh.fst 都是必需的（与中文模型同理：缺了数字会被丢掉）。
#   espeak-ng-data 是**英文发音必需**的：缺它不报错，英文单词会走 OOV 被静默丢掉。
#   它有 355 个文件，而上游包里**没有任何许可证文件** —— 这份数据来自 espeak-ng，是 GPL-3.0。
#   所以打包前要把 espeak-ng 的 COPYING（GPL-3.0 全文）放进 espeak-ng-data/ 下，随目录一起进包。
#   这是合规要求，不是可选项。
#   声码器不在上游 tarball 里（它单独下载），所以打包前要手工拷进 SRC。
#
# 用法：bash scripts/package-tts-model.sh <上游解开的模型目录> <输出目录> [模型名]
set -euo pipefail

SRC="${1:?用法: package-tts-model.sh <模型目录> <输出目录> [模型名]}"
OUT="${2:?用法: package-tts-model.sh <模型目录> <输出目录> [模型名]}"
NAME="${3:-vits-melo-tts-zh_en}"

case "$NAME" in
  vits-melo-tts-zh_en)
    FILES=(model.onnx lexicon.txt tokens.txt dict date.fst number.fst phone.fst LICENSE)
    ;;
  vits-melo-tts-en)
    FILES=(model.onnx lexicon.txt tokens.txt LICENSE)
    ;;
  matcha-icefall-zh-en)
    # espeak-ng-data 是目录：COPYING 就放在它里面，随目录进包（见文件头注释）
    FILES=(model-steps-3.onnx lexicon.txt tokens.txt
           date-zh.fst number-zh.fst phone-zh.fst
           vocos-16khz-univ.onnx espeak-ng-data)
    ;;
  *)
    echo "未知模型: $NAME" >&2
    exit 1
    ;;
esac
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
