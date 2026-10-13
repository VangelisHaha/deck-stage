'use strict';
// 在当前机器上验证 Windows 路径规则；文件读写只落在临时目录，不启动 Electron。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const url = require('node:url');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function loadModule(file, overrides = {}, globals = {}) {
  const cache = new Map();
  function load(filename) {
    filename = require.resolve(filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const nativeRequire = createRequire(filename);
    const customRequire = (id) => {
      if (Object.hasOwn(overrides, id)) return overrides[id];
      if (id.startsWith('.')) return load(nativeRequire.resolve(id));
      return nativeRequire(id);
    };
    customRequire.resolve = nativeRequire.resolve;
    const run = vm.runInThisContext(
      '(function(require, module, exports, __dirname, __filename, process, setTimeout, clearTimeout) {\n' +
      fs.readFileSync(filename, 'utf8') + '\n})', { filename });
    run(customRequire, module, module.exports, path.dirname(filename), filename,
      globals.process || process, globals.setTimeout || setTimeout, globals.clearTimeout || clearTimeout);
    return module.exports;
  }
  return load(file);
}

function windowsRuntime(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'deckstage-win-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const nativePath = (input) => {
    const resolved = path.win32.resolve('C:\\', input);
    const root = path.win32.parse(resolved).root;
    const volume = root.replace(/[\\/:]/g, '_').toLowerCase();
    const rel = path.win32.relative(root, resolved).toLowerCase();
    return path.join(temp, volume, ...rel.split('\\'));
  };
  const winFs = { ...fs };
  for (const method of ['readFileSync', 'writeFileSync', 'mkdirSync', 'existsSync', 'statSync', 'readdirSync', 'stat', 'createReadStream']) {
    winFs[method] = (input, ...args) => fs[method](nativePath(input), ...args);
  }
  const home = String.raw`C:\Users\Test`;
  const locations = { documents: path.win32.join(home, 'Documents'), userData: path.win32.join(home, 'AppData', 'DeckStage') };
  const overrides = {
    fs: winFs,
    path: path.win32,
    os: { ...os, homedir: () => home },
    url: { ...url, pathToFileURL: (file) => url.pathToFileURL(file, { windows: true }) },
    electron: { app: { getPath: (key) => locations[key] } }
  };
  return {
    fs: winFs, home, locations,
    load: (file, extra = {}, globals = {}) => loadModule(file, { ...overrides, ...extra }, {
      process: { platform: 'win32', env: {} }, ...globals
    })
  };
}

module.exports = { loadModule, windowsRuntime };
