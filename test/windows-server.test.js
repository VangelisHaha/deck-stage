'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { windowsRuntime } = require('./helpers/runtime');

test('Windows 盘符根目录可放映：HTTP 能读取页面、include 和静态素材', async (t) => {
  const w = windowsRuntime(t);
  w.fs.mkdirSync('C:/acts', { recursive: true });
  w.fs.writeFileSync('C:/index.html', '<title>盘符根目录</title><!-- @include c:/acts/Intro.html -->');
  w.fs.writeFileSync('C:/acts/intro.html', '<section class="slide">第一幕</section>');
  w.fs.writeFileSync('C:/notes.js', 'window.__NOTES = {};');
  const { startServer } = w.load(require.resolve('../src/server'));
  const server = await startServer('C:\\', 0);
  try {
    const page = await fetch(server.origin + '/index.html');
    assert.equal(page.status, 200);
    assert.ok((await page.text()).includes('第一幕'));
    const notes = await fetch(server.origin + '/notes.js');
    assert.equal(notes.status, 200);
    assert.ok((await notes.text()).includes('__NOTES'));
  } finally { await server.close(); }
});

test('Windows 路径越界仍被拒绝，include 清单不会读取目录外的片段', async (t) => {
  const w = windowsRuntime(t);
  w.fs.mkdirSync('C:/DeckStage', { recursive: true });
  w.fs.writeFileSync('C:/DeckStage/index.html', '<!-- @include ../private.html -->');
  w.fs.writeFileSync('C:/private.html', '外部内容');
  const reads = [];
  const observedFs = { ...w.fs, readFileSync: (file, ...args) => { reads.push(file); return w.fs.readFileSync(file, ...args); } };
  const { readPage, includesOf } = w.load(require.resolve('../src/kernel'), { fs: observedFs });
  assert.ok(readPage('C:/DeckStage/index.html', 'C:/DeckStage').includes('越界，已忽略'));
  assert.deepEqual(includesOf('C:/DeckStage/index.html', 'C:/DeckStage'), []);
  assert.equal(reads.some((file) => file.toLowerCase().replace(/\\/g, '/') === 'c:/private.html'), false);
  const { startServer } = w.load(require.resolve('../src/server'));
  const server = await startServer('C:/DeckStage', 0);
  try {
    const response = await fetch(server.origin + '/..%5cprivate.html');
    assert.equal(response.status, 403);
    assert.equal(await response.text(), 'Forbidden');
  } finally { await server.close(); }
});

test('Windows 后台服务的脚本指纹能识别大小写不同的本地路径', (t) => {
  const w = windowsRuntime(t);
  w.fs.mkdirSync('C:/DeckStage', { recursive: true });
  w.fs.writeFileSync('C:/DeckStage/service.py', '第一版');
  const { fingerprint } = w.load(require.resolve('../src/services'));
  const services = [{ name: '测试服务', command: ['python3', 'c:/deckstage/service.py'], health: '' }];
  const before = fingerprint('C:/DeckStage', services);
  w.fs.writeFileSync('C:/DeckStage/service.py', '第二版');
  assert.notEqual(fingerprint('C:/DeckStage', services), before);
});
