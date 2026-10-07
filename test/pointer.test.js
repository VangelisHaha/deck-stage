'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_POINTER, POINTER_STYLES, POINTER_SIZES, normalizePointer, pointerCatalog } = require('../src/pointer');

test('投屏光标默认使用 macOS 黑箭头和小号', () => {
  assert.deepEqual(DEFAULT_POINTER, { style: 'mac', size: 'small' });
  assert.deepEqual(normalizePointer(), DEFAULT_POINTER);
});

test('投屏光标只接受已登记的样式和大小', () => {
  assert.deepEqual(normalizePointer({ style: 'league', size: 'large' }), { style: 'league', size: 'large' });
  assert.deepEqual(normalizePointer({ style: 'unknown', size: 'huge' }), DEFAULT_POINTER);
});

test('十种光标和三档大小都有可渲染预览', () => {
  assert.deepEqual(POINTER_STYLES.map((x) => x.id), ['windows', 'mac', 'hand', 'league', 'warcraft', 'neon', 'laser', 'ring', 'crosshair', 'pen']);
  assert.deepEqual(POINTER_SIZES.map((x) => x.id), ['small', 'medium', 'large']);
  const catalog = pointerCatalog();
  assert.equal(catalog.styles.length, 10);
  for (const style of catalog.styles) {
    assert.ok(style.layers.length > 0);
    for (const size of POINTER_SIZES) assert.match(style.previews[size.id], /^data:image\/svg\+xml/);
  }
});

test('每种光标的指尖都落在画布内', () => {
  for (const style of POINTER_STYLES) {
    assert.ok(style.tip[0] >= 0 && style.tip[0] <= style.viewBox, style.id);
    assert.ok(style.tip[1] >= 0 && style.tip[1] <= style.viewBox, style.id);
  }
});
