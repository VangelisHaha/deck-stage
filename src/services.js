'use strict';
// 稿子自带的后台服务。有的稿子页面要调本机的接口（例如「发送单聊/群聊消息」的按钮），
// 在稿子目录放一个 deckstage.json 声明，放映时 DeckStage 负责启动，放映结束自动关闭：
//
//   { "services": [ { "name": "分享发送服务",
//                     "command": ["python3", "share/share_server.py"],
//                     "health": "http://127.0.0.1:8898/health" } ] }
//
// command 在稿子目录下执行，环境取用户登录 shell 的环境（App 自己的 PATH 找不到 lark-cli 之类）。
// health 可选；已经能访问就认为服务在跑（比如用户自己起了），不重复启动，也不会在结束时关掉它。
// 安全：打开稿子就执行命令很危险，所以首次、或命令/脚本内容变化时，必须由用户确认（confirm 回调）。
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { app } = require('electron');
const { loginShellEnv, safeName } = require('./util');

const MANIFEST = 'deckstage.json';
const DEFAULT_WAIT_MS = 8000;

function readServices(root) {
  let json;
  try { json = JSON.parse(fs.readFileSync(path.join(root, MANIFEST), 'utf8')); } catch (e) { return []; }
  const list = Array.isArray(json.services) ? json.services : [];
  return list
    .filter((s) => s && Array.isArray(s.command) && s.command.length && s.command.every((x) => typeof x === 'string'))
    .map((s) => ({
      name: String(s.name || s.command[0]),
      command: s.command,
      health: typeof s.health === 'string' ? s.health : '',
      waitMs: Number.isFinite(s.waitMs) ? s.waitMs : DEFAULT_WAIT_MS
    }));
}

// 信任指纹：命令本身 + 命令里引用的、位于稿子目录内的脚本文件内容。脚本被改了就要重新确认。
function fingerprint(root, services) {
  const h = crypto.createHash('sha256');
  h.update(JSON.stringify(services.map((s) => [s.name, s.command, s.health])));
  const base = path.resolve(root);
  for (const s of services) {
    for (const arg of s.command) {
      const file = path.resolve(base, arg);
      if (file.startsWith(base + path.sep)) {
        try { if (fs.statSync(file).isFile()) h.update(fs.readFileSync(file)); } catch (e) { /* 不是文件就跳过 */ }
      }
    }
  }
  return h.digest('hex');
}

function ping(url, timeout = 1000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout }, (res) => { res.resume(); resolve(res.statusCode >= 200 && res.statusCode < 400); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Services {
  constructor(root, { confirm, notify }) {
    this.root = root;
    this.confirm = confirm;   // async ({ root, services, fingerprint }) => boolean
    this.notify = notify;
    this.running = [];        // { service, child, exited }
  }

  async start() {
    const all = readServices(this.root);
    const todo = [];
    for (const s of all) if (!(s.health && (await ping(s.health)))) todo.push(s);
    if (!todo.length) return;

    if (!(await this.confirm({ root: this.root, services: todo, fingerprint: fingerprint(this.root, todo) }))) {
      this.notify('已跳过稿子的后台服务，页面上依赖它的按钮会不可用');
      return;
    }
    const env = await loginShellEnv();
    for (const s of todo) this.spawnOne(s, env);
    await Promise.all(this.running.map((r) => this.waitReady(r)));
  }

  spawnOne(service, env) {
    const logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, `${safeName(service.name)}.log`);
    const fd = fs.openSync(logFile, 'a');
    const [cmd, ...args] = service.command;
    const entry = { service, child: null, exited: false, logFile };
    try {
      entry.child = spawn(cmd, args, { cwd: this.root, env, stdio: ['ignore', fd, fd] });
    } catch (e) {
      this.notify(`${service.name} 启动失败：${e.message}`);
      fs.closeSync(fd);
      return;
    }
    fs.closeSync(fd);
    entry.child.on('error', (e) => { entry.exited = true; this.notify(`${service.name} 启动失败：${e.message}`); });
    entry.child.on('exit', (code) => { entry.exited = true; entry.code = code; });
    this.running.push(entry);
  }

  async waitReady(entry) {
    const { service } = entry;
    if (!service.health) return;
    const deadline = Date.now() + service.waitMs;
    while (Date.now() < deadline) {
      if (await ping(service.health)) return;
      if (entry.exited) break;
      await sleep(300);
    }
    this.notify(`${service.name} 没有在预期时间内就绪，日志：${entry.logFile}`);
  }

  async stop() {
    const alive = this.running.filter((r) => r.child && !r.exited);
    for (const r of alive) r.child.kill('SIGTERM');
    const deadline = Date.now() + 2500;
    while (alive.some((r) => !r.exited) && Date.now() < deadline) await sleep(100);
    for (const r of alive) if (!r.exited) r.child.kill('SIGKILL');
    this.running = [];
  }
}

module.exports = { Services, readServices, fingerprint, MANIFEST };
