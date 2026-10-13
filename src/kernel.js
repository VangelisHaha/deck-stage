'use strict';
// 放映内核（deck.css / deck.js / 导出库）随 App 分发，稿子通过 /_deckstage/ 引用。
// 拆分稿用 <!-- @include 相对路径 --> 把分幕的 HTML 片段拼进页面，由这里展开。
// 静态服务、导出 HTML 包都走这里，规则只有一份。
const fs = require('fs');
const path = require('path');
const { samePath, isPathInside } = require('./paths');

const KERNEL_DIR = path.join(__dirname, '..', 'kernel');
const KERNEL_PREFIX = '/_deckstage/';
const INCLUDE_RE = /<!--\s*@include\s+(\S+?)\s*-->/g;
const MAX_DEPTH = 5;

// /_deckstage/xxx → 内核目录里的文件；越界或不是内核路径返回 null
function kernelFile(pathname) {
  if (!pathname.startsWith(KERNEL_PREFIX)) return null;
  const file = path.resolve(KERNEL_DIR, '.' + pathname.slice(KERNEL_PREFIX.length - 1));
  return isPathInside(KERNEL_DIR, file) && !samePath(KERNEL_DIR, file) ? file : null;
}

// 读一个 HTML 文件并展开 include。片段路径相对于引用它的文件，不能跑出稿子目录；
// 找不到的片段换成一段醒目的提示，体检也会报错。
function readPage(file, root, depth = 0) {
  const html = fs.readFileSync(file, 'utf8');
  if (depth >= MAX_DEPTH) return html;
  const base = path.resolve(root);
  return html.replace(INCLUDE_RE, (_m, rel) => {
    const target = path.resolve(path.dirname(file), rel);
    if (!isPathInside(base, target)) return `<!-- @include 越界，已忽略：${rel} -->`;
    try {
      return readPage(target, root, depth + 1);
    } catch (e) {
      return `<section class="slide" data-t="缺少片段 ${rel}"><h2 style="color:#FF5C6C">找不到 ${rel}</h2></section>`;
    }
  });
}

// 列出页面里引用的片段（体检、修改时间判断用）
function includesOf(file, root) {
  const out = [];
  const walk = (f, depth) => {
    let html = '';
    try { html = fs.readFileSync(f, 'utf8'); } catch (e) { return; }
    for (const m of html.matchAll(INCLUDE_RE)) {
      const target = path.resolve(path.dirname(f), m[1]);
      if (!isPathInside(root, target)) continue;
      out.push(target);
      if (depth < MAX_DEPTH) walk(target, depth + 1);
    }
  };
  walk(file, 0);
  return out;
}

module.exports = { KERNEL_DIR, KERNEL_PREFIX, kernelFile, readPage, includesOf };
