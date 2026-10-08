'use strict';
// 遥控网页是样式源；连接页和原生控件复用同一组颜色。
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const css = fs.readFileSync(path.join(root, 'src/remote/remote.css'), 'utf8');
fs.writeFileSync(path.join(root, 'mobile/www/remote.css'), css);
const remoteDir = path.join(root, 'mobile/www/remote');
fs.mkdirSync(remoteDir, { recursive: true });
for (const file of ['index.html', 'remote.css', 'remote.js']) {
  fs.copyFileSync(path.join(root, 'src/remote', file), path.join(remoteDir, file));
}
const colors = ['ink', 'paper', 'rule', 'dim', 'signal', 'body'].map((name) => {
  const match = css.match(new RegExp('--' + name + ':\\s*(#[0-9A-Fa-f]{6})'));
  if (!match) throw new Error('遥控样式缺少颜色：' + name);
  return [name, match[1]];
});
const resources = colors.map(([name, color]) => `    <color name="deckstage_${name}">${color}</color>`);
resources.push(`    <color name="zxing_viewfinder_laser">${colors.find(([name]) => name === 'signal')[1]}</color>`);
fs.writeFileSync(path.join(root, 'mobile/android/app/src/main/res/values/deckstage-theme.xml'),
  '<?xml version="1.0" encoding="utf-8"?>\n<!-- 由 prepare-web.cjs 从遥控网页样式生成，请勿手工修改。 -->\n<resources>\n' + resources.join('\n') + '\n</resources>\n');
console.log('已同步遥控样式与原生主题颜色');
