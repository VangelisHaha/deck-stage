#!/usr/bin/env bash
# 稿子改完、体检通过后，引导用户去 DeckStage 查看：在稿库里选中这份稿子（不会自动开始放映）。
#
#   ./open_in_deckstage.sh <稿子目录>          选中，让用户自己回车放映
#   ./open_in_deckstage.sh <稿子目录> --play   选中并直接开始放映（仅当用户明确要求「直接放」时才加）
#
# 稿子不在 DeckStage 已登记的稿库里时，DeckStage 会自动登记它所在的目录。
# 没装 DeckStage、或不是 macOS：只打印提示，退出码 0，不影响后续流程。

set -euo pipefail

DIR="${1:-}"
PLAY="${2:-}"

if [[ -z "$DIR" || ! -d "$DIR" ]]; then
  echo "用法: $(basename "$0") <稿子目录> [--play]" >&2
  exit 1
fi
DIR="$(cd "$DIR" && pwd)"

if [[ "$(uname)" != "Darwin" ]] || ! command -v open >/dev/null 2>&1; then
  echo "这台机器没法直接唤起 DeckStage。稿子在：$DIR"
  echo "放映：在装了 DeckStage 的电脑上把这个目录登记进稿库（远端机器可以用 DeckStage 的「添加远端目录」）。"
  exit 0
fi

ENC="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$DIR")"
URL="deckstage://open?path=$ENC"
[[ "$PLAY" == "--play" ]] && URL="$URL&play=1"

if open "$URL" 2>/dev/null; then
  echo "已在 DeckStage 稿库里选中：$DIR"
  echo "请切到 DeckStage：右侧浮窗可先看目录和缩略图，回车开始放映。"
else
  echo "没能唤起 DeckStage（可能还没安装）。稿子在：$DIR"
  echo "稿子需要用 DeckStage 放映：https://github.com/VangelisHaha/deck-stage/releases"
fi
