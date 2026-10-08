---
name: deck-html
description: 写技术分享用的 HTML 演示稿，用 DeckStage（Mac 放映应用）放映。用户说“做一份演示稿/PPT”“搭个分享稿”“新建 slides”“加一页”“改台词”“拆分大稿子”“加动画/动效”“页面要调本机接口/发消息按钮”“导出 PPTX/ZIP”“演讲者视图”“体检一下这份稿子”“check deck”“用 DeckStage 放映”时使用。稿子只写内容（页面、台词、样式），放映内核（演讲者视图、双屏同步、台词计时、素材装载、图片灯箱、动效引擎、导出 PPTX）由 DeckStage 提供。
---

# deck-html

写一份技术分享演示稿。**稿子只写内容，放映能力由 DeckStage 提供。**

无构建、无 npm、不联网。一份稿子就是一个目录：

```
<稿子目录>/
├── index.html        页面：这份稿子的样式 + 全部 <section class="slide">
├── notes.js          台词
├── deck.config.js    可选：台阶条、背景光斑、导出元信息、渐变文字降级
└── assets/           图片素材
```

`index.html` 固定引用两行内核，其余全是内容：

```html
<link rel="stylesheet" href="/_deckstage/deck.css">   <!-- head 里，在稿子自己的样式之前 -->
...
<script src="notes.js"></script>
<script src="/_deckstage/deck.js"></script>           <!-- body 末尾，在稿子自己的脚本之前 -->
```

`/_deckstage/` 由 DeckStage 的内置服务提供，所以稿子要用 DeckStage 放映（双击 `index.html` 打不开）。要发给没装 DeckStage 的人，在稿库里「导出 ZIP」，包里有一份能直接用浏览器打开的版本。

## DeckStage 提供什么（稿子不用写）

| 能力 | 稿子要做的 |
|---|---|
| 固定画布等比缩放、翻页、页码、圆点、进度条 | 每页一个 `<section class="slide" data-t="唯一名字">` |
| 演讲者窗口：台词、计时、上下页预览、目录、光点划线 | 台词写在 `notes.js`，key = `data-t` |
| 双屏同步、投屏、手机遥控、黑屏 | 无 |
| 素材自动装载（图在就显示，不在留占位框） | 图位写 `.imgslot[data-src]` / `[data-avatar]` |
| 图片灯箱（点图放大，观众屏同步） | 无 |
| 入场动画 `.an` + `.d1`~`.d16` | 加类名 |
| 动效引擎：逐条出现、打字、数字滚动 | 加 `data-seq` / `data-type` / `data-count`，见 `references/effects.md` |
| 页内交互同步到观众屏 | 可点击区块外层加 `data-sync`，见 `references/deckstage.md` |
| 页脚台阶条（讲到第几段） | `deck.config.js` 的 `rail` |
| 导出 PPTX、ZIP、稿库预览 | 渐变文字登记 `gradientText` |

配色、字体、排版、卡片、图表、专属动效——**全部由稿子自己写**，这个 skill 不规定风格。

## 新建一份稿子

```bash
<SKILL_DIR>/scripts/new_deck.sh "稿子标题"                # 默认建在 ~/Documents/DeckStage/<标题>/（推荐）
<SKILL_DIR>/scripts/new_deck.sh <目标目录> "稿子标题"      # 用户指定了位置时
```

**默认稿库**：`~/Documents/DeckStage/` 由 DeckStage 启动时自动建好并登记，建在这里的稿子直接出现在稿库里，不用问用户放哪、不用登记。

然后：

1. 改 `index.html` 的 `<style>` 定风格。
2. 每页写一个 `<section class="slide" data-t="...">`。
3. 每页在 `notes.js` 里配一条同名台词。
4. 跑体检，通过后执行 `<SKILL_DIR>/scripts/open_in_deckstage.sh <稿子目录>`，告诉用户「已在 DeckStage 里选中，右侧浮窗可先看目录和缩略图，回车放映」。

## 体检

**每次改完都要跑，0 error 才算完。不要自己截图逐页看。** 单文件稿、拆分稿都用同一个脚本：

```bash
python3 <SKILL_DIR>/scripts/check_deck.py <稿子目录>
python3 <SKILL_DIR>/scripts/check_deck.py <稿子目录> --strict   # warn 也计入失败
```

会挡住的（error）：内核没引用、本地文件缺失、加载顺序错、`data-t` 缺失或重复、台词与 `data-t` 对不上、渐变文字没登记导出降级、`.dN` 越界、`rail.map` 指向不存在的页、include 片段不存在。

只提示的（warn）：素材文件不在、写死的 `<img src>`、幻灯里带 `id=`、台词缺 `sec`、`gradientText` 登记多余、可点击内容没标 `data-sync`。

末尾打印页数和台词总时长，用来核时间预算。

## 硬约束

1. **渐变文字必须登记降级。** 用了 `background-clip:text` 就要在 `deck.config.js` 的 `gradientText` 里配纯色兜底，否则导出的 PPTX 里那行字是空白。体检会挡。
2. **图位走 `.imgslot[data-src]`，不要写死 `<img src>`。** 图没就位时占位框比空洞好看。
3. **页码、页脚、圆点不要手写**，内核按 `data-t` 算。但文案里的跨页引用（「前面那 13 个任务」）和总数（「六个工具」）是死的，增删页后要自己检查。
4. **改文案要同步改台词。** 页面上的字和 `notes.js` 是同一句话的两份拷贝，体检只能查 key。
5. **点击后会改变页面的区块要加 `data-sync`**，否则演讲者窗口点了，观众屏不会变。体检会提醒。
6. **不要自己截图逐页验证。** 跑体检 + 告诉用户改了哪几页、重点看什么。
7. **文案结构性改动先给方案。** 改配色、修错别字、补降级规则这类可以直接做。

## 按场景读文档

| 场景 | 读 |
|---|---|
| 新建稿子、改文案、加页删页、数据口径、分享前脱敏 | `references/workflow.md` |
| 页面结构、动画编排、幕间页、台阶条、图位、台词格式 | `references/authoring.md` |
| 逐条出现、打字、数字滚动；自己写专属动效的规则 | `references/effects.md` |
| 页数多，要按幕拆成多个文件 | `references/split-deck.md` |
| 内核的钩子、事件、配置字段、已踩过的雷 | `references/kernel.md` |
| 和 DeckStage 互动；页面要调本机接口（发消息按钮）；`data-sync`；远端稿库 | `references/deckstage.md`，服务模板 `assets/optional/local_service.py` |

## 文案风格

这个 skill **不规定风格**。某份稿子要沿用一套「说话方式」（平视不俯视、禁用词表、长度上限），写进**稿子目录自己的** `AGENTS.md`，不要写进 skill。

## 和 DeckStage 互动

DeckStage 不编辑稿子，新建和修改都由本 skill 完成，通过 `deckstage://` 链接互动：改完并体检通过后，`open_in_deckstage.sh` 让它在稿库里选中这份稿子。**不要加 `--play`**，除非用户明确说「现在就放」。完整说明见 `references/deckstage.md`。
