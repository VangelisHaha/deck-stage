'use strict';
// 远端稿库的底层：解析地址、通过系统 ssh 列出远端的稿子、用 rsync 同步一份稿子。
// 完全复用系统的 ssh / rsync：~/.ssh/config 的别名、密钥、ssh-agent、跳板机都直接生效，这里不碰密钥。
// 一律 BatchMode：不弹密码输入，认证不通过就报错，由界面提示用户。
const { spawn } = require('child_process');
const path = require('path');
const { loginShellEnv } = require('./util');

const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=3'];
const SKIP_SEG = new Set(['node_modules', '.git', 'lib', 'assets', 'dist']);

// 支持：user@host:/path、host:/path、host:~/path、ssh://user@host[:port]/path
// 返回 { user, host, port, path }，不是远端地址返回 null
function parseRemote(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  let m = /^ssh:\/\/(?:([^@/\s]+)@)?(\[[^\]]+\]|[^:/\s]+)(?::(\d+))?(\/.*)?$/.exec(s);
  let user, host, port, p;
  if (m) {
    [, user, host, port] = m;
    p = m[4] || '/';
    if (p === '/~' || p.startsWith('/~/')) p = p.slice(1); // ssh://host/~/x 表示家目录下的 x
  } else {
    m = /^(?:([^@/\s:]+)@)?([^:/\s@]+):(.*)$/.exec(s);
    if (!m || /^[/.~]/.test(s)) return null; // 本地路径不会在斜杠之前出现冒号
    [, user, host] = m;
    p = m[3];
  }
  if (!host) return null;
  if (!p) p = '~';
  else if (!/^[/~]/.test(p)) p = '~/' + p;
  if (p.length > 1) p = p.replace(/\/+$/, '') || '/';
  return { user: user || '', host, port: port || '', path: p };
}

function isRemote(input) { return parseRemote(input) !== null; }

// 规范化成 ssh:// 形式，存进 config.json、也当稿库的唯一标识
function canonical(r) {
  const p = r.path.startsWith('~') ? '/' + r.path : r.path;
  return `ssh://${r.user ? r.user + '@' : ''}${r.host}${r.port ? ':' + r.port : ''}${p}`;
}

function target(r) { return (r.user ? r.user + '@' : '') + r.host; }
// DECKSTAGE_SSH_OPTS：额外的 ssh 参数（空格分隔，如 `-F /path/config`），给自动化测试和特殊网络环境用
const extraOpts = () => (process.env.DECKSTAGE_SSH_OPTS || '').split(/\s+/).filter(Boolean);
function sshBase(r) { return [...(r.port ? ['-p', r.port] : []), ...SSH_OPTS, ...extraOpts()]; }
function label(r) { return `${r.host}:${path.posix.basename(r.path) || r.path}`; }

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
// rsync 2.6.9（macOS 自带）没有 -s，远端路径要自己转义给远端 shell
const escRemote = (s) => String(s).replace(/([^A-Za-z0-9_\-./,:@%+=\u0080-￿])/g, '\\$1');

// 把 ssh / rsync 的报错翻成用户能照着处理的话
function explain(stderr, code) {
  const t = String(stderr || '');
  if (/Permission denied/i.test(t)) return '认证失败：需要能免密登录（密钥或 ssh-agent）。先在终端里 ssh 一次试试';
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION/i.test(t)) return '主机指纹未确认：先在终端里 ssh 连一次这台机器并确认指纹';
  if (/Could not resolve hostname|Name or service not known|nodename nor servname/i.test(t)) return '找不到这个主机名，检查拼写或 ~/.ssh/config 里的别名';
  if (/timed out|Operation timed out/i.test(t)) return '连接超时，检查网络、VPN 或跳板机';
  if (/Connection refused/i.test(t)) return '连接被拒绝，远端没开 SSH 或端口不对';
  if (/No route to host|Network is unreachable/i.test(t)) return '网络不可达，检查网络或 VPN';
  if (/NOTDIR/.test(t)) return '远端没有这个目录';
  if (/No such file or directory|change_dir/i.test(t)) return '远端路径不存在';
  if (/command not found.*rsync|rsync: command not found/i.test(t)) return '远端没装 rsync';
  const line = t.split('\n').map((x) => x.trim()).filter(Boolean).pop();
  return line ? line.slice(0, 160) : `命令失败（退出码 ${code}）`;
}

async function run(cmd, args, { input, timeout = 25000 } = {}) {
  const env = await loginShellEnv(); // 带上终端里的 SSH_AUTH_SOCK 等
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); err += '\nOperation timed out'; }, timeout);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(timer); reject(new Error(e.code === 'ENOENT' ? `找不到 ${cmd}` : e.message)); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(explain(err, code)));
    });
    if (input != null) p.stdin.end(input); else p.stdin.end();
  });
}

// 远端脚本：列出稿子目录（含 index.html 且有 deck.config.js 或 notes.js），输出「目录\t最近修改\t标题」。
// 写成 POSIX sh，Linux 和 macOS 都能跑。
function scanScript(rootPath) {
  return `R=${shq(rootPath)}
case "$R" in "~") R="$HOME";; "~/"*) R="$HOME/\${R#\\~/}";; esac
[ -d "$R" ] || { echo NOTDIR >&2; exit 3; }
printf '@root\\t%s\\n' "$R"
find "$R" -maxdepth 6 \\( -name deck.config.js -o -name notes.js \\) ! -path '*/node_modules/*' ! -path '*/.git/*' 2>/dev/null | while IFS= read -r f; do
  d=$(dirname "$f"); [ -f "$d/index.html" ] && printf '%s\\n' "$d"
done | sort -u | while IFS= read -r d; do
  n=$(ls -t "$d/index.html" "$d/deck.config.js" "$d/notes.js" "$d"/acts/* "$d"/notes/* "$d"/css/* 2>/dev/null | head -1)
  m=$(stat -c %Y "$n" 2>/dev/null || stat -f %m "$n" 2>/dev/null)
  t=$(grep -i -m1 -o '<title>[^<]*' "$d/index.html" 2>/dev/null | head -1 | sed 's/^<[Tt][Ii][Tt][Ll][Ee]>//' | tr '\\t\\r' '  ')
  printf '%s\\t%s\\t%s\\n' "$d" "$m" "$t"
done
`;
}

// 列出远端稿库里的稿子：{ root, decks: [{ remoteDir, mtime(ms), title }] }
async function scan(r) {
  const out = await run('ssh', [...sshBase(r), target(r), 'sh', '-s'], { input: scanScript(r.path), timeout: 30000 });
  let root = r.path;
  const found = [];
  for (const line of out.split('\n')) {
    const [a, b, c] = line.split('\t');
    if (a === '@root') { root = b; continue; }
    if (a && a.startsWith('/')) found.push({ remoteDir: a, mtime: (parseInt(b, 10) || 0) * 1000, title: (c || '').trim() });
  }
  // 与本地扫描一致：跳过 lib/assets 等目录里的，稿子内部不再下钻
  const dirs = found.map((d) => d.remoteDir);
  const decks = found.filter((d) => {
    const rel = path.posix.relative(root, d.remoteDir);
    if (rel.split('/').some((seg) => SKIP_SEG.has(seg))) return false;
    return !dirs.some((o) => o !== d.remoteDir && d.remoteDir.startsWith(o + '/'));
  });
  return { root, decks };
}

// 把远端稿子目录镜像到本机 localDir（只传变化的部分；本机缓存目录归我们独占，所以允许 --delete）
async function syncDir(r, remoteDir, localDir) {
  const fs = require('fs');
  fs.mkdirSync(localDir, { recursive: true });
  const rsh = ['ssh', ...sshBase(r)].join(' ');
  const args = ['-az', '--delete', '--timeout=30', '--exclude', 'node_modules', '--exclude', '.git',
    '-e', rsh, `${target(r)}:${escRemote(remoteDir)}/`, localDir + '/'];
  await run('rsync', args, { timeout: 10 * 60 * 1000 });
}

// 添加前的连通性检查：能连上、目录存在，返回里面的稿子数
async function probe(r) {
  const { decks } = await scan(r);
  return decks.length;
}

module.exports = { parseRemote, isRemote, canonical, label, target, scan, syncDir, probe, explain };
