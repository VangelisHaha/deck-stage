# 内核契约

放映内核随 DeckStage 分发，由它的内置服务挂在 `/_deckstage/` 下：`deck.css`（框架样式 + 动效样式）、`deck.js`（放映、演讲者视图、素材装载、灯箱、动效引擎、导出）。稿子里没有内核文件，**修内核是改 DeckStage，不是改稿子**。

## 稿子的固定结构

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>稿子标题</title>
<link rel="stylesheet" href="/_deckstage/deck.css">   <!-- 在稿子自己的样式之前，稿子才能覆盖它 -->
<style>/* 稿子的风格 */</style>                         <!-- 或 <link rel="stylesheet" href="css/xxx.css"> -->
</head>
<body>

<div id="bg">…可选的背景装饰…</div>

<section class="slide cover" data-t="封面">…</section>
<section class="slide" data-t="第二页">…</section>

<div id="spot"></div>                                 <!-- 可选：其他装饰层 -->

<script src="deck.config.js"></script>                 <!-- 可选 -->
<script src="notes.js"></script>
<script src="/_deckstage/deck.js"></script>
<script>/* 稿子专属脚本：图表、特效 */</script>
</body>
</html>
```

内核启动时（`deck.js` 执行的那一刻）：

- body 里所有 `<section class="slide">` 收进舞台的 `#slides`，按文档顺序就是页序；
- `#bg` 放到舞台最底层，没写就建一个空的；
- body 里其余元素（装饰层、柔光）放进舞台、在幻灯之上，跟着一起缩放；
- 生成提示 `#toast`、圆点 `#dots`、灯箱 `#lb`、演讲者视图 `#pv`，以及每页的页脚 `.footer`。

所以稿子**不要**手写 `#stage`、`#slides`、`#prog`、`#dots`、`#lb`、`#pv`、`.footer`，也不要写演讲者视图开关脚本。

加载顺序：`deck.config.js`、`notes.js`（及 `notes/*.js`）在内核之前；稿子专属脚本在内核之后（这样能直接用下面的钩子）。体检会检查。

## 对外钩子

| 钩子 | 用途 |
|---|---|
| `window.__go(n)` | 跳到第 n 页（0 起） |
| `window.__cur()` | 当前页序号 |
| `window.__slides` | 所有 `.slide` 节点数组 |
| `window.__toast(msg, ms)` | 底部提示，`ms=0` 不自动消失（观众窗口里不显示） |
| `window.__assetsReady` | 素材装载完成的 Promise |
| `window.__lbOpen` | 灯箱是否开着 |
| `deck:slide` 事件 | 每次进入一页（含按 `R` 重播）在 `document` 上触发，`e.detail = { index, slide, replay }`。打开稿子时的第一页在 DOMContentLoaded 时触发，所以稿子脚本在内核之后注册也收得到 |

专属动效用 `deck:slide` 驱动「进页重播」，不用自己去监听 class 变化：

```js
document.addEventListener('deck:slide', function(e){
  var s = e.detail.slide;     // 刚进入的这一页
  // 重置并启动这一页的动效；记得先清掉上一页留下的定时器
});
```

## 配置字段（deck.config.js，可选）

只写和默认值不同的字段：

```js
window.__DECK = {
  rail: { steps: [['01','事故现场'], ['02','结论落地']], map: { '第一幕': 1, '第二幕': 2 } },
  gradientText: [ { sel: 'h2.t em', color: '#FFC94D' } ]
};
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `W` / `H` | 1600 / 900 | 画布尺寸，写进 CSS 变量 `--deck-w` / `--deck-h` |
| `title` | `<title>` | 演讲者窗口标题、导出文件名 |
| `pptx` | 见右 | `fileName`（默认 `标题.pptx`）、`author`、`title`、`subject`、`bgColor`（默认取 `--bg0`）、`scale`（默认 1.25 ≈ 200 DPI） |
| `rail` | 无 | `{ steps: [[短名, 全名], ...], map: { 幕间页 data-t: 第几级 } }`。不配则页脚只有页码 |
| `bokeh` | 无 | `[[左%, 上%, 直径px, 颜色, 一圈秒数], ...]` 背景光斑 |
| `gradientText` | 无 | `[{ sel, color }]`，导出时的纯色兜底，见下 |

### rail 是怎么算的

内核遍历所有页，遇到 `data-t` 命中 `rail.map` 的页就把当前级别切过去，之后每页沿用。所以增删内容页不会错位；改幕间页名字要同步改 `map`，体检会挡。

### gradientText 为什么必须登记

html2canvas 渲染不了 `background-clip: text`。用它做的渐变文字，导出的 PPTX 里**直接是空白**——不报错，就是没字。凡是这么写的选择器都要配纯色兜底：

```js
gradientText: [ { sel: 'h2.t em', color: '#FFC94D' } ]
```

内核启动时把这些规则注成 `.exporting <sel>{...}`。体检会扫所有 CSS（内联和 `<link>` 的本地文件）里 `background-clip:text` 的选择器，漏登记的报 error。

## 导出模式 body.exporting

导出 PPTX 和稿库预览都会给 `body` 加 `exporting`：内核关掉所有动画、动效直接显示终态，然后逐页截图。稿子自己的动效也要遵守「`body.exporting` 下显示终态」（见 `effects.md`）。

## 演讲者窗口的上下页预览

演讲者窗口旁边的「上一页 / 下一页」是**克隆节点**：去掉 `data-t`、剥掉所有 `id`、关掉 `.an` 动画。后果：幻灯内部依赖 `id` 的效果（`document.getElementById('trendChart')` 画的 SVG 已经画好的会被带过去，没问题；「等某个事件再往 id 里塞内容」的写法在预览里就是空的）。体检会对幻灯里的 `id=` 出 warn 提醒；SVG 渐变 `id` 多页共用时，隐藏页里的定义会让别页的引用画不出来，给每个实例独立编号。

## 已踩过的雷

| 现象 | 原因 | 对策 |
|---|---|---|
| 导出 PPTX 某行字空白 | 渐变文字没降级 | 登记 `gradientText`，体检会挡 |
| 预览里图表是空的 | 稿子脚本等事件才画 | 同步绘制，或在 `__assetsReady` 后重画 |
| 演讲者窗口点了按钮，观众屏没反应 | 两个窗口是两份页面，页内状态不同步 | 外层容器加 `data-sync`（`deckstage.md`） |
| 自动轮播在两个屏幕上不同步 | 两个窗口各跑各的定时器 | 区块加 `data-sync`，并在观众窗口让位：`if(document.documentElement.hasAttribute('data-mirror')) return;` |
| 换了同名图片但页面没变 | 缓存 | 内核给 src 带了时间戳，⌘R 重载即可 |

## 键盘

| 键 | 作用 |
|---|---|
| `→` `↓` `PageDown` `空格` `Enter` | 下一页 |
| `←` `↑` `PageUp` | 上一页 |
| `Home` / `End` | 首页 / 末页 |
| `R` | 重播当前页动效 |
| 灯箱开着时：`Esc` 关闭、`+` `-` 缩放、`0` 复位 | 翻页键会先收起灯箱再翻页 |

点屏幕左 22% / 右 22% 也能翻页；点圆点、图片、灯箱不会误翻。DeckStage 自己的快捷键（`F` 全屏、`D` 换屏、`B` 黑屏、`G` 目录……）见它的 README 或演讲者窗口里的「帮助」。
