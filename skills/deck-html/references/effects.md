# 动效

## 内置的入场动画

模板自带：给元素加 `.an` + `.dN`（N = 1~16，每级 70ms），依次入场。变体 `.an.pop`（缩放）、`.an.sl`（左滑）。详见 `authoring.md`。

## 可选的动效引擎（fx）

需要「逐条出现、逐字打字、数字滚动」时，启用可选引擎，不改内核：

1. 把 `assets/optional/fx.js`、`fx.css` 复制到稿子目录
2. `index.html` 的 `<head>` 里加 `<link rel="stylesheet" href="fx.css">`
3. 在 `deck.js` 之后加 `<script src="fx.js"></script>`

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
- 缩略图（克隆体没有 `data-t`）和导出 PPTX（`body.exporting`）直接显示终态，不用另外处理
- `.an/.dN` 和 `.q` 可以在同一份稿子里混用，但同一个元素只用其中一种

## 自己写专属动效

专属动效（环形轨道、柱图生长、联动开关……）写在稿子自己的 `css/`、`js/` 里。必须遵守两条，否则导出和缩略图会出问题：

1. **隐藏态只作用于「当前真实页面」**：选择器写成 `body:not(.exporting) .slide[data-t].on …`。缩略图克隆体没有 `data-t`、导出时有 `body.exporting`，都要直接显示终态。
2. **用了 `background-clip:text` 的渐变文字**，登记到 `deck.config.js` 的 `gradientText`。

另外：SVG 渐变 `id` 不要在多页共用同一个，隐藏页里的定义会让别页的引用画不出来，给每个实例独立编号。
