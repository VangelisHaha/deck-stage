# 动效

## 入场动画（内核自带）

给元素加 `.an` + `.dN`（N = 1~16，每级 70ms），进页时依次入场。变体 `.an.pop`（缩放）、`.an.sl`（左滑）。详见 `authoring.md`。

## 动效引擎（内核自带，直接用）

| 写法 | 效果 |
|---|---|
| 容器 `data-seq="开始ms 间隔ms"`，子元素加 `.q` | 按顺序逐条出现。`.q.left` 左滑，`.q.zoom` 缩放，`.q.fade` 只淡入 |
| `.q[data-d="ms"]` | 覆盖这一条和上一条的间隔 |
| `.q[data-add="cls"]` | 这一条出现时给所属序列容器加 `cls`，用来联动（解锁、高亮、连线） |
| `[data-type="延迟ms"]`，`data-speed` | 逐字打出；在序列里时打完才轮到下一条 |
| `[data-count="n"]` | 数字从 0 滚到 n（`data-dur` 毫秒） |
| 键盘 `R` | 重播当前页动效 |

规则：

- 嵌套序列：外层那一条出现后，里面的 `[data-seq]` 才启动
- 一个元素不要同时是 `.q` 又是 `data-seq` 容器，它本身会一直隐藏
- 演讲者窗口的上下页预览（克隆体没有 `data-t`）、导出 PPTX 和稿库预览（`body.exporting`）直接显示终态，不用另外处理
- `.an/.dN` 和 `.q` 可以在同一份稿子里混用，但同一个元素只用其中一种
- 两个窗口各自播放（翻页是同步的），不需要 `data-sync`

## 自己写专属动效

专属动效（环形轨道、柱图生长、截图轮播……）写在稿子自己的 `<style>` / `<script>` 或 `css/`、`js/` 里。规则：

1. **进页重播用 `deck:slide` 事件**（见 `kernel.md`），每次进入一页都会触发，按 `R` 也会：

   ```js
   document.addEventListener('deck:slide', function(e){
     var s = e.detail.slide;
     /* 清掉上一页的定时器，再启动这一页的 */
   });
   ```

2. **隐藏态只作用于「当前真实页面」**：选择器写成 `body:not(.exporting) .slide[data-t].on …`。预览克隆体没有 `data-t`、导出时有 `body.exporting`，都要直接显示终态。
3. **用了 `background-clip:text` 的渐变文字**，登记到 `deck.config.js` 的 `gradientText`。
4. **由点击、悬停或定时器改变的状态**（轮播到第几张、悬停浮出的大图）在两个窗口里各跑各的，要让观众屏跟着演讲者窗口：外层容器加 `data-sync`，定时器在观众窗口让位（`document.documentElement.hasAttribute('data-mirror')` 为真时不自己切）。见 `deckstage.md`。

另外：SVG 渐变 `id` 不要在多页共用同一个，隐藏页里的定义会让别页的引用画不出来，给每个实例独立编号。
