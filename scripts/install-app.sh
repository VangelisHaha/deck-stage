#!/usr/bin/env bash
# 打包并安装到 /Applications。用法：npm run install-app
set -euo pipefail
cd "$(dirname "$0")/.."

npm run dist
APP="dist/mac/DeckStage.app"
[ -d "$APP" ] || APP="$(ls -d dist/mac*/DeckStage.app | head -1)"

pkill -x DeckStage 2>/dev/null || true
rm -rf /Applications/DeckStage.app
cp -R "$APP" /Applications/DeckStage.app
# 未签名应用：去掉隔离标记，并注册 deckstage:// 协议
xattr -dr com.apple.quarantine /Applications/DeckStage.app 2>/dev/null || true
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/DeckStage.app

echo "已安装：/Applications/DeckStage.app"
