#!/usr/bin/env bash
# 把插件打包成 .xpi（其实就是 zip）。
# 用法：scripts/build-xpi.sh [输出文件名]
# 默认输出：build/ima-zotero-sync.xpi
set -euo pipefail

cd "$(dirname "$0")/.."

OUT="${1:-build/ima-zotero-sync.xpi}"
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"

# 打进 .xpi 的文件（运行时需要的才放进去）
INCLUDE=(
  manifest.json
  bootstrap.js
  prefs.js
  content
  locale
)

# 排除：源图、说明文件等运行时用不到的东西，控制体积
zip -r -X "$OUT" "${INCLUDE[@]}" \
  -x "content/icons/original.png" \
  -x "content/icons/README.md" \
  -x "*/.DS_Store" \
  -x "*.map"

echo "Built: $OUT"
