'use strict';
// 图标生成：唯一的几何来源在这个文件里，改完运行 `npm run icons` 重新生成全部尺寸。
// 图形：一张 16:9 的纸色幻灯片（带橙色小标题条），下面是页码刻度条，当前页那根橙色加高。
// 输出：
//   assets/icon/*.svg          矢量母版（mac 圆角版 / 满版 / 安卓前景 / 单色）
//   assets/icon/icon-1024.png  iOS、商店用（满版、无圆角、无透明）
//   assets/icon/icon-512.png   Google Play 商店图标
//   build/icon.icns            mac 应用图标（electron-builder 默认读取）
//   mobile/android/.../res     Android 自适应图标与各密度启动图标
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Resvg } = require('@resvg/resvg-js');

const ROOT = path.join(__dirname, '..');
const C = { ink: '#121212', paper: '#F1EEE6', signal: '#FF4F1F', dim: '#55534D' };

// ---------- 图形（1024×1024 画布，居中） ----------
// scale 绕画布中心缩放：大图标用 1.25 让图形更醒目；安卓自适应前景用 1，留出系统遮罩的裁切余量
function glyph(color = {}, scale = 1.25) {
  const paper = color.paper || C.paper;
  const ink = color.ink || C.ink;
  const signal = color.signal || C.signal;
  const dim = color.dim || C.dim;
  const W = 520, H = 292, X = (1024 - W) / 2, Y = 300;
  const parts = [];
  parts.push(`<rect x="${X}" y="${Y}" width="${W}" height="${H}" fill="${paper}"/>`);
  parts.push(`<rect x="${X + 48}" y="${Y + 52}" width="72" height="16" fill="${signal}"/>`);
  parts.push(`<rect x="${X + 48}" y="${Y + 98}" width="310" height="34" fill="${ink}"/>`);
  parts.push(`<rect x="${X + 48}" y="${Y + 148}" width="220" height="34" fill="${ink}"/>`);
  // 刻度条：11 根，第 5 根是当前页
  const n = 11, tw = 24, gap = (W - n * tw) / (n - 1), base = Y + H + 44 + 76, cur = 4;
  for (let i = 0; i < n; i++) {
    const h = i === cur ? 76 : 36;
    const fill = i === cur ? signal : i < cur ? paper : dim;
    parts.push(`<rect x="${(X + i * (tw + gap)).toFixed(2)}" y="${base - h}" width="${tw}" height="${h}" fill="${fill}"/>`);
  }
  return `<g transform="translate(512 512) scale(${scale}) translate(-512 -512)">${parts.join('')}</g>`;
}

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${body}</svg>\n`;

const SVGS = {
  // macOS：824 圆角方块居中，四周留 100px 边距
  'icon-mac.svg': svg(`<rect x="100" y="100" width="824" height="824" rx="185" fill="${C.ink}"/>${glyph()}`),
  // 满版：iOS / Play 商店 / 安卓传统图标用，不做圆角，由系统裁切
  'icon-full.svg': svg(`<rect width="1024" height="1024" fill="${C.ink}"/>${glyph()}`),
  // 安卓自适应图标前景：透明底，图形都在中间 66% 安全区内
  'icon-foreground.svg': svg(glyph({}, 1)),
  // 安卓 13 主题图标：单色
  'icon-mono.svg': svg(glyph({ paper: '#000', ink: 'none', signal: '#000', dim: '#000' }, 1).replace(/fill="none"/g, 'fill="none"'))
};

// 圆形版（旧安卓启动器）：满版 + 圆形裁切
const ROUND = svg(`<clipPath id="c"><circle cx="512" cy="512" r="512"/></clipPath><g clip-path="url(#c)"><rect width="1024" height="1024" fill="${C.ink}"/>${glyph()}</g>`);

function render(source, size) {
  return new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng();
}

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

// ---------- 输出 ----------
const out = (p) => path.join(ROOT, p);

for (const [name, source] of Object.entries(SVGS)) write(out(`assets/icon/${name}`), source);
write(out('assets/icon/icon-1024.png'), render(SVGS['icon-full.svg'], 1024));
write(out('assets/icon/icon-512.png'), render(SVGS['icon-full.svg'], 512));

// macOS .icns：iconset → iconutil
const iconset = fs.mkdtempSync(path.join(os.tmpdir(), 'deckstage-')) + '/icon.iconset';
fs.mkdirSync(iconset);
for (const s of [16, 32, 128, 256, 512]) {
  write(path.join(iconset, `icon_${s}x${s}.png`), render(SVGS['icon-mac.svg'], s));
  write(path.join(iconset, `icon_${s}x${s}@2x.png`), render(SVGS['icon-mac.svg'], s * 2));
}
fs.mkdirSync(out('build'), { recursive: true });
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', out('build/icon.icns')]);
write(out('build/icon.png'), render(SVGS['icon-mac.svg'], 512)); // 开发时 dock 图标用

// Android
const RES = out('mobile/android/app/src/main/res');
const launcher = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const adaptive = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
for (const d of Object.keys(launcher)) {
  const dir = path.join(RES, `mipmap-${d}`);
  write(path.join(dir, 'ic_launcher.png'), render(SVGS['icon-full.svg'], launcher[d]));
  write(path.join(dir, 'ic_launcher_round.png'), render(ROUND, launcher[d]));
  write(path.join(dir, 'ic_launcher_foreground.png'), render(SVGS['icon-foreground.svg'], adaptive[d]));
  write(path.join(dir, 'ic_launcher_monochrome.png'), render(SVGS['icon-mono.svg'], adaptive[d]));
}
write(path.join(RES, 'values/ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${C.ink}</color>\n</resources>\n`);
for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
  write(path.join(RES, 'mipmap-anydpi-v26', name),
    `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>\n</adaptive-icon>\n`);
}

console.log('图标已生成');
