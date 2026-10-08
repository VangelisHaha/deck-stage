# 大稿子的拆分

单文件（一个 `index.html` 装全部页面）在页数多时，每次修改都要读很多上下文。
超过十几页、或者有多幕内容时，按「幕」拆开：改哪一幕只读哪个文件。

## 结构

```
稿子目录/
├── index.html          外壳：样式引用、按顺序 include 每一幕、脚本加载顺序。基本不用改
├── deck.config.js      台阶条、导出降级（可选）
├── notes.js            台词入口：定义 __NOTES 与 __note()
├── css/                样式按职责拆（主题与排版 / 组件 / 专属动效）
├── js/                 稿子专属脚本（专属动效、交互按钮）
├── acts/               每幕一个 HTML 片段，直接写 <section class="slide">
└── notes/              台词，与 acts/ 一一对应，key = 页面 data-t
```

## 页面：用 include 拼起来

`index.html` 的 body 里按顺序写 include 注释，DeckStage 放映时把片段原样拼进来（导出 ZIP 里的浏览器版也是拼好的）：

```html
<body>
<div id="bg"></div>

<!-- @include acts/act1.html -->
<!-- @include acts/act2.html -->

<script src="deck.config.js"></script>
<script src="notes.js"></script>
<script src="notes/act1.js"></script>
<script src="notes/act2.js"></script>
<script src="/_deckstage/deck.js"></script>
<script src="js/fx.js"></script>
</body>
```

每个 `acts/*.html` 就是普通 HTML，开头用注释写这一幕的出处（文档、日志、代码位置），被追问时好查：

```html
<!-- 第一幕 · 事故现场
     数据来源：02-项目总结/xxx/排障/2026-09-18-xxx.md -->
<section class="slide act" data-t="第一幕">…</section>
<section class="slide" data-t="某一页">…</section>
```

规则：路径相对于引用它的文件；不能引用稿子目录外的文件；片段里还可以再 include（最多 5 层）。找不到的片段会显示成一页红字提示，体检也会报 E8。

## 台词：notes.js 提供合并函数

```js
// notes.js
window.__NOTES = {};
window.__note = function(o){ Object.assign(window.__NOTES, o); };
```

```js
// notes/act1.js
__note({

'某一页': { sec: 60, text: `
…
` },

});
```

key 要写在行首（体检按行首的 `'key': {` 识别）。

## 体检

和单文件稿是同一个脚本，它会先展开 include、合并 `index.html` 加载的全部 `notes/*.js`：

```bash
python3 <SKILL_DIR>/scripts/check_deck.py <稿子目录>
```

## 新增一幕

建 `acts/xxx.html` + `notes/xxx.js`，在 `index.html` 按顺序加一行 `<!-- @include acts/xxx.html -->` 和一行 `<script src="notes/xxx.js"></script>`，跑体检。

## 建议

在稿子目录的 `AGENTS.md` 里写一份文件结构表，让接手的 AI 知道改哪里读哪里。
