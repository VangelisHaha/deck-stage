# 第三方库

导出 PPTX 依赖的两个库，直接打进模板，**离线可用、不联网、不装依赖**。

| 文件 | 库 | 版本 | 许可证 |
|---|---|---|---|
| `html2canvas.min.js` | [html2canvas](https://github.com/niklasvh/html2canvas) | 1.4.1 | MIT |
| `pptxgen.bundle.js` | [PptxGenJS](https://github.com/gitbrent/PptxGenJS) | 3.12.0 | MIT |

两者都是 MIT，可以随稿子一起分发。

## 要换版本的话

html2canvas 换大版本要重新验一遍导出——它对 CSS 的支持面是这套框架最脆的一环，
已知渲染不了 `background-clip:text`（所以才有 `gradientText` 那套降级机制）。

换完必跑：

```
http://127.0.0.1:8899/index.html?selftest=1
→ title 应为 SELFTEST h2c=true | pptx=true | canvas=... | OK
```

再手动点一次「导出 PPTX」，抽查渐变文字那几页有没有变空白。
