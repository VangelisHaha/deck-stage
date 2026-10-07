#!/usr/bin/env bash
# 新建一份演示稿。
#
#   ./new_deck.sh "稿子标题"                      建在默认稿库 ~/Documents/DeckStage/<标题>/（推荐）
#   ./new_deck.sh <目标目录> [稿子标题]            建在指定目录
#
# 默认稿库由 DeckStage 启动时自动登记，建在这里的稿子会直接出现在 DeckStage 稿库里。
# 想换位置：设环境变量 DECKSTAGE_HOME（只影响这个脚本；DeckStage 里要另外登记那个目录）。
#
# 例：
#   ./new_deck.sh "从单体到服务化"
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
DEFAULT_HOME="${DECKSTAGE_HOME:-$HOME/Documents/DeckStage}"

if [[ -z "$DEST" ]]; then
  echo "用法: $(basename "$0") \"稿子标题\"   或   $(basename "$0") <目标目录> [稿子标题]" >&2
  exit 1
fi

# 只给了一个参数、且不像路径：当作标题，建到默认稿库里（目录名取标题，重名自动加序号）
if [[ -z "$TITLE" && "$DEST" != */* && "$DEST" != .* && "$DEST" != ~* ]]; then
  TITLE="$DEST"
  NAME="$(python3 - "$TITLE" <<'PY'
import re, sys
n = re.sub(r'[\\/:*?"<>|\x00-\x1f]', '-', sys.argv[1]).strip().strip('.')
print(re.sub(r'\s+', ' ', n)[:60] or 'deck')
PY
)"
  DEST="$DEFAULT_HOME/$NAME"
  i=2
  while [[ -e "$DEST" && -n "$(ls -A "$DEST" 2>/dev/null || true)" ]]; do
    DEST="$DEFAULT_HOME/$NAME-$i"
    i=$((i + 1))
  done
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
for name in ("index.html", "deck.config.js", "notes.js", "AGENTS.md"):
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
echo "  4. 体检通过后，在 DeckStage 里打开：$SELF/open_in_deckstage.sh \"$DEST\"（没装 DeckStage 就 cd \"$DEST\" && ./serve.sh）"
echo "  5. 改 AGENTS.md：写清这份稿子的内容来源、受众、数据口径（改动流程见 references/workflow.md）"
