# 内核契约

`deck.css` + `deck.js` 是固定层。这份文档说清它俩提供什么、期望稿子提供什么、哪些地方踩过雷。

## 加载顺序（不能改）

```html
<link rel="stylesheet" href="deck.css">   <!-- head，稿子的 <style> 要在它之后 -->
...
<script>if(new URLSearchParams(location.search).has('notes'))
        document.documentElement.classList.add('pv');</script>   <!-- head 末尾 -->
...
<script src="deck.config.js"></script>
<script src="notes.js"></script>
<script src="lib/html2canvas.min.js"></script>
<script src="lib/pptxgen.bundle.js"></script>
<script src="deck.js"></script>
<script>/* 稿子专属逻辑 */</script>
```

两个关键点：

- `pv` 类必须在 `<head>` 里就打到 `<html>` 上，否则演讲者视图会闪现一帧观众视图。
- 稿子专属脚本必须在 `deck.js` **之后**。演讲者视图的缩略图是在 `setTimeout(...,0)` 里首建的，稿子里的 SVG 图表如果晚于那一刻才画，第一次建出来的克隆会是空图表；`deck.js` 已经在 `__assetsReady` 之后重建过一轮克隆，所以图片没问题，但**同步绘制的图表要在这一轮之前完成**。

## 稿子必须提供的 DOM

id 是内核的接口，不要改名：

```
#tools  #btnPV #btnPptx #btnFull        工具条
#toast                                  底部提示
#pv     .pvtop #pvNo #pvTot #pvTitle    演讲者视图顶栏
        #pvElapsed #pvPage #pvLink
        #pvPrev #pvNext #pvFold
        #pvWarn #pvBody #pvShots
#stage  #bg #prog #slides               舞台
#dots                                   圆点导航（内容由 JS 填）
#lb     #lbImg #lbPct #lbCap .bar       灯箱
```

`.footer`（页码 + 台阶条）由 `deck.js` 注入每一页，**不要手写**。封面页（`.slide.cover`）不注入。

## 对外钩子

稿子里可以用：

| 钩子 | 用途 |
|---|---|
| `window.__go(n)` | 跳到第 n 页（0 起） |
| `window.__cur()` | 当前页序号 |
| `window.__slides` | 所有 `.slide` 节点数组 |
| `window.__toast(msg, ms)` | 底部提示，`ms=0` 表示不自动消失 |
| `window.__assetsReady` | 素材装载完成的 Promise，导出前会 await 它 |
| `window.__lbOpen` | 灯箱是否开着（开着时点屏幕不翻页；翻页键会先收起灯箱再翻页） |

## 配置字段

`deck.config.js` 里的 `window.__DECK`：

| 字段 | 必填 | 说明 |
|---|---|---|
| `W` / `H` | 否 | 画布尺寸，默认 1600×900。deck.js 会写进 `--deck-w` / `--deck-h` |
| `channel` | **是** | BroadcastChannel + localStorage 的 key。同时开两份稿子必须不同，否则互相翻页 |
| `title` | 否 | 演讲者视图窗口标题后缀 |
| `pptx` | 否 | `fileName` / `layoutName` / `author` / `title` / `subject` / `bgColor` / `scale` |
| `rail` | 否 | `{ steps: [[短名, 全名], ...], map: { 幕间页 data-t: 第几级 } }`。不配则页脚只有页码 |
| `bokeh` | 否 | `[[左%, 上%, 直径px, 颜色, 一圈秒数], ...]`。不配则无光斑 |
| `gradientText` | 见下 | `[{ sel, color }]`，导出时的纯色兜底 |

### rail 是怎么算的

内核遍历所有页，遇到 `data-t` 命中 `rail.map` 的页就把当前级别切过去，之后每页沿用。所以：

- 幕间页的 `data-t` 要出现在 `map` 里
- 增删内容页不会错位，因为级别是从幕间页往后顺延的
- 改幕间页名字要同步改 `map`，体检会挡

### gradientText 为什么是必填

html2canvas 渲染不了 `background-clip: text`。用它做的渐变文字，导出的 PPTX 里**直接是空白**——不报错，就是没字。所以凡是这么写的选择器：

```css
h2.t em{
  background:linear-gradient(...);
  -webkit-background-clip:text;background-clip:text;
  -webkit-text-fill-color:transparent;
}
```

都要在 `gradientText` 里配一个纯色兜底：

```js
gradientText: [ { sel: 'h2.t em', color: '#FFC94D' } ]
```

`deck.js` 启动时会把这些规则注成 `.exporting <sel>{...}`。`check_deck.py` 会扫 CSS 里所有 `background-clip:text` 的选择器，漏登记的报 error。

这条是这份框架最容易翻车的地方——原来靠人手在 CSS 里维护 `.exporting` 块，加了新渐变元素就忘。改成配置 + 校验就管住了。

## 演讲者视图的克隆机制

预览条里当前页那一格放的是**观众舞台本体**（`#stage` 被 `insertBefore` 进去），所以永远和投影一致。其余格子是克隆节点，滚到附近才由 IntersectionObserver 填进去。

克隆时做了三件事：

1. 去掉 `data-t` —— 克隆体不参与任何脚本查询
2. 剥掉所有 `id` —— 避免 DOM 里出现重复 id
3. 关掉 `.an` 动画 —— 缩略图不重播入场

**后果：幻灯内部依赖 `id` 的逻辑（比如 `document.getElementById('trendChart')` 画的 SVG）在克隆里会失效。** 已画好的 SVG 内容会被 `cloneNode(true)` 带过去，所以静态图表没问题；但如果是「等某个事件再往 id 里塞内容」的写法，缩略图里就是空的。体检会对幻灯里的 `id=` 出 warn 提醒。

## 已踩过的雷

| 现象 | 原因 | 对策 |
|---|---|---|
| 导出 PPTX 某行字空白 | 渐变文字没降级 | 登记 `gradientText`，体检会挡 |
| 导出报跨域 / canvas 污染 | 从 `file://` 打开 | 走 `http://127.0.0.1:8899` |
| 演讲者视图一直「未连主屏」 | 两个窗口不同源 | 从观众视图按钮打开，别手敲地址 |
| 两份稿子互相翻页 | `channel` 撞了 | 每份稿子改成唯一名字 |
| 缩略图里图表是空的 | 稿子脚本晚于首次建克隆 | 同步绘制，或在 `__assetsReady` 后重画 |
| 缩略图里图位是空框 | 图片还没装载完 | 已由内核在 `__assetsReady` 后重建克隆解决 |
| 换了同名图片但页面没变 | 浏览器缓存 | 内核给 src 带了时间戳，硬刷新即可 |
| 导出到三十几页内存飙高 | canvas 没释放 | 内核已在每页后 `canvas.width = canvas.height = 0` |
| 切到后台再回来同步断了 | 浏览器降频心跳 | 回前台几秒自动恢复，翻一页立刻重连 |

## 键盘

| 键 | 作用 |
|---|---|
| `→` `↓` `PageDown` `空格` `Enter` | 下一页 |
| `←` `↑` `PageUp` | 上一页 |
| `Home` / `End` | 首页 / 末页 |
| `F` | 全屏 |
| 灯箱开着时：`Esc` 关闭、`+` `-` 缩放、`0` 复位 | 这些键在 capture 阶段被拦，不会翻页。**翻页键（方向键、PageUp/PageDown、空格、回车、Home/End）会先收起灯箱再翻页**，不会出现「点了图之后键盘没反应」 |

点屏幕左 22% / 右 22% 也能翻页；点工具条、圆点、图片、灯箱不会误翻。
