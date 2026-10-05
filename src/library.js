'use strict';
// 稿库扫描：在登记的根目录里找稿子（index.html + deck.config.js），最多下钻 4 层。
const fs = require('fs');
const path = require('path');
const { isDeckDir, readDeckTitle, deckLabel, latestMtime, formatTime } = require('./util');

const SKIP = new Set(['node_modules', '.git', 'lib', 'assets', 'dist']);
const MAX_DEPTH = 4;

function scanRoots(roots) {
  const seen = new Set();
  const decks = [];

  function walk(rootLabel, rootDir, dir, depth) {
    if (isDeckDir(dir)) {
      if (!seen.has(dir)) {
        seen.add(dir);
        const mtime = latestMtime(dir);
        const rel = path.relative(rootDir, dir).replace(/(^|\/)(slides|deck|dist)$/i, '');
        decks.push({
          dir,
          root: rootDir,
          group: rootLabel,
          title: readDeckTitle(dir),
          name: deckLabel(dir),
          mtime,
          mtimeText: formatTime(mtime),
          rel
        });
      }
      return; // 稿子内部不再下钻
    }
    if (depth >= MAX_DEPTH) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP.has(e.name)) continue;
      walk(rootLabel, rootDir, path.join(dir, e.name), depth + 1);
    }
  }

  for (const root of roots) walk(path.basename(root), root, root, 0);
  return decks.sort((a, b) => b.mtime - a.mtime);
}

module.exports = { scanRoots };
