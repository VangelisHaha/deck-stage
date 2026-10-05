# 大稿子的拆分

默认的单文件结构（一个 `index.html` 装全部页面）在页数多时会让每次修改都要读很多上下文。
超过十几页、或者有多幕内容时，按「幕」拆开：改哪一幕只读哪个文件。

## 结构

```
稿子目录/
├── index.html          外壳：舞台、加载顺序。基本不用改
├── deck.css / deck.js  内核，固定层，不要改
├── deck.config.js      画布、频道、台阶条、导出降级
├── notes.js            台词入口：定义 __NOTES 与 __note()
├── css/                样式按职责拆（主题与排版 / 组件 / 动效）
├── js/                 稿子专属脚本（动效引擎、交互按钮）
├── acts/               每幕一个文件，__act(`<section…>`) 追加页面
└── notes/              台词，与 acts/ 一一对应，key = 页面 data-t
```

## 两个小约定

`index.html` 里 `#slides` 留空，加载 `acts/*.js` 之前定义追加函数：

```html
<div id="slides"></div>
<script>
window.__act = function(html){
  document.getElementById('slides').insertAdjacentHTML('beforeend', html);
};
</script>
<script src="acts/act1.js"></script>
<script src="acts/act2.js"></script>
```

每个 `acts/*.js` 形如：

```js
__act(`
<section class="slide" data-t="某一页">…</section>
<section class="slide" data-t="另一页">…</section>
`);
```

`notes.js` 提供合并函数，`notes/*.js` 各自调用：

```js
// notes.js
window.__NOTES = {};
window.__note = function(o){ Object.assign(window.__NOTES, o); };
// notes/act1.js
__note({ '某一页': { sec: 60, text: `…` } });
```

**加载顺序**：`acts/*.js` 在 `deck.js` 之前（内核启动时要扫到全部页面）；`deck.config.js` → `notes.js` → `notes/*.js` → 导出库 → `deck.js` → 稿子专属脚本。

## 体检

`check_deck.py` 只认单文件结构。拆分稿用：

```bash
python3 <SKILL_DIR>/scripts/check_split.py <稿子目录>
```

它把 `acts/`、`notes/`、`css/` 拼回单文件放进临时目录，再交给 `check_deck.py`，规则一条不少。

## 新增一幕

建 `acts/xxx.js` + `notes/xxx.js`，在 `index.html` 按顺序各加一行 `<script>`，跑 `check_split.py`。

## 建议

- 每个 `acts/*.js` 文件头写这一幕内容的出处（文档、日志、代码位置），被追问时好查。
- 在 `AGENTS.md` 里写一份文件结构表，让接手的 AI 知道改哪里读哪里。
