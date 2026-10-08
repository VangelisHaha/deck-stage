'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { kernelFile, readPage, includesOf, KERNEL_DIR } = require('../src/kernel');
const { startServer } = require('../src/server');

function deck() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-'));
  fs.mkdirSync(path.join(dir, 'acts'));
  fs.writeFileSync(path.join(dir, 'index.html'),
    '<body>\n<!-- @include acts/a.html -->\n<!-- @include acts/missing.html -->\n<!-- @include ../escape.html -->\n</body>');
  fs.writeFileSync(path.join(dir, 'acts', 'a.html'), '<section class="slide" data-t="甲"></section>\n<!-- @include b.html -->');
  fs.writeFileSync(path.join(dir, 'acts', 'b.html'), '<section class="slide" data-t="乙"></section>');
  fs.writeFileSync(path.join(dir, 'notes.js'), 'window.__NOTES={}');
  return dir;
}

test('kernelFile 只映射内核目录里的文件', () => {
  assert.strictEqual(kernelFile('/_deckstage/deck.js'), path.join(KERNEL_DIR, 'deck.js'));
  assert.strictEqual(kernelFile('/_deckstage/lib/html2canvas.min.js'), path.join(KERNEL_DIR, 'lib', 'html2canvas.min.js'));
  assert.strictEqual(kernelFile('/index.html'), null);
  assert.strictEqual(kernelFile('/_deckstage/../package.json'), null);
});

test('readPage 展开嵌套 include，缺失和越界的片段不会读到稿子外面', () => {
  const dir = deck();
  const html = readPage(path.join(dir, 'index.html'), dir);
  assert.match(html, /data-t="甲"/);
  assert.match(html, /data-t="乙"/); // 片段里的路径相对片段自己
  assert.match(html, /找不到 acts\/missing\.html/);
  assert.match(html, /越界，已忽略：\.\.\/escape\.html/);
  assert.deepStrictEqual(includesOf(path.join(dir, 'index.html'), dir).map((f) => path.relative(dir, f)).sort(),
    ['acts/a.html', 'acts/b.html', 'acts/missing.html']);
});

test('静态服务：/_deckstage/ 指向内核，HTML 页面先展开 include', async () => {
  const dir = deck();
  const srv = await startServer(dir, 0);
  try {
    const js = await fetch(`${srv.origin}/_deckstage/deck.js`);
    assert.strictEqual(js.status, 200);
    assert.match(await js.text(), /DeckStage 放映内核/);
    const page = await (await fetch(`${srv.origin}/index.html`)).text();
    assert.match(page, /data-t="乙"/);
    assert.doesNotMatch(page, /@include acts\/a\.html/);
    assert.strictEqual((await fetch(`${srv.origin}/notes.js`)).status, 200);
    assert.strictEqual((await fetch(`${srv.origin}/../../etc/passwd`)).status, 404);
  } finally {
    await srv.close();
  }
});
