'use strict';

const POINTER_STYLES = [
  {
    id: 'windows', name: 'Windows 经典', note: '白色箭头 · 黑色描边', viewBox: 32, tip: [2, 2],
    layers: [
      { path: 'M2 2 L2 26 L8.8 20 L14.2 30 L19 27.5 L13.8 17.2 L24 17 Z', fill: '#FFFFFF', stroke: '#111111', lineWidth: 1.7, shadow: 'rgba(0,0,0,.45)' }
    ]
  },
  {
    id: 'mac', name: 'macOS 黑箭头', note: '黑色箭头 · 白色细边', viewBox: 32, tip: [2, 2],
    layers: [
      { path: 'M2 2 L2.2 25.5 L8.6 19.7 L13.9 30 L18.7 27.5 L13.5 17.1 L23.5 17 Z', fill: '#111111', stroke: '#FFFFFF', lineWidth: 1.8, shadow: 'rgba(0,0,0,.6)' },
      { path: 'M5.2 6.3 L5.4 19.2', fill: 'none', stroke: '#4A4A4A', lineWidth: 1.1 }
    ]
  },
  {
    id: 'hand', name: '经典手形', note: '白手套 · 食指指向', viewBox: 32, tip: [12.1, 2.3],
    layers: [
      { path: 'M12.2 2.2 C10.6 2.2 9.6 3.4 9.6 5 L9.6 18 L7.2 15.2 C6.2 14 4.4 14.2 3.9 15.6 C3.6 16.5 3.9 17.3 4.5 18 L9.5 24.5 C11 26.6 12.2 28.5 12.2 29.5 L24 29.5 C24.4 27.5 25.4 26.2 26.4 24.6 C27.2 23.3 27.4 21.8 27.4 20.4 L27.4 14.4 C27.4 13 26.4 12.2 25.2 12.2 C24.2 12.2 23.4 12.8 23.2 13.6 C23 12.4 22 11.6 20.8 11.6 C19.8 11.6 19 12.2 18.7 13 C18.4 11.9 17.5 11.3 16.5 11.3 C15.6 11.3 14.9 11.7 14.6 12.3 L14.6 5 C14.6 3.4 13.6 2.2 12.2 2.2 Z', fill: '#FFFFFF', stroke: '#111111', lineWidth: 1.7, shadow: 'rgba(0,0,0,.45)' },
      { path: 'M14.6 12.3 L14.6 17.5 M18.7 13.2 L18.7 17.5 M23.2 13.8 L23.2 17.8', fill: 'none', stroke: '#555555', lineWidth: 1.1 }
    ]
  },
  {
    id: 'league', name: '英雄联盟风格', note: '黄金战斗手套 · 食指指向', viewBox: 32, tip: [12.1, 2.3],
    layers: [
      { path: 'M12.2 2.2 C10.6 2.2 9.6 3.4 9.6 5 L9.6 18 L7.2 15.2 C6.2 14 4.4 14.2 3.9 15.6 C3.6 16.5 3.9 17.3 4.5 18 L9.5 24.5 C11 26.6 12.2 28.5 12.2 29.5 L24 29.5 C24.4 27.5 25.4 26.2 26.4 24.6 C27.2 23.3 27.4 21.8 27.4 20.4 L27.4 14.4 C27.4 13 26.4 12.2 25.2 12.2 C24.2 12.2 23.4 12.8 23.2 13.6 C23 12.4 22 11.6 20.8 11.6 C19.8 11.6 19 12.2 18.7 13 C18.4 11.9 17.5 11.3 16.5 11.3 C15.6 11.3 14.9 11.7 14.6 12.3 L14.6 5 C14.6 3.4 13.6 2.2 12.2 2.2 Z', fill: '#D8B35A', stroke: '#3A2A0E', lineWidth: 1.7, shadow: 'rgba(216,167,61,.65)' },
      { path: 'M9.6 6.2 C9.6 3.8 10.7 2.2 12.1 2.2 C13.5 2.2 14.6 3.8 14.6 6.2 Z', fill: '#F4DE92', stroke: '#3A2A0E', lineWidth: 1.2 },
      { path: 'M12.2 25.4 L24 25.4 L24 29.5 L12.2 29.5 Z', fill: '#7B5A1E', stroke: '#3A2A0E', lineWidth: 1.2 },
      { path: 'M14.6 12.3 L14.6 17.8 M18.7 13.2 L18.7 18 M23.2 13.8 L23.2 18.2', fill: 'none', stroke: '#8E6A22', lineWidth: 1.2 },
      { path: 'M11.7 8 L11.7 15.5', fill: 'none', stroke: '#FFF3B0', lineWidth: 1.4 }
    ]
  },
  {
    id: 'warcraft', name: '魔兽世界风格', note: '蓝钢符文手套 · 原创绘制', viewBox: 32, tip: [3, 3],
    layers: [
      { path: 'M3 3 C2 2 1 3.4 2.2 5.2 L8.4 11.3 L8.4 20.5 L12.4 29 L22.4 27.2 L25.7 21 L24.7 13.2 C24.4 10.8 21.2 10.7 20.3 13 L20.3 9.4 C20.2 7 17.1 6.7 16.2 9 L16.2 7.2 C16 4.9 13 4.8 12.1 7.1 L12.1 5.5 C12 3.2 9 3 8.2 5.3 L8.2 9 Z', fill: '#25384B', stroke: '#D2B36B', lineWidth: 1.8, shadow: 'rgba(35,116,184,.55)' },
      { path: 'M9.8 12 L14.2 9.5 L19.1 12.2 L20.8 18 L17.4 24.4 L12.4 23 L10 18 Z', fill: '#356B91', stroke: '#9DD8FF', lineWidth: 1.25 },
      { path: 'M13 14 L17.4 13.2 L18.5 17.2 L15.8 20.4 L12.9 18.5 Z', fill: '#76C8F2', stroke: '#D6F3FF', lineWidth: .8 }
    ]
  },
  {
    id: 'neon', name: '霓虹箭头', note: '深色箭头 · 青色发光边', viewBox: 32, tip: [2, 2],
    layers: [
      { path: 'M2 2 L2.2 25.5 L8.6 19.7 L13.9 30 L18.7 27.5 L13.5 17.1 L23.5 17 Z', fill: '#0B1B2A', stroke: '#2EE6FF', lineWidth: 2, shadow: 'rgba(46,230,255,.85)' },
      { path: 'M5.2 6.8 L5.4 18.6', fill: 'none', stroke: '#9AF3FF', lineWidth: 1.1 }
    ]
  },
  {
    id: 'laser', name: '激光点', note: '红色激光笔光点', viewBox: 32, tip: [16, 16],
    layers: [
      { path: 'M16 6 A10 10 0 1 0 16 26 A10 10 0 1 0 16 6 Z', fill: 'rgba(255,59,47,.28)' },
      { path: 'M16 11 A5 5 0 1 0 16 21 A5 5 0 1 0 16 11 Z', fill: '#FF3B2F', stroke: '#FFFFFF', lineWidth: 1.4, shadow: 'rgba(255,59,47,.9)' },
      { path: 'M14.2 13.6 A2 2 0 1 0 14.21 13.6 Z', fill: '#FFD9D4' }
    ]
  },
  {
    id: 'ring', name: '聚光圈', note: '橙色圆环 · 圈出重点', viewBox: 32, tip: [16, 16],
    layers: [
      { path: 'M16 5 A11 11 0 1 0 16 27 A11 11 0 1 0 16 5 Z', fill: 'rgba(255,79,31,.16)', stroke: '#FF4F1F', lineWidth: 2.6, shadow: 'rgba(255,79,31,.6)' },
      { path: 'M16 14 A2 2 0 1 0 16 18 A2 2 0 1 0 16 14 Z', fill: '#FF4F1F' }
    ]
  },
  {
    id: 'crosshair', name: '十字准星', note: '橙色十字 · 黑色衬边', viewBox: 32, tip: [16, 16],
    layers: [
      { path: 'M16 3 L16 12 M16 20 L16 29 M3 16 L12 16 M20 16 L29 16', fill: 'none', stroke: '#111111', lineWidth: 5 },
      { path: 'M16 3 L16 12 M16 20 L16 29 M3 16 L12 16 M20 16 L29 16', fill: 'none', stroke: '#FF4F1F', lineWidth: 2.4 },
      { path: 'M16 14.4 A1.6 1.6 0 1 0 16 17.6 A1.6 1.6 0 1 0 16 14.4 Z', fill: '#FF4F1F', stroke: '#111111', lineWidth: 1 }
    ]
  },
  {
    id: 'pen', name: '荧光笔', note: '橙色马克笔 · 笔尖指点', viewBox: 32, tip: [3, 29],
    layers: [
      { path: 'M5.5 21.5 L11 27 L3 29 Z', fill: '#F1EEE6', stroke: '#111111', lineWidth: 1.4, shadow: 'rgba(0,0,0,.45)' },
      { path: 'M5.5 21.5 L21.5 5.5 L27 11 L11 27 Z', fill: '#FF4F1F', stroke: '#111111', lineWidth: 1.6 },
      { path: 'M19 8 L24.5 13.5', fill: 'none', stroke: '#111111', lineWidth: 1.4 },
      { path: 'M8.2 20.6 L20.6 8.2', fill: 'none', stroke: '#FFB59B', lineWidth: 1.1 }
    ]
  }
];

const POINTER_SIZES = [
  { id: 'small', name: '小', px: 26 },
  { id: 'medium', name: '中', px: 38 },
  { id: 'large', name: '大', px: 52 }
];

const DEFAULT_POINTER = Object.freeze({ style: 'mac', size: 'small' });
const styleIds = new Set(POINTER_STYLES.map((x) => x.id));
const sizeIds = new Set(POINTER_SIZES.map((x) => x.id));

function normalizePointer(value) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    style: styleIds.has(raw.style) ? raw.style : DEFAULT_POINTER.style,
    size: sizeIds.has(raw.size) ? raw.size : DEFAULT_POINTER.size
  };
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function previewDataUrl(style, size) {
  const box = 72;
  const px = Math.min(54, size.px * 1.25);
  const scale = px / style.viewBox;
  const tx = (box - style.viewBox * scale) / 2; // 整个 32×32 画布居中，点在中心的样式（激光点、准星）才不会被裁掉
  const ty = (box - style.viewBox * scale) / 2;
  const paths = style.layers.map((layer) => {
    const attrs = [
      `d="${esc(layer.path)}"`, `fill="${esc(layer.fill || 'none')}"`,
      `stroke="${esc(layer.stroke || 'none')}"`, `stroke-width="${Number(layer.lineWidth) || 0}"`,
      'stroke-linejoin="round"', 'stroke-linecap="round"'
    ];
    return `<path ${attrs.join(' ')}/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}"><g transform="translate(${tx} ${ty}) scale(${scale})">${paths}</g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function pointerCatalog() {
  return {
    styles: POINTER_STYLES.map((style) => ({
      ...style,
      previews: Object.fromEntries(POINTER_SIZES.map((size) => [size.id, previewDataUrl(style, size)]))
    })),
    sizes: POINTER_SIZES.map((x) => ({ ...x }))
  };
}

module.exports = { DEFAULT_POINTER, POINTER_STYLES, POINTER_SIZES, normalizePointer, pointerCatalog };
