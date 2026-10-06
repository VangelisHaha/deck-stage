'use strict';
// 已保存的 SSH 连接（主机、端口、用户名，可选密码），存在 userData/connections.json，下次不用重输。
// 密码用 AES-256-GCM 加密后落盘，密钥放在同目录 connections.key。
// 坦白说这只能防「顺手打开文件就看到明文」和误传配置，防不了能读你用户目录的人；
// 没用系统钥匙串，是因为未签名的应用每次升级都会被钥匙串重新询问授权。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const dataFile = () => path.join(app.getPath('userData'), 'connections.json');
const keyFile = () => path.join(app.getPath('userData'), 'connections.key');

const norm = (c) => ({ user: String(c.user || ''), host: String(c.host || ''), port: String(c.port || '') });
const idOf = (c) => { const n = norm(c); return `${n.user}@${n.host}:${n.port || '22'}`; };

function key() {
  try {
    const k = fs.readFileSync(keyFile());
    if (k.length === 32) return k;
  } catch (e) { /* 第一次用，下面生成 */ }
  const k = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(keyFile()), { recursive: true });
  fs.writeFileSync(keyFile(), k, { mode: 0o600 });
  return k;
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
}

function decrypt(b64) {
  try {
    const buf = Buffer.from(b64, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
  } catch (e) { return null; }
}

function read() {
  try { return JSON.parse(fs.readFileSync(dataFile(), 'utf8')); } catch (e) { return []; }
}

function write(list) {
  fs.mkdirSync(path.dirname(dataFile()), { recursive: true });
  const tmp = dataFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, dataFile());
}

// 给界面用，不含密码
function list() {
  return read().map((c) => ({ id: c.id, user: c.user, host: c.host, port: c.port, hasPassword: !!c.pw }));
}

function password(c) {
  const hit = read().find((x) => x.id === idOf(c));
  return hit && hit.pw ? decrypt(hit.pw) : null;
}

// password 为空串或 undefined 表示沿用已保存的密码
function save(c) {
  const n = norm(c);
  const all = read();
  const id = idOf(n);
  const prev = all.find((x) => x.id === id);
  const pw = c.password ? encrypt(c.password) : (prev && prev.pw) || '';
  const next = { id, ...n, pw };
  write(prev ? all.map((x) => (x.id === id ? next : x)) : [...all, next]);
}

function remove(id) { write(read().filter((c) => c.id !== id)); }

module.exports = { list, password, save, remove, idOf };
