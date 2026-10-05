#!/usr/bin/env bash
# 起本地 http 服务。
#
# 为什么不能直接双击 index.html：
#   1) file:// 下 canvas 会被跨域污染，导出 PPTX 必失败
#   2) BroadcastChannel 受同源限制，file:// 下主屏和小屏握不上手
#
# 演示和导出都从 http://127.0.0.1:8899 打开。
# 端口可以传参覆盖：./serve.sh 9000

set -euo pipefail
PORT="${1:-8899}"
cd "$(dirname "$0")"

echo "观众视图   http://127.0.0.1:${PORT}/index.html"
echo "演讲者视图 http://127.0.0.1:${PORT}/index.html?notes=1"
echo "（演讲者视图建议从观众视图右上角按钮打开，保证同源）"
echo

exec python3 -m http.server "$PORT" --bind 127.0.0.1
