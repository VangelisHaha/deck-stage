'use strict';
// 配套 skill 的位置，以及「安装提示词」。提示词由 App 按当前机器的真实路径生成，复制给任意 Agent 即可。
const path = require('path');
const { app } = require('electron');

const SKILL_NAME = 'deck-html';

function skillsRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'skills')
    : path.join(app.getAppPath(), 'skills');
}

function skillDir() { return path.join(skillsRoot(), SKILL_NAME); }

function installPrompt({ roots, defaultRoot }) {
  const dir = skillDir();
  const rootList = roots.length ? roots.map((r) => `- ${r}`).join('\n') : '- （还没有登记，见第 4 步）';
  return `请帮我安装 DeckStage 配套的 skill「${SKILL_NAME}」，并和 DeckStage 联动。DeckStage 是我电脑上放映 HTML 演示稿的 Mac 应用。

1. 安装 skill
把这个目录整个复制到你自己的 skills 目录（目录名保持 ${SKILL_NAME}）：
${dir}
- Claude Code：~/.claude/skills/
- Codex：~/.codex/skills/
- 其他 Agent：用它自己的 skills 目录
已存在同名目录时，先对比差异再覆盖，不要直接删除。旧版 skill 的模板里带 deck.js / deck.css / lib/，新版不再需要（放映内核由 DeckStage 提供），以这一版为准。

2. 确认可用
读一遍 ${SKILL_NAME}/SKILL.md，再运行：
python3 <skill 目录>/scripts/check_deck.py --help

3. 以后怎么用
我说「做一份演示稿」「加一页」「改台词」「体检」时，用这个 skill。改完稿子必须先跑体检，通过后再让我看。

4. 稿子放哪里
默认稿库（DeckStage 每次启动都会确保它存在并登记）：
${defaultRoot || '~/Documents/DeckStage'}
新稿子默认建在这里：new_deck.sh "稿子标题"（不带目录参数）就会建到这儿，不用问我放哪、不用再登记目录。

DeckStage 当前已登记的全部稿库目录：
${rootList}
只有我明确指定了别的位置才建到别处。要用新的目录，先问我，我同意后执行：
open "deckstage://add-root?path=<目录绝对路径，需 URL 编码>"
稿库里形如 ssh://user@host/路径 的是远端目录（稿子在另一台机器上）：DeckStage 放映和导出前会用 rsync 同步到本机，你在远端机器上建稿、改稿即可。登记不需要密码的远端目录同样用 add-root，path 填 ssh://user@host/绝对路径（需 URL 编码）。涉及密码的，不要碰：让我在稿库里点「添加远端目录」自己填，密码绝不能写进链接、命令或文件。
如果你自己就跑在远端机器上，没法执行本机的 open 命令，请让我在稿库里点「添加远端目录」，你只管把稿子建在那个目录下。

5. 在 DeckStage 里打开
稿子改完、体检通过后，执行：
<skill 目录>/scripts/open_in_deckstage.sh <稿子目录>
DeckStage 会在稿库里选中这份稿子（不会自动开始放映；稿子不在稿库里时会自动登记它所在的目录）。然后告诉我：「已在 DeckStage 里选中，右侧浮窗可先看目录和缩略图，回车放映」。

6. 回报
以上都装好后，执行下面的命令告诉 DeckStage 你已就绪（agent 填你自己的名字，如 claude-code、codex）：
open "deckstage://skill-installed?agent=<你的名字>"
`;
}

module.exports = { SKILL_NAME, skillsRoot, skillDir, installPrompt };
