'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModule } = require('./helpers/runtime');
const paths = require('../src/paths');
const win = loadModule(require.resolve('../src/paths'), {
  path: path.win32, os: { homedir: () => String.raw`C:\Users\Test` }
});

test('Windows 同一目录允许大小写、分隔符和末尾斜杠不同', () => {
  assert.equal(win.samePath(String.raw`C:\Users\Test\DeckStage`, 'c:/users/test/deckstage/'), true);
  assert.equal(win.samePath(String.raw`\\SERVER\Share\DeckStage`, '//server/share/deckstage/'), true);
  assert.equal(win.samePath('C:/DeckStage', 'D:/DeckStage'), false);
  const posix = loadModule(require.resolve('../src/paths'), { path: path.posix });
  assert.equal(posix.samePath('/decks/A', '/decks/a'), false);
});

test('目录包含关系覆盖盘符根目录、UNC、大小写、同名前缀和越界', () => {
  assert.equal(win.isPathInside('C:\\', 'C:/slides/index.html'), true);
  assert.equal(win.isPathInside('C:/DeckStage/', 'c:/deckstage/slides'), true);
  assert.equal(win.isPathInside('C:/DeckStage', 'C:/DeckStage'), true);
  assert.equal(win.isPathInside('//server/share/', '//SERVER/SHARE/deck'), true);
  assert.equal(win.isPathInside('C:/DeckStage', 'C:/DeckStage-other/slides'), false);
  assert.equal(win.isPathInside('C:/DeckStage', 'C:/DeckStage/../private'), false);
  assert.equal(win.isPathInside('C:/DeckStage', 'D:/DeckStage/slides'), false);
  assert.equal(win.isPathInside('//server/share/', '//server/other/deck'), false);
  assert.equal(paths.isPathInside('/tmp/decks', '/tmp/decks-other'), false);
});

test('Windows 家目录支持 ~/ 与反斜杠写法', () => {
  assert.equal(win.expandHome(String.raw`~\Documents\DeckStage`), String.raw`C:\Users\Test\Documents\DeckStage`);
  assert.equal(win.expandHome('~/Documents/DeckStage'), String.raw`C:\Users\Test\Documents\DeckStage`);
  assert.equal(win.expandHome('~other/decks'), '~other/decks');
});

test('稿库显示路径去掉末尾 slides，Windows 和远端 POSIX 结果一致', () => {
  assert.equal(win.deckRelativePath('C:/DeckStage', 'C:/DeckStage/季度总结/slides'), '季度总结');
  assert.equal(win.deckRelativePath('C:/DeckStage', 'C:/DeckStage/slides'), '');
  assert.equal(win.deckRelativePath('/decks', '/decks/季度总结/slides', path.posix), '季度总结');
});
