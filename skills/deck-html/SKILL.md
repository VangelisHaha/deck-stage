---
name: deck-html
description: 用固定的 HTML 放映框架做技术分享演示稿。用户说“做一份演示稿/PPT”“搭个分享稿框架”“新建 slides”“加一页”“改台词”“导出 PPTX”“演讲者视图”“体检一下这份稿子”“check deck”时使用。框架固定（单页 http 放映、双屏演讲者视图、台词计时、素材自动装载、图片灯箱、导出 PPTX），风格每份稿子自定。
---

# deck-html

一份技术分享演示稿的固定骨架。**框架固定，风格自由。**

无构建、无 npm、无框架、不联网。一个 `index.html` 加几个同目录文件，改完刷新浏览器就生效。导出 PPTX 用的两个库已经打在模板里。

抽自一份讲完过的一小时部门分享稿，现场经过双屏、投影、临场跳页、导出 PPTX 的检验。

## 固定的是什么

| 能力 | 说明 |
|---|---|
| 单页放映 | 固定 1600×900 画布等比缩放，键盘 / 点屏幕左右 / 圆点导航 / `F` 全屏 |
| 演讲者视图 | `?notes=1` 开小屏：台词、总计时、本页用时 vs 建议时长（超 80% 变黄、超时变红）、全页缩略预览条 |
| 双屏同步 | BroadcastChannel + localStorage 兜底，主屏小屏双向同步。连不上会自己解释原因（同源、后台降频） |
| 台词分离 | 台词在 `notes.js`，key 是各页 `data-t`，增删页不错位 |
| 素材自动装载 | 图丢进 `assets/` 就自动显示，不在则保留虚线占位框。不用改 HTML，也不会留空洞 |
| 图片灯箱 | 点图放大，滚轮锚点缩放、拖拽平移、双击切换、Esc 关闭 |
| 导出 PPTX | 逐页 html2canvas 截图铺进 16:9，版式 100% 还原（代价：文字不可编辑） |
| 页脚台阶条 | 可选。用幕间页驱动「讲到整体第几段了」的指示器，增删页自动重算 |

## 不固定的是什么

配色、字体、字号、背景、卡片、栅格、表格、图表、动效编排——全部在每份稿子自己的 `<style>` 和末尾 `<script>` 里写。**风格不由这个 skill 决定。**

## 文件分工

```
<稿子目录>/
├── index.html        骨架 + 这份稿子的 <style> + 全部 <section class="slide">
├── deck.css          框架样式（固定层，别改）
├── deck.js           放映内核（固定层，别改）
├── deck.config.js    这份稿子的配置：画布、频道、导出元信息、台阶条、渐变文字降级
├── notes.js          台词
├── serve.sh          起 http 服务
├── lib/              html2canvas 1.4.1 + PptxGenJS 3.12.0（均 MIT，已随模板打包）
└── assets/           图片素材
```

改 `deck.css` / `deck.js` 等于改所有稿子，**除非是修框架 bug，否则不要动**。稿子专属逻辑写在 `index.html` 末尾的 `<script>` 里。

## 新建一份稿子

```bash
<SKILL_DIR>/scripts/new_deck.sh <目标目录> "稿子标题"
```

脚本自己推算模板位置，所以这个 skill 放在哪都能跑。它会拷模板、建 `assets/`、把 `DECK_TITLE` / `DECK_SLUG` 占位符换成真实值（`DECK_SLUG` 用于 BroadcastChannel 频道名，纯中文标题会退回时间戳），并打印下一步。

然后：

1. 改 `index.html` 的 `<style>` 定风格。
2. 每页写一个 `<section class="slide" data-t="...">`。
3. 每页在 `notes.js` 里配一条同名台词。
4. 跑体检，再开浏览器看。

## 体检

**每次改完稿子都要跑，不要靠自己截图逐页看。**

```bash
python3 <SKILL_DIR>/scripts/check_deck.py <稿子目录>
python3 <SKILL_DIR>/scripts/check_deck.py <稿子目录> --strict   # warn 也计入失败
```

会挡住的（error）：文件缺失、加载顺序错、`data-t` 缺失或重复、`notes.js` 与页面 `data-t` 不匹配、**渐变文字没登记导出降级**、`.dN` 越界、`rail.map` 指向不存在的页、导出库缺失。

只提示的（warn）：素材文件不在、写死的 `<img src>`、幻灯里带 `id=`、台词缺 `sec`、`channel` 还是模板默认值、`gradientText` 登记多余。

末尾打印页数和台词总时长，用来核时间预算。

导出链路还能自检（要浏览器读 `document.title`）：

```
http://127.0.0.1:8899/index.html?selftest=1
→ title 变成 SELFTEST h2c=true | pptx=true | canvas=... | OK
```

## 放映

```bash
cd <稿子目录> && ./serve.sh        # 默认 8899，可传参改
```

- 观众视图 `http://127.0.0.1:8899/index.html`，主屏按 `F` 全屏
- 演讲者视图**从观众视图右上角「⧉ 演讲者视图」按钮打开**，别手敲地址——`127.0.0.1` 和局域网 IP 不同源，握不上手
- 导出 PPTX 也必须走 http，`file://` 下 canvas 跨域污染会导致导出失败

## 硬约束

1. **不要双击打开 `index.html`。** `file://` 下导出必失败、双屏同步必失败。
2. **渐变文字必须登记降级。** 用了 `background-clip:text` 就要在 `deck.config.js` 的 `gradientText` 里配纯色兜底，否则导出的 PPTX 里那行字是空白。体检会挡。
3. **图位走 `.imgslot[data-src]`，不要写死 `<img src>`。** 图没就位时占位框比空洞好看，也不用改 HTML。
4. **页码不要手写。** 页脚页码、圆点、台阶条都是 `deck.js` 按 `data-t` 动态算的。但文案里的跨页引用（「前面那 13 个任务」「刚才那张表」）和总数（「六个工具」）是死的，增删页后要自己检查。
5. **改文案要同步改台词。** 页面上的字和 `notes.js` 是同一句话的两份拷贝。体检只能查 key 对不对，查不了内容一致。
6. **不要自己截图逐页验证。** 改完跑体检 + 告诉用户改了哪几页要重点看什么，让他自己开浏览器。截图核对既慢又容易把服务搞崩。
7. **文案结构性改动先给方案。** 改配色、修错别字、补降级规则这类可以直接做。

## 更多

- `references/authoring.md` — 页面结构、动画编排、幕间页、台阶条、图位、台词格式、改页数要复查什么
- `references/kernel.md` — 内核契约、对外钩子、配置字段、加载顺序、已踩过的雷
- `assets/template/lib/README.md` — 第三方库版本与许可证

## 文案风格

这个 skill **不规定风格**。如果某份稿子要沿用一套「说话方式」（平视不俯视、禁用词表、禁用句式、长度上限），把那份约定写进**稿子目录自己的** `AGENTS.md`，不要写进这个 skill——不同场合的稿子风格不该互相绑死。

## 配合 DeckStage 放映（macOS）

DeckStage 是放映这类稿子的 Mac 应用：无浏览器地址栏、双屏、演讲者视图、投屏友好。它不编辑稿子，新建和修改都由本 skill 完成，两者通过 `deckstage://` 链接互动。**没装 DeckStage 的机器忽略本节，`serve.sh` 照常可用。**

| 场景 | 做法 |
|---|---|
| 新稿子放哪 | DeckStage 已登记的稿库目录里（目录列表在配置文件 `~/Library/Application Support/DeckStage/config.json` 的 `roots`）。没有合适目录先问用户 |
| 登记新目录 | 用户同意后：`open "deckstage://add-root?path=<绝对路径，URL 编码>"` |
| 稿子改完 | 先体检，通过后：`open "deckstage://open?path=<稿子目录，URL 编码>"`。只会在稿库里选中，不会自动开始放映 |
| 装好 skill 后回报 | `open "deckstage://skill-installed?agent=<你的名字>"` |

约束：

1. 不要加 `play=1` 让 DeckStage 直接开始放映，除非用户明确说「现在就放」。放映会占用外接屏和投影。
2. 路径必须 URL 编码（中文、空格都要）。
3. 放映中的修改用「清缓存并重载」（⌘R）生效，或在 DeckStage 菜单里开「文件变更自动刷新」。
