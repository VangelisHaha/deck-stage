# 第三方库

导出 PPTX 依赖的两个库，随 DeckStage 内核分发，导出时才按需加载，不联网、不装依赖。

| 文件 | 库 | 版本 | 许可证 |
|---|---|---|---|
| `html2canvas.min.js` | [html2canvas](https://github.com/niklasvh/html2canvas) | 1.4.1 | MIT |
| `pptxgen.bundle.js` | [PptxGenJS](https://github.com/gitbrent/PptxGenJS) | 3.12.0 | MIT |

## 要换版本的话

html2canvas 换大版本要重新验一遍导出：它对 CSS 的支持面是这套框架最脆的一环，
已知渲染不了 `background-clip:text`（所以才有 `gradientText` 那套降级机制）。
换完在稿库里导出一份示例稿的 PPTX，抽查渐变文字那几页有没有变空白。
