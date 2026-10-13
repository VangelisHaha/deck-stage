'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRemote, isRemote, canonical } = require('../src/ssh');

test('Windows 盘符路径按本地目录识别，不进入远端稿库', () => {
  const paths = [
    String.raw`C:\Users\wangfei.han\Documents\DeckStage`,
    'C:/Users/wangfei.han/Documents/DeckStage',
    String.raw`D:\演示稿\季度总结`,
    'd:/演示稿/季度总结',
    String.raw`Z:\Shared Decks\slides`,
    'C:\\',
    'C:',
    'C:slides',
    '  C:/Users/example/Documents/DeckStage  '
  ];
  for (const input of paths) {
    assert.equal(parseRemote(input), null, input);
    assert.equal(isRemote(input), false, input);
  }
});

test('UNC 和 macOS / Linux 路径按本地目录识别', () => {
  for (const input of [
    String.raw`\\server\share\DeckStage`,
    '//server/share/DeckStage',
    String.raw`\\?\C:\Users\example\DeckStage`,
    '/Users/example/Documents/DeckStage',
    '/data/decks',
    '~/Documents/DeckStage',
    './decks',
    '../decks'
  ]) {
    assert.equal(parseRemote(input), null, input);
    assert.equal(isRemote(input), false, input);
  }
});

test('SSH 地址保留解析、规范化和再次解析能力', () => {
  const cases = [
    ['user@server:/data/decks', { user: 'user', host: 'server', port: '', path: '/data/decks' }],
    ['server:/data/decks', { user: '', host: 'server', port: '', path: '/data/decks' }],
    ['server:~/decks/', { user: '', host: 'server', port: '', path: '~/decks' }],
    ['server:decks', { user: '', host: 'server', port: '', path: '~/decks' }],
    ['ssh://user@server:2222/data/decks', { user: 'user', host: 'server', port: '2222', path: '/data/decks' }],
    ['ssh://server/~/decks', { user: '', host: 'server', port: '', path: '~/decks' }],
    ['ssh://server', { user: '', host: 'server', port: '', path: '/' }],
    ['ssh://user@[::1]:2222/data/decks', { user: 'user', host: '[::1]', port: '2222', path: '/data/decks' }],
    ['ssh://c/data/decks', { user: '', host: 'c', port: '', path: '/data/decks' }],
    ['user@c:/data/decks', { user: 'user', host: 'c', port: '', path: '/data/decks' }]
  ];
  for (const [input, expected] of cases) {
    assert.deepEqual(parseRemote(input), expected, input);
    assert.equal(isRemote(input), true, input);
    assert.deepEqual(parseRemote(canonical(expected)), expected, input);
  }
});
