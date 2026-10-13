'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fileURLToPath } = require('node:url');
const { windowsRuntime } = require('./helpers/runtime');

test('Windows 预览缓存的图片地址可读取，中文、空格、# 和 % 正确编码', (t) => {
  const w = windowsRuntime(t);
  w.locations.userData = String.raw`C:\Users\Test\AppData\演示稿 #100%`;
  const { Previews } = w.load(require.resolve('../src/preview'));
  const previews = new Previews({});
  const dir = String.raw`C:\Users\Test\Documents\DeckStage\季度总结`;
  const base = previews.cacheDir(dir);
  w.fs.mkdirSync(base, { recursive: true });
  w.fs.writeFileSync(base + '\\meta.json', JSON.stringify({ title: '季度总结', slides: ['封面'], minutes: 1 }));
  w.fs.writeFileSync(base + '\\001.jpg', '图片占位');
  const result = previews.read(dir);
  assert.equal(result.done, true);
  const thumb = result.slides[0].thumb;
  assert.ok(thumb.startsWith('file:///C:/'));
  assert.ok(thumb.includes('%20%23100%25'));
  assert.equal(fileURLToPath(thumb, { windows: true }), base + '\\001.jpg');
});
