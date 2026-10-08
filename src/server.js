'use strict';
// 内置静态服务：只绑 127.0.0.1，所有响应 no-store，解决浏览器缓存导致改了稿子看不到的问题。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { kernelFile, readPage } = require('./kernel');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm',
  '.map': 'application/json', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8'
};

function send(res, code, body, headers = {}) {
  res.writeHead(code, Object.assign({ 'Cache-Control': 'no-store, must-revalidate' }, headers));
  res.end(body);
}

function serveFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes' };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? parseInt(range[1], 10) : st.size - parseInt(range[2], 10);
      let end = range[1] && range[2] ? parseInt(range[2], 10) : st.size - 1;
      start = Math.max(0, start);
      end = Math.min(end, st.size - 1);
      if (start > end) return send(res, 416, '', { 'Content-Range': `bytes */${st.size}` });
      res.writeHead(206, Object.assign({
        'Cache-Control': 'no-store', 'Content-Range': `bytes ${start}-${end}/${st.size}`,
        'Content-Length': end - start + 1
      }, base));
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, Object.assign({ 'Cache-Control': 'no-store, must-revalidate', 'Content-Length': st.size }, base));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// 稿子目录 + 内核（/_deckstage/）。HTML 页面先展开 <!-- @include --> 再返回
function makeHandler(root) {
  const base = path.resolve(root);
  return (req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { return send(res, 400, 'Bad request'); }
    const kf = kernelFile(pathname);
    if (kf) return serveFile(req, res, kf);
    let file = path.resolve(path.join(base, pathname));
    if (file !== base && !file.startsWith(base + path.sep)) return send(res, 403, 'Forbidden');
    try { if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html'); } catch (e) { /* 交给 serveFile 回 404 */ }
    if (path.extname(file).toLowerCase() === '.html') {
      let html;
      try { html = readPage(file, base); } catch (e) { return send(res, 404, 'Not found'); }
      return send(res, 200, req.method === 'HEAD' ? '' : html, { 'Content-Type': MIME['.html'] });
    }
    serveFile(req, res, file);
  };
}

// 先尝试稳定端口，被占用就让系统分配
function startServer(root, preferredPort) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(makeHandler(root));
    const listen = (port) => {
      srv.once('error', (e) => {
        if (e.code === 'EADDRINUSE' && port !== 0) return listen(0);
        reject(e);
      });
      srv.listen(port, '127.0.0.1', () => {
        const { port: real } = srv.address();
        resolve({
          origin: `http://127.0.0.1:${real}`,
          close: () => new Promise((r) => { srv.closeAllConnections(); srv.close(() => r()); })
        });
      });
    };
    listen(preferredPort || 0);
  });
}

module.exports = { startServer, serveFile, send };
