#!/usr/bin/env bash
# 新建一份演示稿。
#
#   ./new_deck.sh <目标目录> [稿子标题]
#
# 例：
#   ./new_deck.sh ~/decks/2026-09-架构分享 "从单体到服务化"
#
# 模板路径由脚本自己的位置推出来，所以这个 skill 放在哪都能跑，
# 复制给别人、装到 ~/.claude/skills、打成 zip 分发都一样。
# 全程离线：导出库已经打在模板里，不联网、不装依赖。

set -euo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$(cd "$SELF/../assets/template" && pwd)"

DEST="${1:-}"
TITLE="${2:-}"

if [[ -z "$DEST" ]]; then
  echo "用法: $(basename "$0") <目标目录> [稿子标题]" >&2
  exit 1
fi

if [[ -e "$DEST" && -n "$(ls -A "$DEST" 2>/dev/null || true)" ]]; then
  echo "目标目录已存在且非空，先清空或换个路径：$DEST" >&2
  exit 1
fi

mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"
cp -R "$TEMPLATE/." "$DEST/"
mkdir -p "$DEST/assets"
chmod +x "$DEST/serve.sh"

# ---- 占位符替换 ----
# TITLE 用于页面标题、导出文件名、演讲者视图窗口名
# SLUG  用于 BroadcastChannel 频道名，必须唯一：同一浏览器里同时开两份稿子，
#       频道撞了就会互相翻页。中文标题过 ASCII 过滤后往往只剩零星字符
#       （「架构评审 2026Q3」→「2026q3」），光靠标题不足以保证唯一，
#       所以固定再拼一段由目标绝对路径算出的短哈希 —— 同一目录重跑结果一致。
if [[ -z "$TITLE" ]]; then
  TITLE="$(basename "$DEST")"
fi

SLUG="$(python3 - "$DEST" "$TITLE" <<'PY'
import hashlib, re, sys
dest, title = sys.argv[1], sys.argv[2]
base = re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')
h = hashlib.sha1(dest.encode('utf-8')).hexdigest()[:6]
print(f'{base}-{h}' if base else h)
PY
)"

python3 - "$DEST" "$TITLE" "$SLUG" <<'PY'
import os, sys
dest, title, slug = sys.argv[1], sys.argv[2], sys.argv[3]
for name in ("index.html", "deck.config.js", "notes.js"):
    p = os.path.join(dest, name)
    if not os.path.isfile(p):
        continue
    with open(p, encoding="utf-8") as f:
        s = f.read()
    s = s.replace("DECK_SLUG", slug).replace("DECK_TITLE", title)
    with open(p, "w", encoding="utf-8") as f:
        f.write(s)
PY

echo "已创建：$DEST"
echo "  标题   $TITLE"
echo "  频道   deck-$SLUG"
echo
echo "下一步："
echo "  1. 改 index.html 的 <style> 定风格，每页写一个 <section class=\"slide\" data-t=\"...\">"
echo "  2. 每页在 notes.js 里配一条同名台词"
echo "  3. 体检：python3 $SELF/check_deck.py \"$DEST\""
echo "  4. 放映：cd \"$DEST\" && ./serve.sh"
