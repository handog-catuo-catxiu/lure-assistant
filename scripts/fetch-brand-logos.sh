#!/usr/bin/env bash
#
# 从 Wikimedia Commons 下载品牌 Logo 到 public/brand-logos/。
#
# 只收录来源和授权可核查的素材：这里两个文件是逐个查过的、Commons 上仅有的候选。
# 下载后请打开 public/brand-logos/CREDITS.md 里列出的文件页确认授权标签。
#
# 用法：
#   bash scripts/fetch-brand-logos.sh          # 已存在的文件会跳过
#   bash scripts/fetch-brand-logos.sh --force  # 重新下载
#
# 需要 curl。下载完还要去 src/data/brands.ts 给对应品牌补 logo 字段，
# 否则文件放着也不会被用到（见 public/brand-logos/CREDITS.md 第四节）。

set -euo pipefail

cd "$(dirname "$0")/.."
OUT_DIR="public/brand-logos"
FORCE="${1:-}"

# 本地文件名|Commons 文件名|说明
FILES=(
  "shimano.svg|Shimano.svg|Shimano / 禧玛诺"
  "rapala.svg|Rapala Logo.svg|Rapala / 乐伯乐"
)

mkdir -p "$OUT_DIR"

UA="LureMate/0.4 (personal tackle catalog; contact: local project)"

for row in "${FILES[@]}"; do
  IFS='|' read -r local_name commons_name label <<<"$row"
  target="$OUT_DIR/$local_name"

  if [[ -f "$target" && "$FORCE" != "--force" ]]; then
    echo "跳过 ${local_name}（已存在，用 --force 可重新下载）"
    continue
  fi

  url="https://commons.wikimedia.org/wiki/Special:FilePath/$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$commons_name" 2>/dev/null || echo "${commons_name// /%20}")"

  echo "下载 ${label} -> ${target}"
  if curl -fsSL -m 60 -A "$UA" -o "$target" "$url"; then
    size=$(wc -c <"$target" | tr -d ' ')
    if [[ "$size" -lt 200 ]]; then
      echo "  警告：文件只有 ${size} 字节，可能不是有效图片，请打开确认"
    else
      echo "  完成（${size} 字节），来源：${url}"
    fi
  else
    echo "  失败：${url}（可能是网络受限或文件名变了）"
    rm -f "$target"
  fi
done

echo
echo "完成后请：1) 打开 public/brand-logos/CREDITS.md 对照检查授权；2) 刷新页面查看效果。"
