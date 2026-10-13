'use strict';
// 本地路径的公共规则。独立于稿子内核，避免各模块重复比较路径或产生循环依赖。
const os = require('os');
const path = require('path');

function expandHome(input) {
  if (!input) return input;
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || (path.sep === '\\' && input.startsWith('~\\'))) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

function resolveLocalPath(input) { return path.resolve(expandHome(input)); }

// Windows 同一路径的盘符、目录大小写和分隔符可能不同；保留原路径，只统一比较用的键。
function pathKey(input) {
  const resolved = resolveLocalPath(input);
  return path.sep === '\\' ? resolved.toLowerCase() : resolved;
}

function samePath(a, b) {
  return typeof a === 'string' && typeof b === 'string' && pathKey(a) === pathKey(b);
}

// relative 能正确处理盘符根目录、UNC、末尾斜杠和 Windows 大小写，也不会误认同名前缀的兄弟目录。
function isPathInside(root, file) {
  const rel = path.relative(resolveLocalPath(root), resolveLocalPath(file));
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

// 稿库的显示路径统一用 /；SSH 的远端路径显式传入 path.posix。
function deckRelativePath(root, dir, pathApi = path) {
  return pathApi.relative(root, dir).split(pathApi.sep).join('/').replace(/(^|\/)(slides|deck|dist)$/i, '');
}

module.exports = { expandHome, resolveLocalPath, pathKey, samePath, isPathInside, deckRelativePath };
