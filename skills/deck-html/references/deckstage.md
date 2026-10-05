# 配合 DeckStage 放映（macOS）

DeckStage 是放映这类稿子的 Mac 应用：无浏览器地址栏、双屏、演讲者视图、手机遥控、投屏友好、稿库、导出 ZIP/PPTX。它不编辑稿子，新建和修改都由本 skill 完成，两者通过 `deckstage://` 链接互动。**没装 DeckStage 的机器忽略本文，`serve.sh` 照常可用。**

## 和 DeckStage 互动

通过 macOS 的 `open` 命令，路径必须 URL 编码（中文、空格都要）。

| 场景 | 做法 |
|---|---|
| 新稿子放哪 | DeckStage 已登记的稿库目录里（目录列表在 `~/Library/Application Support/DeckStage/config.json` 的 `roots`）。没有合适目录先问用户 |
| 登记新目录 | 用户同意后：`open "deckstage://add-root?path=<绝对路径>"` |
| 稿子改完 | 先体检，通过后：`open "deckstage://open?path=<稿子目录>"`。只会在稿库里选中，不会自动开始放映 |
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
