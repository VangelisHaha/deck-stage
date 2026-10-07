# 配合 DeckStage 放映（macOS）

DeckStage 是放映这类稿子的 Mac 应用：无浏览器地址栏、双屏、演讲者视图、手机遥控、投屏友好、稿库、导出 ZIP/PPTX。它不编辑稿子，新建和修改都由本 skill 完成，两者通过 `deckstage://` 链接互动。**没装 DeckStage 的机器忽略本文，`serve.sh` 照常可用。**

## 和 DeckStage 互动

通过 macOS 的 `open` 命令，路径必须 URL 编码（中文、空格都要）。

| 场景 | 做法 |
|---|---|
| 新稿子放哪 | **默认稿库 `~/Documents/DeckStage/`**：DeckStage 每次启动都会确保它存在并登记进稿库，`new_deck.sh "标题"` 默认就建在这里，不用问用户、不用登记。用户指定了别的目录才另说（目录列表在 `~/Library/Application Support/DeckStage/config.json` 的 `roots`）。用户在稿库里把默认稿库移除过的话，它不会自动回来，此时让用户在稿库里「添加稿库目录」选回来 |
| 登记新目录 | 用户同意后：`open "deckstage://add-root?path=<绝对路径>"` |
| 稿子改完 | 先体检，通过后跑 `scripts/open_in_deckstage.sh <稿子目录>`（等价于 `open "deckstage://open?path=<稿子目录>"`，已处理 URL 编码）。只会在稿库里选中，不会自动开始放映；稿子不在已登记的稿库里时，DeckStage 会自动登记它所在的目录。**每次新建或大改完都要做这一步，并告诉用户去 DeckStage 看** |
| 装好 skill 后回报 | `open "deckstage://skill-installed?agent=<你的名字>"` |

约束：

1. 不要加 `play=1` 让 DeckStage 直接开始放映，除非用户明确说「现在就放」。放映会占用外接屏和投影。
2. 放映中的修改用「清缓存并重载」（⌘R）生效，或在 DeckStage 菜单里开「文件变更自动刷新」。
3. 在稿库里可以直接导出 ZIP（整个稿子目录）和 PPTX（逐页截图，存成 JPEG）。

## 稿子需要后台服务

页面要调本机接口（例如「发送单聊 / 群聊消息」的按钮）时：

1. 把服务做成独立进程，只监听 `127.0.0.1`，提供 `GET /health`。模板见 `assets/optional/local_service.py`，已带来源校验。
2. 在稿子目录写 `deckstage.json`，DeckStage 放映时替用户启动、结束时关闭：

```json
{
  "services": [
    {
      "name": "分享发送服务",
      "command": ["python3", "share/share_server.py"],
      "health": "http://127.0.0.1:8898/health"
    }
  ]
}
```

DeckStage 的行为：

- `command` 在稿子目录下执行，环境取用户**登录 shell 的环境**。从 Finder 启动的应用只有最小的 `PATH`，找不到 `lark-cli`、`node` 这类命令，所以不能直接继承。
- `health` 可选。放映前先访问一次，已经能通就认为服务在跑，不重复启动，结束时也不会关掉它。
- **首次放映，或命令/脚本内容变化时，弹窗让用户确认**（允许并记住 / 仅本次允许 / 不启动）。这是预期行为，因为打开稿子就执行命令等于运行陌生程序。
- 日志在 `~/Library/Application Support/DeckStage/logs/`。

写服务时的要求：

- **不要假设 `serve.sh` 会被执行**，DeckStage 放映不跑它。
- **任何网页都能向 `127.0.0.1` 发请求**，所以服务必须校验 `Origin`（只认 `127.0.0.1` / `localhost`）和 `Host`（防 DNS 重绑定），只给本机页面回 CORS 头；**不要用 `Access-Control-Allow-Origin: *`**。
- 动作写死在服务里，不接受页面传来的命令、路径。同一时间只执行一个动作，防连点。
- 服务脚本里不要写死群 id、webhook、密钥：这些放配置文件，且配置文件不随稿子分发（见 `workflow.md` 的脱敏）。
- 页面里的按钮要处理「服务没起」：进页时探测 `/health`，失败就提示，而不是点了才报错。

## 稿库里的预览

用户在 DeckStage 稿库里选中稿子，右侧浮窗会显示目录和每页缩略图（放映前先看个大概）。它靠这几样，稿子要保持：

- 每页一个 `#slides > .slide`，且有 `data-t`（目录显示的就是它）
- 页面脚本能在无服务的情况下渲染出内容（预览只起静态服务，不启动 `deckstage.json` 的后台服务）
- 动效在 `body.exporting` 下直接显示终态（预览和导出 PPTX 都靠这个；见 `effects.md` 的两条规则）

## 远端稿库（稿子在另一台机器上）

稿子可以放在远端的 Linux / Mac 上，DeckStage 通过 SSH 访问：

- 稿库里的「添加远端目录（SSH）」，填主机、端口、用户名、密码、远端目录（密码留空则用密钥或 ssh-agent；主机也可以是 `~/.ssh/config` 里的别名）。连接信息保存在用户本机，下次自动出现。
- 放映和导出前，DeckStage 用 rsync 把那一份稿子同步到本机缓存再放，所以 **Agent 在远端建稿、改稿时不需要做任何特殊处理**，保持稿子目录结构不变（`index.html` + `deck.config.js` / `notes.js`）即可。
- 本机 Agent 可以执行 `open "deckstage://add-root?path=ssh%3A%2F%2Fuser%40host%2Fpath"` 登记远端目录（只用于不需要密码、或本机已保存过这台机器密码的情况；**不要把用户的密码拼进链接或写进任何文件**，需要密码时让用户在界面里填）；跑在远端的 Agent 没法执行本机的 `open`，同样让用户在界面里添加。
- 稿子里有 `deckstage.json` 要启动后台服务时，同步到本机后在本机运行（信任弹窗会标明来源主机）。服务脚本要能在用户本机跑，不要依赖远端才有的路径、凭证或软件。
- 同步会排除 `node_modules` 和 `.git`。图片、视频等大文件首次同步会慢，之后只传变化的部分。

## 演讲者窗口的交互（DeckStage 提供，稿子不用做任何事）

演讲者窗口的布局、目录、光点和划线都由 DeckStage 在放映时叠加，只依赖骨架固有的结构（`#pv`、`#pvBody`、`#slides > .slide[data-t]`、`#dots`），旧稿子同样生效。所以：
- 每页必须有 `data-t`，目录显示的就是它；
- 不要给 `#stage` 加会在缩放时失效的绝对定位或固定像素偏移；
- 想让台词在放大画面时也好读，台词写短句、一句一行。

快捷键见 DeckStage 的 README：`L` 换布局、`G` 目录（可搜页码、标题和拼音首字母）、数字+回车跳页、`Shift`/`E` 划线、`C` 清除、`+` `-` 调台词字号。
