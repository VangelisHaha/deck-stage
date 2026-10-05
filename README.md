# DeckStage

HTML 演示稿的 Mac 放映壳。把 [deck-html](skills/deck-html) 生成的稿子放进一个没有浏览器痕迹的应用里放映：

- 没有地址栏、标签页、工具条，鼠标 2 秒不动自动隐藏
- 观众窗口和演讲者窗口分开，插上 HDMI 自动把观众窗口全屏到外接屏
- 单屏开会用「窗口模式」，飞书里共享这个窗口，演讲者窗口不会被看到
- 内置静态服务，所有响应 `no-store`，不再有浏览器缓存问题
- 放映期间阻止 Mac 息屏
- 稿库：登记几个目录，自动扫描里面的稿子

新建和修改稿子不在这个应用里做，由 Agent 用配套的 `deck-html` skill 完成。

## 安装

```bash
npm install
npm run install-app     # 打包并安装到 /Applications/DeckStage.app
```

开发时直接 `npm start`（可带稿子目录：`npm start -- /path/to/deck`）。当前只打包 x64，不签名。

## 使用

1. 打开 DeckStage，左侧「添加稿库目录」登记放稿子的文件夹
2. 选一份稿子，回车或点「开始放映」
3. 放映中的快捷键：

| 键 | 作用 |
|---|---|
| `F` | 观众窗口 全屏 / 窗口模式 切换 |
| `D` | 观众窗口换到下一块屏幕 |
| `B` | 黑屏 |
| `P` | 聚焦演讲者窗口 |
| `Esc` | 退出全屏 |
| `← →` / 翻页笔 | 翻页（两个窗口自动同步） |
| `⌘R` | 清缓存并重载 |
| `⌘W` | 结束放映，回到稿库 |

菜单「放映」里还有「投屏到」、「文件变更自动刷新」、「导出 PPTX」。

## 稿子的识别规则

目录里有 `index.html`，并且有 `deck.config.js` 或 `notes.js`，就算一份稿子。扫描深度最多 4 层。选稿子目录或它的上一层（里面有 `slides/`）都行。

## 新建与编辑：安装 skill

稿库左下角「新建 / 编辑 → 安装 skill」会显示 skills 目录和一段「安装提示词」。把提示词复制给任意 Agent，它会：

1. 把 `deck-html` 装进自己的 skills 目录
2. 以后用它新建、修改稿子，放进已登记的稿库目录
3. 改完体检，再用 `deckstage://` 链接通知 DeckStage

skill 源码在 [skills/deck-html](skills/deck-html)，随应用一起打包。

## Agent 互动协议

Agent 通过 macOS 的 `open` 命令和 DeckStage 对话。路径需 URL 编码。

| 链接 | 效果 |
|---|---|
| `deckstage://add-root?path=<目录>` | 登记稿库目录 |
| `deckstage://open?path=<稿子目录>` | 在稿库里选中这份稿子，不会自动放映 |
| `deckstage://open?path=<稿子目录>&play=1` | 直接放映（放映中无效）。仅在用户明确要求时使用 |
| `deckstage://skill-installed?agent=<名字>` | 回报 skill 已安装，稿库里会显示「已安装 · 名字」 |

配置文件在 `~/Library/Application Support/DeckStage/config.json`，`roots` 数组就是稿库目录，也可以直接改。

## 目录结构

```
src/main.js          主进程：窗口、IPC、deckstage:// 协议
src/session.js       一次放映：服务、双窗口、投屏布局、快捷键、防息屏
src/server.js        内置静态服务（127.0.0.1，no-store，Range）
src/library.js       稿库扫描
src/store.js         配置读写
src/skill.js         skill 位置与安装提示词
src/util.js          公共工具
src/menu.js          菜单栏
src/deck-preload.js  注入放映窗口：隐藏工具条、光标自隐、黑屏
src/renderer/        稿库界面
skills/deck-html/    配套 skill
```

## 路线

- [x] 稿库、双窗口、投屏切换、快捷键、skill 联动
- [ ] 局域网演讲者视图（WebSocket 中继 + 令牌 + 二维码）
- [ ] 手机遥控 App（Capacitor，Android 优先，音量键翻页）
