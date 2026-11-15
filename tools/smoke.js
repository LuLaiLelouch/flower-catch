/* 冒烟自检：DOM id 是否齐全 + 素材文件是否都在 + 关卡表是否自洽 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const js = ['js/config.js', 'js/sprites.js', 'js/game.js']
  .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const wanted = new Set([...js.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]));

let bad = 0;
for (const id of wanted) {
  if (!htmlIds.has(id)) { console.log('✘ 缺少 DOM 元素: #' + id); bad++; }
}
console.log(`DOM id 检查：需要 ${wanted.size} 个，缺失 ${bad} 个`);

// 素材文件检查
const missing = [];
const srcs = [...js.matchAll(/['"`](assets\/[^'"`]+)['"`]/g)].map(m => m[1]);
const uniq = [...new Set(srcs)].filter(s => !s.includes('+') && !s.includes('Date.now'));
for (const s of uniq) {
  if (!fs.existsSync(path.join(ROOT, s))) missing.push(s);
}
console.log(`素材文件：引用 ${uniq.length} 个，缺失 ${missing.length} 个` + (missing.length ? '\n  ' + missing.join('\n  ') : ''));

// 帧序列检查（含动态生成的 assets/player/<dir>/<n>.png）
const animDirs = [...js.matchAll(/seq\('([^']+)',\s*(\d+)\)/g)];
const frameMiss = [];
for (const [, dir, n] of animDirs) {
  for (let i = 1; i <= Number(n); i++) {
    const p = `assets/player/${dir}/${i}.png`;
    if (!fs.existsSync(path.join(ROOT, p))) frameMiss.push(p);
  }
}
console.log(`动作帧：${animDirs.length} 组，缺失 ${frameMiss.length} 个` + (frameMiss.length ? '\n  ' + frameMiss.slice(0, 8).join('\n  ') : ''));

// 关卡表自洽检查
const levelsSrc = fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8');
const targets = [...levelsSrc.matchAll(/target:\s*(\d+)/g)].map(m => Number(m[1]));
const flowers = [...levelsSrc.matchAll(/name:\s*'([^']+)',\s*score:\s*(\d+)/g)].map(m => ({ n: m[1], s: Number(m[2]) }));
console.log(`关卡目标分：${targets.join(' / ')}`);
console.log(`花朵品种：${flowers.map(f => `${f.n}(${f.s})`).join(' ')}`);
if (targets.length !== flowers.length) console.log('⚠ 关卡数与花种数不一致（当前为累积解锁，数量相同即可一一对应）');

// BGM 顺序轮播列表：路径存在性由上面的「素材文件」检查一并覆盖
const playlist = [...levelsSrc.matchAll(/src:\s*'(assets\/bgm\/[^']+)'/g)].map(m => m[1]);
console.log(`BGM 播放列表：${playlist.length} 首 → ${playlist.map(p => p.split('/').pop()).join(' / ')}`);
if (!playlist.length) console.log('✘ BGM 播放列表为空');

const ok = bad === 0 && missing.length === 0 && frameMiss.length === 0 && playlist.length > 0;
console.log(ok ? '\n全部通过 ✔' : '\n有缺失，见上方 ✘');
