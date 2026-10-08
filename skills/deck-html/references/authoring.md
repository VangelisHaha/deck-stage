# 写页面

## 一页的结构

```html
<!-- ══════════════ 07 这一页讲什么 ══════════════ -->
<section class="slide" data-t="页面唯一名字">
  <div class="kicker an d1">Section <span class="ch">· 中文小标题</span></div>
  <h2 class="t an d1">陈述句，<em>然后是转折</em></h2>
  <p class="sub an d2">一到两行副标题。</p>
  <div class="body">
    <!-- 正文，排版随意 -->
    <div class="punch an d7" style="margin-top:18px">
      <p>这一页的落点。<small>细节放这里。</small></p>
    </div>
  </div>
</section>
```

- `data-t` 是这一页的**唯一名字**，同时是 `notes.js` 的 key、圆点提示、预览条标题。改名要同步改 `notes.js`。
- 页码、页脚台阶条由内核注入，别手写。
- `.body` 撑满剩余高度；要整体垂直居中写 `class="body vc"`。
- `.kicker` / `h2.t` / `.sub` / `.card` / `.punch` 这些**都是稿子自己的类**，模板给了一套示例，可以整套换掉。内核只认 `.slide` / `.cover` / `.body` / `.an` / `.dN` / `.footer` / `.imgslot` / `[data-avatar]` 和动效引擎的 `data-seq` / `.q` / `data-type` / `data-count`。

## 入场动画

给要依次出现的元素加 `.an` + `.dN`：

```html
<div class="card an d3">…</div>
<div class="card an d4">…</div>
```

- `.d1` ~ `.d16`，每级 70ms。超出范围体检会报 error（那个元素会没有延迟，一起蹦出来）。
- 变体：`.an.pop`（缩放入场）、`.an.sl`（左滑入场）。
- 翻页时内核会强制重排让动画重播，不用自己处理。
- 编排原则：一页最多 4~5 个层级。每张卡都单独延迟一次会显得拖沓，同组元素给同一个 `dN` 更利落。

## 封面与幕间页

封面加 `.cover`，会去掉内边距、居中、且不注入页脚：

```html
<section class="slide cover" data-t="封面"> … </section>
```

幕间页的 `data-t` 建议就叫「第一幕」「第二幕」，这样能直接被 `deck.config.js` 的 `rail.map` 引用：

```js
rail: {
  steps: [['L1','人工驾驶'],['L2','人机共驾'],['L3','有条件自动驾驶']],
  map:   { '第一幕':1, '第二幕':1, '第三幕':2, '第四幕':3, '第五幕':3 }
}
```

幕间页上常放一行 pill 预告本幕内容。**这行 pill 是手写的**，增删本幕的页之后要自己回来核对——尤其别在 pill 上写数字（「六个工具」），页面一改就对不上。写主题名比写数字耐改。

## 图片

**不要写死 `<img src>`。** 用图位，文件在就自动换成 `<img>`，不在就保留虚线框：

```html
<div class="imgslot an d4" style="flex:1"
     data-src="assets/demo-xxx.png"
     data-alt="图的说明，也是点开灯箱后的标题">
  <div class="ic">🖼</div>
</div>
```

小头像用 `data-avatar`：

```html
<div class="ph" data-avatar="assets/crew-1.png">👤</div>
```

两者都会被灯箱接管（点图放大，观众屏同步）。src 带时间戳，换同名图在 DeckStage 里 ⌘R 就能看到。

约定：文件名用语义化的固定名（`demo-群里问.png` 不如 `demo-group-ask.png`），先在 HTML 里把图位占好，图后补。

## 台词

`notes.js` 里每页一条，key 就是 `data-t`：

```js
'页面唯一名字': { sec: 90, text: `
> 三张卡片从左到右点一遍

第一段口播。写成能直接念出来的话。

第二段口播，**这几个字要重读**。

> 底部收口

落点那句话。
` },
```

- `sec` 是建议用时（秒）。演讲者视图会显示「本页用时 / 建议时长」，超 80% 变黄、超时变红。
- `> ` 开头的行是**动作提示**，渲染成绿色框，不要念出来。
- `**xx**` 是重读，小屏上高亮。
- 段落之间空一行。

台词写法上有个实用习惯：动作提示写成具体操作（「六格那一行，从左往右点一遍」）而不是抽象描述（「介绍工具」），现场照做就行。

## 页数变了要检查什么

页码、圆点、台阶条都是动态算的，不用管。但这几处是死的：

1. 幕间页的 pill（预告本幕内容）
2. 文案里的跨页引用：「前面那 13 个任务」「刚才那张表」「后面会讲到」
3. 文案里的总数：「六个工具」「三件事」——数字和实际内容对不上是最容易被当场问倒的
4. `notes.js` 里对应的台词条目
5. 如果有配套的口播底稿 / 待改清单文档，也要同步

## 数据要可核

页面上任何数字都要能说出来源和口径。宁可数字小，不能被现场问倒。

已经踩过的坑：统计本地 git commit 时，同一个 GitLab 项目在多个需求目录下有重复 clone，不按 commit SHA 去重会虚高一倍（480 vs 209）。

不确定的事就写不确定，不要为了页面完整补一个看起来合理的数字。

## 改完怎么验

```bash
python3 <SKILL_DIR>/scripts/check_deck.py <稿子目录>
<SKILL_DIR>/scripts/open_in_deckstage.sh <稿子目录>
```

体检过了再让用户自己在 DeckStage 里看。**不要自己截图逐页核对**——慢，而且容易把服务搞崩。告诉他改了哪几页、要重点看什么（比如「这一页六格并排，注意最长那个名字会不会折行」）。
