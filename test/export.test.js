'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { loadModule, windowsRuntime } = require('./helpers/runtime');

test('真实 ZIP 导出包含浏览器版与内容，过滤版本库和依赖文件', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'deckstage-export-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, '季度总结');
  for (const dir of ['acts', '.git', 'node_modules/pkg']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.html'), '<title>季度总结</title><!-- @include acts/a.html --><script src="/_deckstage/deck.js"></script>');
  fs.writeFileSync(path.join(root, 'notes.js'), 'window.__NOTES = {};');
  fs.writeFileSync(path.join(root, 'acts', 'a.html'), '<section class="slide">第一幕</section>');
  fs.writeFileSync(path.join(root, '.git', 'config'), '排除');
  fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'index.js'), '排除');
  const { exportZip } = loadModule(require.resolve('../src/export'), { electron: {} });
  const dest = path.join(temp, '稿子.zip');
  await exportZip(root, dest);
  const zip = new AdmZip(dest);
  const names = zip.getEntries().map((entry) => entry.entryName);
  assert.ok(names.includes('季度总结/notes.js'));
  assert.ok(names.includes('季度总结/_deckstage/deck.js'));
  assert.equal(names.some((name) => /(?:^|\/)(?:\.git|node_modules)(?:\/|$)/.test(name)), false);
  const html = zip.readAsText('季度总结/浏览器打开.html');
  assert.ok(html.includes('第一幕'));
  assert.ok(html.includes('src="_deckstage/deck.js"'));
});

test('Windows ZIP 过滤识别反斜杠路径，不把 .git 和 node_modules 打进分享包', async (t) => {
  const w = windowsRuntime(t);
  const root = 'C:/DeckStage';
  w.fs.mkdirSync(root, { recursive: true });
  w.fs.writeFileSync(root + '/index.html', '<title>测试</title>');
  const names = [String.raw`稿子\.git\config`, String.raw`稿子\node_modules\pkg\index.js`,
    '稿子/.git/config', '稿子/node_modules/pkg/index.js', String.raw`稿子\notes.js`, String.raw`稿子\acts\a.html`];
  let accepted;
  class Zip {
    addLocalFolder(_root, _base, filter) { accepted = names.filter(filter); }
    addFile() {}
    addLocalFile() {}
    async writeZipPromise() {}
  }
  const { exportZip } = w.load(require.resolve('../src/export'), { 'adm-zip': Zip });
  await exportZip(root, 'C:/export.zip');
  assert.deepEqual(accepted, [String.raw`稿子\notes.js`, String.raw`稿子\acts\a.html`]);
});
