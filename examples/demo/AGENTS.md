# AGENTS.md

这是 DeckStage 自带的**示例稿**，用来展示动效、演讲者视图、遥控与导出。用户看完会自己删除，不要在它上面做正式内容。

- 内容与实现：`index.html`（页面 + 样式）+ `notes.js`（台词）；放映内核和动效引擎由 DeckStage 提供
- 改动后跑体检：`python3 <SKILL_DIR>/scripts/check_deck.py .`，0 error 才算完
- 页面上的字改了，同步 `notes.js`
- 新建正式稿子请用 deck-html skill 的 `new_deck.sh`，不要复制这份
