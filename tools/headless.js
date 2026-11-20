/* ==========================================================================
   无头运行自检：用桩件模拟浏览器环境，把真实主循环跑起来。
   覆盖：关卡解锁 / 分数每关重置 / 通关解锁无尽模式 / 无尽升档 / 重置进度。
   用法：node tools/headless.js
   ========================================================================== */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

/* ------------------------------ 桩件 ------------------------------ */
let gradSeq = [];          // 每帧创建的渐变（第一个就是天空）
let lastSky = '';
const grad = {
  addColorStop() {},
};

const ctxStub = () => new Proxy({ canvas: { width: 900, height: 640 } }, {
  get(t, p) {
    if (p in t) return t[p];
    if (p === 'createLinearGradient' || p === 'createRadialGradient') {
      return () => { const g = { stops: [], addColorStop: (o, c) => g.stops.push(c) }; gradSeq.push(g); return g; };
    }
    if (p === 'measureText') return () => ({ width: 10 });
    return () => grad;                       // 其余绘图方法返回可链式调用的桩
  },
  set(t, p, v) { t[p] = v; return true; },
});

function elStub(tag = 'div') {
  const listeners = {};
  const cls = new Set();
  const e = {
    tagName: tag, id: '', textContent: '',
    style: {}, className: '', dataset: {}, disabled: false,
    clientWidth: 900, clientHeight: 640, offsetWidth: 900, offsetHeight: 640,
    width: 900, height: 640, children: [], __classes: cls,
    classList: {
      add: (...c) => c.forEach(x => cls.add(x)),
      remove: (...c) => c.forEach(x => cls.delete(x)),
      toggle: (c, f) => (f === undefined ? (cls.has(c) ? cls.delete(c) : cls.add(c)) : (f ? cls.add(c) : cls.delete(c))),
      contains: c => cls.has(c),
    },
    listeners,
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
    removeEventListener() {},
    dispatch(t, ev) { (listeners[t] || []).forEach(f => f(ev || {})); },
    querySelector() { return elStub(); },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 640 }; },
    getContext() { return ctxStub(); },
    appendChild(c) { this.children.push(c); },
    remove() {}, focus() {},
    // <audio> 元素桩：Music 模块会用到
    volume: 1, loop: false, currentTime: 0,
    play() { return Promise.resolve(); }, pause() {}, load() {},
  };
  let _html = '';
  Object.defineProperty(e, 'innerHTML', {
    get: () => _html,
    set: v => { _html = v; if (v === '') e.children.length = 0; },   // 真实 DOM 会清空子节点
  });
  return e;
}

const registry = Object.create(null);
const rafQueue = [];
const document = {
  getElementById(id) { return registry[id] || (registry[id] = elStub()); },
  querySelector(sel) { return registry[sel] || (registry[sel] = elStub()); },
  querySelectorAll() { return []; },
  createElement(t) { return elStub(t); },
  addEventListener() {},
  body: elStub('body'),
  documentElement: elStub('html'),
};

class ImageStub {
  constructor() { this._nw = 320; this._nh = 320; this.onload = null; this.onerror = null; this.complete = true; }
  get naturalWidth() { return this._nw; }
  get naturalHeight() { return this._nh; }
  set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
  get src() { return this._src; }
}

const store = Object.create(null);
const sandbox = {
  console, Math, Date, JSON, Array, Object, String, Number, Boolean, Error, Promise,
  isNaN, parseInt, parseFloat, setTimeout, clearTimeout, setInterval, clearInterval,
  document, Image: ImageStub,
  performance: { now: () => Date.now() },
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  },
  getComputedStyle: () => ({ paddingLeft: '10px', paddingRight: '10px', paddingTop: '10px', paddingBottom: '10px' }),
  requestAnimationFrame: cb => { rafQueue.push(cb); return rafQueue.length; },
  cancelAnimationFrame() {},
  matchMedia: () => ({ matches: false }),
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.devicePixelRatio = 1;
sandbox.window.innerWidth = 900;
sandbox.window.innerHeight = 640;
const winListeners = {};
sandbox.window.addEventListener = (t, f) => { (winListeners[t] = winListeners[t] || []).push(f); };
sandbox.window.requestAnimationFrame = sandbox.requestAnimationFrame;
sandbox.window.confirm = () => true;          // 「重置进度」的二次确认默认同意
sandbox.window.AudioContext = undefined;
sandbox.window.webkitAudioContext = undefined;

/* 云端排行榜桩：模拟 CloudBoard 的内存镜像。
   用同步 thenable 让 .then 当场执行，断言能同步读到最终 UI 状态。
   注意不要把 js/cloud-board.js 加进下面的加载列表，否则桩会被真模块覆盖。 */
const cloudBoardStub = (() => {
  let list = [];
  const immediate = v => ({ then: fn => { fn(v); return undefined; } });
  return {
    list: () => list.slice(),
    setList: l => { list = Array.isArray(l) ? l.slice() : []; },
    clear: () => { list = []; delete store['flower-catch-leaderboard-v1']; },
    ready: () => true,
    status: () => ({ loaded: true, error: null }),
    refresh: () => immediate(true),
    submit: () => immediate(true),
    clearMine: () => immediate(true),
  };
})();
sandbox.window.CloudBoard = cloudBoardStub;

const ctx = vm.createContext(sandbox);
const run_ = code => vm.runInContext(code, ctx);

/* ------------------------------ 加载脚本 ------------------------------ */
for (const f of ['js/config.js', 'js/sprites.js', 'js/game.js']) {
  let src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  if (f === 'js/game.js') {
    // 只在这个 vm 沙箱里把内部状态暴露出来，用于构造确定性碰撞场景；
    // 磁盘上的游戏文件不受影响，浏览器里也不会有 __test。
    src = src.replace(/\}\)\(\);\s*$/,
      'globalThis.__test = { state, makeItem, healUp, takeDamage, renderLives, hitRect, submitBoard, renderBoard, gameOver, addScore, flushRunRecord, layout, topOffsets: () => ({ throwerFootY, dropStartY, W, H, groundY: GROUND_Y, hudBottom: H * 0.19, fallPace }) };\n})();');
  }
  run_(src);
}
console.log('脚本加载完成\n');

/* ------------------------------ 驱动与断言 ------------------------------ */
const sleep = ms => new Promise(r => setTimeout(r, ms));
let clock = Date.now();
let frames = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log('  ✔ ' + msg); }
  else { failed++; console.log('  ✘ ' + msg); }
}

async function run(n, label) {
  for (let i = 0; i < n; i++) {
    const cb = rafQueue.shift();
    if (!cb) { console.log(`  ✘ 主循环断掉（画面冻结）— 阶段：${label}`); failed++; return false; }
    clock += 16.7;
    gradSeq = [];
    try { cb(clock); }
    catch (e) {
      console.log(`  ✘ 运行时异常（${label}）: ${e.name}: ${e.message}`);
      console.log('     ' + String(e.stack).split('\n').slice(1, 4).join('\n     '));
      failed++;
      return false;
    }
    // 每帧第一个渐变就是天空渐变 → 用它验证各关背景确实不一样
    if (gradSeq.length) lastSky = gradSeq[0].stops.join('|');
    frames++;
    if (i % 30 === 29) await sleep(1);
  }
  return true;
}

const el = id => registry[id];
const tiles = () => el('levelGrid').children;
const num = id => Number(el(id).textContent);
const saved = () => JSON.parse(store['flower-catch-progress-v1'] || '{}');
const title = () => el('overTitle').textContent;
const panelShown = () => !el('overlayOver').__classes.has('hidden');   // 面板 id 是 overlayOver
const pauseShown = () => !el('overlayPause').__classes.has('hidden');
const pressKey = k => (winListeners.keydown || []).forEach(f => f({ key: k, preventDefault() {} }));
const emptyHearts = () => (String(el('lives').innerHTML).match(/heart empty/g) || []).length;

// 固定随机数种子，保证两次对照实验除了炸弹参数外完全一致
const setSeed = s => run_(
  `(function(){ let x=${s}; Math.random = function(){ x = (x*1103515245+12345) & 0x7fffffff; return x / 0x7fffffff; }; })()`);

// 全扔炸弹，数多少帧把 3 条命掉光（返回 -1 = 撑满帧数还没死）
async function framesToDeath(extra, seed, label) {
  setSeed(seed);
  run_('LEVELS.forEach(l => Object.assign(l, ' + JSON.stringify(extra) + '));');
  tiles()[0].dispatch('click');
  const canvas = el('game');
  const move = x => canvas.dispatch('pointermove', { clientX: x * 900 / 908 });
  let f = 0;
  for (let i = 0; i < 400; i++) {
    // 让角色左右横扫去接花 —— 成排炸弹的价值就在于移动时无处可躲，
    // 站着不动的话两侧多出来的炸弹根本碰不到他，测不出差别。
    move(454 + Math.sin(i / 16) * 380);
    const cb = rafQueue.shift();
    if (!cb) { failed++; console.log('  ✘ 主循环断掉 — ' + label); return 0; }
    clock += 16.7;
    gradSeq = [];
    try { cb(clock); } catch (e) { failed++; console.log('  ✘ 运行时异常（' + label + '）: ' + e.message); return 0; }
    frames++; f++;
    if (i % 30 === 29) await sleep(1);
    if (emptyHearts() >= 3) break;
  }
  await sleep(320);                                               // 等面板弹出（测试里死亡动画已加速）
  if (panelShown()) el('btnSecondary').dispatch('click');          // 回菜单，好进行下一轮对照
  return emptyHearts() >= 3 ? f : -1;
}

// 同一配置跑多个种子取平均，避免单次运气好/差导致误判
async function avgDeath(extra, label) {
  const seeds = [20260914, 777, 31415, 8888, 424242];
  const rs = [];
  for (const s of seeds) rs.push(await framesToDeath(extra, s, label));
  const ok = rs.filter(v => v > 0);
  const avg = Math.round(ok.reduce((a, b) => a + b, 0) / Math.max(1, ok.length));
  return { avg, all: rs };
}

(async () => {
  await sleep(30);
  // 补上 HTML 里的初始 class="overlay hidden"，否则面板可见性断言永远是真（假阳性）
  el('overlayOver').classList.add('hidden');

  /* ---- 1. 初始菜单状态 ---- */
  console.log('[1] 初始菜单');
  assert(tiles().length === 5, '关卡格子有 5 个');
  assert(tiles()[0].disabled === false, '第 1 关可点');
  assert(tiles()[1].disabled === true, '第 2 关初始锁住');
  assert(el('btnEndless').disabled === true, '无尽模式初始锁住');
  assert(el('endlessHint').textContent.includes('第 5 关'), '无尽模式提示"通关第 5 关后解锁"');

  /* ---- 2. 进第 1 关并通关 ---- */
  console.log('\n[2] 第 1 关 → 通关解锁');
  run_('PLAYER_ANIMS.bodyRatioW = 8; PLAYER_ANIMS.bodyRatioH = 2;');   // 保证接到花
  run_('LEVELS.forEach(l => { l.target = 30; l.bombRate = 0; });');     // 压低目标分、先关掉炸弹
  tiles()[0].dispatch('click');
  if (!await run(500, '第 1 关')) return done();
  await sleep(700);                                                     // 等过关面板（delay 420ms）
  assert(panelShown(), '过关面板已弹出');
  assert(title().includes('通过'), '弹出过关面板：' + title());
  assert(saved().unlocked === 2, '存档已解锁到第 2 关');
  assert(el('resultBox').__classes.has('hidden'), '闯关模式不显示分数结算');
  assert(el('btnPrimary').textContent.includes('下'), '主按钮是「下一关」');

  /* ---- 3. 进第 2 关，分数必须归零 ---- */
  console.log('\n[3] 进入第 2 关：分数重置');
  el('btnPrimary').dispatch('click');
  assert(num('score') === 0, '左上角分数归零（实际 ' + el('score').textContent + '）');
  assert(num('levelNum') === 2, '关卡号变成 2');
  assert(el('levelScore').textContent.startsWith('0 /'), '进度条从 0 起算');

  /* ---- 4. 返回关卡选择，确认解锁已生效 ---- */
  console.log('\n[4] 通关第 2 关后返回菜单');
  if (!await run(500, '第 2 关')) return done();
  await sleep(700);
  assert(panelShown(), '第 2 关过关面板已弹出');
  el('btnSecondary').dispatch('click');
  assert(saved().unlocked >= 3, '存档已解锁到第 3 关');
  assert(tiles()[1].disabled === false && tiles()[2].disabled === false, '第 2、3 关格子已解锁');
  assert(tiles()[3].disabled === true, '第 4 关仍锁住');

  /* ---- 4b. 暂停功能 ---- */
  console.log('\n[4b] 暂停功能');
  // 把目标分抬高，避免测暂停的过程中关卡就先通过了（后面 [5c] 会恢复成 30）
  run_('LEVELS.forEach(l => l.target = 99999);');
  tiles()[0].dispatch('click');
  if (!await run(60, '暂停前')) return done();
  const scoreBefore = num('score');

  el('btnPause').dispatch('click');                     // 点右上角暂停按钮
  assert(pauseShown(), '点暂停按钮后面板弹出');
  if (!await run(120, '暂停中')) return done();
  assert(num('score') === scoreBefore, `暂停期间分数不推进（${scoreBefore}）`);

  pressKey('escape');                                   // ESC 恢复
  assert(!pauseShown(), '按 ESC 后暂停面板收起');
  if (!await run(150, '继续后')) return done();
  assert(num('score') >= scoreBefore, `继续后能正常计分（${num('score')}）`);

  pressKey('escape');                                   // ESC 再暂停
  assert(pauseShown(), '再按 ESC 能重新暂停');

  el('btnPauseRestart').dispatch('click');              // 重新开始本关
  assert(num('score') === 0, '重新开始后分数归零');
  assert(!pauseShown(), '重新开始后暂停面板收起');
  if (!await run(60, '重开后')) return done();

  el('btnPause').dispatch('click');
  el('btnPauseHome').dispatch('click');                 // 返回主页面
  assert(!pauseShown(), '返回主页面后暂停面板收起');
  assert(!el('overlayStart').__classes.has('hidden'), '已回到开始界面');
  pressKey('escape');
  assert(!pauseShown(), '主菜单下按 ESC 不会误弹暂停');

  /* ---- 5. 重置进度 ---- */
  console.log('\n[5] 重置全部进度');
  el('btnReset').dispatch('click');
  assert(saved().unlocked === 1, '存档回到只解锁第 1 关');
  assert(tiles()[1].disabled === true, '第 2 关重新锁住');

  /* ---- 5b. 闯关失败：只弹「游戏结束」，不做分数结算 ---- */
  console.log('\n[5b] 闯关失败面板');
  tiles()[0].dispatch('click');
  // 全扔炸弹 + 出得极密，保证 3 条命在测试帧数内掉光
  run_('LEVELS.forEach(l => { l.bombRate = 1; l.heartRate = 0; l.spawnStart = 60; l.spawnMin = 60; });');
  if (!await run(600, '撞炸弹')) return done();
  await sleep(1600);                                                     // 等死亡动画播完（约 1.28s）
  assert(panelShown(), '失败面板已弹出');
  assert(title() === '游戏结束', '标题是「游戏结束」：' + title());
  assert(el('resultBox').__classes.has('hidden'), '闯关失败也不显示分数结算');
  assert(el('btnSecondary').textContent.includes('关卡选择'), '次按钮是「返回关卡选择」');
  el('btnSecondary').dispatch('click');
  run_('LEVELS.forEach(l => { l.bombRate = 0; l.spawnStart = 1150; l.spawnMin = 780; });');

  /* ---- 5c. 并排炸弹：成排出现时应该明显更快掉血 ---- */
  console.log('\n[5c] 并排炸弹');
  run_('PLAYER_ANIMS.anims.dead.fps = 40;');   // 加速死亡动画，缩短每轮之间的等待
  const bombCfg = { target: 999999, bombRate: 1, heartRate: 0, spawnStart: 110, spawnMin: 110, bombFall: 1 };
  const solo = await avgDeath({ ...bombCfg, bombDouble: 0, bombTriple: 0 }, '单颗');
  const pair = await avgDeath({ ...bombCfg, bombDouble: 1, bombTriple: 0 }, '双炸弹');
  const trio = await avgDeath({ ...bombCfg, bombDouble: 0, bombTriple: 1 }, '三炸弹');
  console.log(`      平均掉光 3 条命所需帧数 → 单颗 ${solo.avg} / 双 ${pair.avg} / 三 ${trio.avg}`);
  assert(solo.all.every(v => v > 0), '单颗炸弹能被打死：' + solo.all.join(','));
  assert(pair.all.every(v => v > 0), '双炸弹能被打死：' + pair.all.join(','));
  assert(trio.all.every(v => v > 0), '三炸弹能被打死：' + trio.all.join(','));
  assert(pair.avg < solo.avg, `双炸弹比单颗明显更快（${pair.avg} < ${solo.avg}）`);
  assert(trio.avg < solo.avg, `三炸弹比单颗明显更快（${trio.avg} < ${solo.avg}）`);
  // 恢复成正常关卡参数，后面的关卡流程还要用
  run_('LEVELS.forEach(l => Object.assign(l, { target: 30, bombRate: 0, spawnStart: 1150, spawnMin: 780, bombFall: 1, bombDouble: 0, bombTriple: 0 }));');

  /* ---- 6. 一路打到通关，解锁无尽模式 ---- */
  console.log('\n[6] 连过 5 关 → 解锁无尽模式');
  tiles()[0].dispatch('click');
  const skies = [];
  for (let lv = 1; lv <= 5; lv++) {
    if (!await run(500, '第 ' + lv + ' 关')) return done();
    skies.push(lastSky);                                    // 记录本关天空渐变
    await sleep(700);
    assert(panelShown(), `第 ${lv} 关过关面板已弹出`);
    if (lv < 5) {
      assert(title().includes('通过'), `第 ${lv} 关过关：${title()}`);
      el('btnPrimary').dispatch('click');
    }
  }
  assert(new Set(skies).size === 5, '5 关的天空各不相同（主题生效）');
  assert(title().includes('全部通关'), '第五关后弹出「全部通关」：' + title());
  assert(saved().endless === true, '存档已解锁无尽模式');
  assert(el('btnPrimary').textContent.replace(/\s/g, '').includes('无尽'), '主按钮是「去无尽模式」');

  /* ---- 7. 背景主题表完整性 ---- */
  console.log('\n[7] 背景主题');
  assert(run_('THEMES.length') === 5, '共 5 套主题：' + run_('THEMES.map(t => t.name).join(" / ")'));
  const broken = run_('JSON.stringify(THEMES.filter(t => !t.sky || !t.grass || !t.hill || !t.orb || !t.tuft).map(t => t.name))');
  assert(broken === '[]', '每套主题配色齐全（sky/grass/hill/orb/tuft）');

  /* ---- 8. 无尽模式：升档 + 累计计分 ---- */
  console.log('\n[8] 无尽模式');
  el('btnPrimary').dispatch('click');
  assert(el('levelSuffix').textContent === '档', 'HUD 切成「档」');
  run_('ENDLESS.stageStep = 60;');
  if (!await run(400, '无尽模式')) return done();
  assert(num('levelNum') >= 2, '按分数自动升档（当前第 ' + el('levelNum').textContent + ' 档）');
  assert(num('score') > 0, '无尽模式分数累计：' + el('score').textContent);

  /* ---- 9. 背景音乐：顺序轮播 + 两个独立声音开关 ---- */
  console.log('\n[9] BGM 顺序轮播 / 独立声音开关');
  const bgmEl = registry['bgm'];
  assert(bgmEl !== undefined, 'BGM 已启用：<audio id="bgm"> 已注册');
  assert(registry['btnMusic'] !== undefined, '音乐按钮已注册');
  const tracks = JSON.parse(run_('JSON.stringify(BGM.playlist.map(t => t.src))'));
  assert(tracks.length === 4, '播放列表共 4 首：' + tracks.length);
  assert(tracks.every(p => p.startsWith('assets/bgm/')), '4 首都在 assets/bgm/ 下');
  assert(bgmEl.loop === false, '单曲 loop 关闭（轮播由 ended 事件接管）');
  assert(bgmEl.src === tracks[0], '开局加载第 1 首：' + tracks[0]);

  run_('BGM.fadeMs = 20;');   // 加速淡入淡出，免得测试等 400ms × 4
  const seq = [bgmEl.src];
  for (let i = 0; i < 4; i++) {
    bgmEl.dispatch('ended');  // 模拟一首播完
    await sleep(90);
    seq.push(bgmEl.src);
  }
  assert(seq[1] === tracks[1] && seq[2] === tracks[2] && seq[3] === tracks[3],
    '按顺序 1→2→3→4：' + seq.slice(0, 4).map(s => s.split('/').pop()).join(' → '));
  assert(seq[4] === tracks[0], '第 4 首播完绕回第 1 首：' + seq[4].split('/').pop());

  // 两个开关各自独立，互不影响
  el('btnSound').dispatch('click');
  assert(store['flower-catch-sound'] === 'off', '点音效键：音效关');
  assert(store['flower-catch-music'] === undefined, '点音效键：不改动音乐存档');
  assert(el('btnSound').__classes.has('muted'), '音效按钮变灰');
  assert(!el('btnMusic').__classes.has('muted'), '音乐按钮仍高亮');

  el('btnMusic').dispatch('click');
  assert(store['flower-catch-music'] === 'off', '点音乐键：音乐关');
  assert(store['flower-catch-sound'] === 'off', '点音乐键：不改动音效存档');
  assert(el('btnMusic').__classes.has('muted'), '音乐按钮变灰');
  assert(el('btnSound').__classes.has('muted'), '音效按钮保持灰');

  el('btnSound').dispatch('click');
  el('btnMusic').dispatch('click');
  assert(store['flower-catch-sound'] === 'on' && store['flower-catch-music'] === 'on', '两个都能独立打开');
  assert(!el('btnSound').__classes.has('muted') && !el('btnMusic').__classes.has('muted'), '两个按钮都恢复高亮');

  /* ---- 10. 爱心回血（用户反馈：无尽模式吃爱心没回血） ---- */
  console.log('\n[10] 爱心回血');
  run_('PLAYER_ANIMS.bodyRatioW = 8; PLAYER_ANIMS.bodyRatioH = 2;');  // 花/爱心判定覆盖全屏
  run_('LEVELS.forEach(l => Object.assign(l, { target: 99999, heartRate: 0, bombRate: 1, spawnStart: 60, spawnMin: 60, bombDouble: 0, bombTriple: 0 }));');
  tiles()[0].dispatch('click');
  let lost = 0;
  for (let i = 0; i < 400 && lost < 1; i++) {
    const cb = rafQueue.shift();
    if (!cb) break;
    clock += 16.7; gradSeq = [];
    try { cb(clock); } catch (e) { failed++; console.log('  ✘ 异常: ' + e.message); break; }
    frames++;
    if (i % 30 === 29) await sleep(1);
    lost = emptyHearts();
  }
  assert(lost >= 1, `先用炸弹打掉血（当前空血 ${lost} 格）`);

  // 把炸弹判定带压到 1px、角色挪到最左边，然后直接切成"全是爱心"。
  // 不中断生成（spawnTimer 一旦被设成很大就回不来，会一个爱心都不掉）。
  run_('PLAYER_ANIMS.catchBand = 1;');
  el('game').dispatch('pointermove', { clientX: 20 });
  run_('LEVELS.forEach(l => Object.assign(l, { heartRate: 1, bombRate: 0, spawnStart: 60, spawnMin: 60 }));');
  if (!await run(240, '吃爱心')) return done();
  assert(emptyHearts() === 0, `吃到爱心后回满血（当前空血 ${emptyHearts()} 格）`);

  /* ---- 11. 无尽模式：2 格血吃爱心，HUD 和实际血量都必须真的 +1 ----
     用户反馈「显示了 +1 ♥ 但右上角和实际上都没涨」，之前的 [10] 只覆盖闯关模式。 */
  console.log('\n[11] 无尽模式爱心回血（非满血）');
  run_('PLAYER_ANIMS.catchBand = 24;');
  run_('ENDLESS.stageStep = 999999; ENDLESS.heartRate = 0; ENDLESS.bombMax = 1;');
  run_('LEVELS.forEach(l => Object.assign(l, { target: 99999, bombRate: 1, bombDouble: 0, bombTriple: 0, spawnStart: 60, spawnMin: 60 }));');
  el('btnEndless').dispatch('click');
  assert(el('levelSuffix').textContent === '档', '已切到无尽模式');

  let lost11 = 0;
  for (let i = 0; i < 400 && lost11 < 1; i++) {
    el('game').dispatch('pointermove', { clientX: (454 + Math.sin(i / 16) * 380) * 900 / 908 });
    const cb = rafQueue.shift();
    if (!cb) break;
    clock += 16.7; gradSeq = [];
    try { cb(clock); } catch (e) { failed++; console.log('  ✘ 异常: ' + e.message); break; }
    frames++;
    if (i % 30 === 29) await sleep(1);
    lost11 = emptyHearts();
  }
  assert(lost11 >= 1, `先掉到 2 格血（当前空血 ${lost11} 格）`);

  // 隔离场上残留炸弹（压到 1px 判定带 + 角色挪到最左边），再切成"全是爱心"
  run_('PLAYER_ANIMS.catchBand = 1;');
  el('game').dispatch('pointermove', { clientX: 20 });
  run_('ENDLESS.heartRate = 1; ENDLESS.bombMax = 0;');
  run_('LEVELS.forEach(l => Object.assign(l, { bombRate: 0, bombDouble: 0, bombTriple: 0 }));');
  if (!await run(240, '无尽模式吃爱心')) return done();
  assert(emptyHearts() === 0, `无尽模式吃爱心后回满血（当前空血 ${emptyHearts()} 格）`);

  /* ---- 12. 确定性复现：同一帧里爱心和炸弹同时命中 ----
     无尽模式后期炸弹密集，玩家经常"刚吃到爱心就又中炸弹"。 */
  console.log('\n[12] 同帧「爱心 + 炸弹」结算');
  run_('PLAYER_ANIMS.catchBand = 24;');
  run_(`(function () {
    const s = __test.state;
    s.phase = 'playing';
    s.mode = 'endless';
    s.lives = 2;
    s.items.length = 0;
    s.playerX = 454; s.targetX = 454; s.velX = 0; s.moveDir = 0;
    __test.renderLives();
    const cfg = { fallScale: 1, bombFall: 1 };
    const hr = __test.hitRect('heart');
    const br = __test.hitRect('bomb');
    s.items.push(Object.assign(__test.makeItem('heart', 0, s.playerX, cfg),
      { x: s.playerX, y: hr.top + 20, vy: 10, vx: 0 }));
    s.items.push(Object.assign(__test.makeItem('bomb', 0, s.playerX, cfg),
      { x: s.playerX, y: br.top + 10, vy: 10, vx: 0 }));
  })()`);
  assert(emptyHearts() === 1, '起点：2 格血，场上 1 爱心 + 1 炸弹');

  const cb12 = rafQueue.shift();
  if (cb12) {
    clock += 16.7;
    try { cb12(clock); } catch (e) { failed++; console.log('  ✘ 异常: ' + e.message); }
    frames++;
  }
  const after12 = emptyHearts();
  console.log(`      一帧后剩余空格：${after12}（0 = 回血保住了，1 = 被炸弹抵消）`);
  assert(after12 === 0, '吃到爱心后血量真的 +1，不会被同帧炸弹抵消');

  /* ---- 13. 无尽模式排行榜（全服共享 / CloudBoard 桩） ---- */
  console.log('\n[13] 无尽排行榜');
  el('overlayBoard').classList.add('hidden');       // 模拟 HTML 里的 class="overlay hidden"
  // 前面 [8]/[11] 的无尽模式现在会实时落榜，这里从空榜开始，保证下面的条数断言干净
  cloudBoardStub.clear();

  // a. 首页 ID 默认值
  assert(el('playerId').value === '童琴99', '首页 ID 默认「童琴99」（实际：' + el('playerId').value + '）');

  // b. 改 ID 并持久化
  el('playerId').value = '路赖OvO';
  el('playerId').dispatch('change');
  assert(store['flower-catch-player-id-v1'] === '路赖OvO', '改完 ID 已保存');

  // c. 排行榜面板开 / 关
  el('btnBoard').dispatch('click');
  assert(!el('overlayBoard').__classes.has('hidden'), '点「排行榜」面板弹出');
  assert(el('boardList').__classes.has('hidden'), '空榜单时列表隐藏、显示占位提示');
  el('btnBoardClose').dispatch('click');
  assert(el('overlayBoard').__classes.has('hidden'), '点「关闭」面板收起');

  // d. 当前主机首次上榜
  run_('__test.state.score = 5000; __test.submitBoard("路赖OvO");');
  let board = cloudBoardStub.list();
  assert(board.length === 1 && board[0].id === '路赖OvO' && board[0].score === 5000,
    '首次上榜写入一条（' + board[0].id + ' · ' + board[0].score + ' 分）');
  assert(board[0].tag === 1, '首个该 ID 的玩家编号为 1');

  // e. 同名玩家、不同主机 → 拿到互不冲突的新编号
  run_('(function(){ localStorage.setItem("flower-catch-host-key-v1", "H-guest-host"); __test.state.score = 3000; __test.submitBoard("路赖OvO"); })()');
  board = cloudBoardStub.list();
  assert(board.length === 2, '不同主机同名玩家各占一条');
  assert(new Set(board.map(e => e.tag)).size === 2, '编号互不冲突：#' + board.map(e => e.tag).join(' / #'));
  assert(board[0].score === 5000 && board[1].score === 3000, '按分数降序（5000 → 3000）');

  // f. 渲染：同名冲突时两条都带灰色编号
  run_('__test.renderBoard();');
  const bHtml = String(el('boardList').innerHTML);
  assert((bHtml.match(/board-tag/g) || []).length === 2, '同名条目显示编号');
  assert(bHtml.includes('#1') && bHtml.includes('#2'), '编号 1 / 2 都渲染出来');
  assert(bHtml.includes('路赖OvO') && !bHtml.includes('&lt;'), 'ID 正常转义输出');

  // g. 同主机再上榜 → 更新自己的最高分而不是新增条目
  run_('(function(){ localStorage.setItem("flower-catch-host-key-v1", "H-guest-host"); __test.state.score = 4200; __test.submitBoard("路赖OvO"); })()');
  board = cloudBoardStub.list();
  assert(board.length === 2 && board.some(e => e.score === 4200),
    '同主机同名上榜是更新而非新增（现在 ' + board.map(e => e.score).join(' / ') + '）');

  // h. 无尽破纪录 → 结算面板出现上榜输入行；空 ID 自动用默认值落榜
  run_('(function(){ __test.state.mode = "endless"; __test.state.phase = "playing"; __test.state.lives = 0; __test.state.score = 123; __test.state.best = 0; __test.state.runBest = 0; __test.gameOver(); })()');
  await sleep(1500);                                // 等死亡动画播完、面板弹出
  assert(!el('overlayOver').__classes.has('hidden'), '结算面板已弹出');
  assert(!el('recordBox').__classes.has('hidden'), '破纪录出现「上榜 ID」输入行');
  assert(el('recordId').value === '路赖OvO', '输入行预填当前 ID');
  el('recordId').value = '';                        // 留空 → 应自动用默认 ID
  el('btnSecondary').dispatch('click');            // 直接关面板 → 自动提交
  board = cloudBoardStub.list();
  assert(board.some(e => e.id === '童琴99'), '空 ID 自动以默认「童琴99」上榜');
  assert(el('recordBox').__classes.has('hidden'), '上榜后输入行收起');
  assert(board.length === 3, '榜单共 3 条（路赖OvO ×2 + 童琴99 ×1）');

  /* ---- 14. 退出路径：打完回首页必须能看到排名 ----
     用户反馈「打完之后退出到首页点开排行榜没看到有排名」。
     根因：上榜只挂在结算面板的按钮上，主动退出（暂停→返回主页面）没有
     结算面板，成绩整个丢了。修法 = 破纪录实时落榜 + 离开兜底。 */
  console.log('\n[14] 退出路径与排行榜');

  // 路径 A：阵亡结算 → 返回菜单 → 点排行榜
  cloudBoardStub.clear();
  run_('(function(){ const s=__test.state; s.best=0; s.runBest=0; s.playerId="童琴99"; s.mode="endless"; s.phase="playing"; s.score=400; s.lives=0; __test.gameOver(); })()');
  await sleep(1500);
  assert(!el('recordBox').__classes.has('hidden'), 'A：阵亡破纪录出现上榜输入行');
  el('btnSecondary').dispatch('click');           // 返回菜单 → 自动提交
  el('btnBoard').dispatch('click');
  assert(String(el('boardList').innerHTML).includes('童琴99'), 'A：阵亡结算后排行榜能看到排名');
  el('btnBoardClose').dispatch('click');

  // 路径 B：没阵亡，暂停 → 返回主页面 → 点排行榜（用户实际走的路，修复前榜单是空的）
  cloudBoardStub.clear();
  run_('(function(){ const s=__test.state; s.mode="endless"; s.phase="playing"; s.score=600; s.best=0; s.runBest=0; s.lives=3; s.playerId="童琴99"; })()');
  el('btnPause').dispatch('click');
  el('btnPauseHome').dispatch('click');
  el('btnBoard').dispatch('click');
  assert(String(el('boardList').innerHTML).includes('童琴99'),
    'B：暂停返回主页面后排行榜也能看到排名');
  assert(el('boardEmpty').__classes.has('hidden'), 'B：空榜单提示已收起');
  el('btnBoardClose').dispatch('click');

  // 路径 C：不点任何面板，接花破纪录的瞬间就写榜（对应"直接关掉网页 / 刷新"）
  cloudBoardStub.clear();
  run_('(function(){ const s=__test.state; s.mode="endless"; s.phase="playing"; s.score=0; s.best=0; s.runBest=0; s.playerId="童琴99"; s.combo=0; })()');
  run_('__test.addScore(10, 100, 100, "#fff");');
  let liveBoard = cloudBoardStub.list();
  assert(liveBoard.length === 1 && liveBoard[0].score === 10,
    'C：接花破纪录瞬间就落榜，关掉网页也不会丢');
  run_('__test.addScore(20, 100, 100, "#fff");');
  liveBoard = cloudBoardStub.list();
  assert(liveBoard.length === 1 && liveBoard[0].score === 30,
    'C：分数继续涨时同一条记录同步更新，不会重复上榜');

  // 路径 D：暂停 → 重新开始，上一局成绩仍留在榜上
  el('btnPause').dispatch('click');
  el('btnPauseRestart').dispatch('click');         // enterGame → resetRun 会把本局分数清零
  el('btnBoard').dispatch('click');
  assert(String(el('boardList').innerHTML).includes('童琴99'),
    'D：暂停后重新开始，上一局成绩仍在榜');
  el('btnBoardClose').dispatch('click');

  // 路径 E：闯关模式得分不污染无尽排行榜
  cloudBoardStub.clear();
  run_('(function(){ const s=__test.state; s.mode="level"; s.level=1; s.phase="playing"; s.score=0; s.best=0; s.runBest=0; s.playerId="童琴99"; s.combo=0; })()');
  run_('__test.addScore(10, 100, 100, "#fff");');
  assert(cloudBoardStub.list().length === 0, 'E：闯关模式得分不写进无尽排行榜');

  /* ---- 15. 清除按钮：只清本机最高分 + 自己云端那条 ---- */
  console.log('\n[15] 清除我的成绩（测试按钮）');

  // 先造出一组完整数据
  store['flower-catch-endless-best-v1'] = '888';
  cloudBoardStub.setList([
    { id: '童琴99', tag: 1, host: 'H-test', score: 888, at: 1 },
  ]);
  store['flower-catch-progress-v1'] = JSON.stringify({ unlocked: 4, endless: true });
  store['flower-catch-player-id-v1'] = '童琴99';
  store['flower-catch-host-key-v1'] = 'H-test';

  // A：取消确认 → 什么都不清
  sandbox.window.confirm = () => false;
  el('btnClearScores').dispatch('click');
  assert(store['flower-catch-endless-best-v1'] === '888' &&
         cloudBoardStub.list().length === 1, 'A：取消确认时数据保持不变');
  sandbox.window.confirm = () => true;

  // B：确认清除 → 两个分数键都清掉，内存状态同步归零
  el('btnClearScores').dispatch('click');
  assert(!store['flower-catch-endless-best-v1'], 'B：历史最高分已清除');
  assert(cloudBoardStub.list().length === 0, 'B：榜单记录已清除');
  assert(run_('__test.state.best') === 0 && run_('__test.state.runBest') === 0,
    'B：内存里的最高分与破纪录基准同步归零');

  // C：关卡进度 / ID / 主机编号保留，清完给提示
  assert(saved().unlocked === 4 && saved().endless === true, 'C：关卡解锁进度保留');
  assert(store['flower-catch-player-id-v1'] === '童琴99', 'C：上榜 ID 保留');
  assert(store['flower-catch-host-key-v1'] === 'H-test', 'C：主机编号保留');
  assert(String(el('clearMsg').textContent).includes('已清除'), 'C：清完给了页面提示');

  // D：排行榜面板开着时清除 → 立刻刷新成空榜
  cloudBoardStub.setList([
    { id: '路赖OvO', tag: 1, host: 'H-test', score: 999, at: 2 },
  ]);
  el('btnBoard').dispatch('click');
  assert(String(el('boardList').innerHTML).includes('路赖OvO'), 'D：清除前榜上有一条');
  el('btnClearScores').dispatch('click');
  assert(!String(el('boardList').innerHTML).includes('路赖OvO'), 'D：面板立刻刷新成空榜');
  assert(!el('boardEmpty').__classes.has('hidden'), 'D：空榜单占位提示出现');
  el('btnBoardClose').dispatch('click');

  /* ---- 16. 自适应缩放：竖屏所有游戏物体一起缩小 ----
     用户反馈「手机竖屏空间太小、炸弹太大躲不开」。
     核心：makeItem 的 size 同时用于绘制和碰撞判定，所以只要它乘
     VIEW.scale，视觉与判定就会同步缩，不会出现"看着小、判定还大"。 */
  console.log('\n[16] 自适应缩放（竖屏 vs 桌面）');

  const appEl = el('app');
  const deskW = appEl.clientWidth, deskH = appEl.clientHeight;
  run_('__test.layout()');
  const dScale = run_('VIEW.scale');
  const dBomb = run_('__test.makeItem("bomb", 0, 400, { fallScale: 1 }).size');
  const dRectW = run_('__test.hitRect("bomb").w');
  console.log(`      桌面：W=${run_('VIEW.w')} scale=${dScale.toFixed(3)} 炸弹size=${dBomb.toFixed(1)} 判定宽=${dRectW.toFixed(1)}`);
  assert(dScale > 0.95 && dScale < 1.1, '桌面缩放系数接近 1（画面完全不变）');
  assert(Math.abs(dBomb - 26 * dScale) < 0.01, '桌面炸弹尺寸 = 26 × scale');

  // 模拟手机竖屏 370×760
  appEl.clientWidth = 370; appEl.clientHeight = 760;
  run_('__test.layout()');
  const pScale = run_('VIEW.scale');
  const pBomb = run_('__test.makeItem("bomb", 0, 190, { fallScale: 1 }).size');
  const pFlower = run_('__test.makeItem("flower", 0, 190, { fallScale: 1 }).size');
  const pHeart = run_('__test.makeItem("heart", 0, 190, { fallScale: 1 }).size');
  const pRectW = run_('__test.hitRect("bomb").w');
  console.log(`      竖屏：W=${run_('VIEW.w')} scale=${pScale.toFixed(3)} 炸弹size=${pBomb.toFixed(1)} 花size=${pFlower.toFixed(1)} 爱心size=${pHeart.toFixed(1)} 判定宽=${pRectW.toFixed(1)}`);
  assert(run_('VIEW.w') === 380, '竖屏逻辑宽度被 minW=380 兜住');
  assert(pScale >= 0.59 && pScale <= 0.61, '竖屏缩放系数约 0.6');
  assert(pBomb < dBomb * 0.7, `竖屏炸弹明显更小（${pBomb.toFixed(1)} < ${(dBomb * 0.7).toFixed(1)}）`);
  assert(Math.abs(pBomb - 26 * pScale) < 0.01 &&
         Math.abs(pFlower - 26 * pScale) < 0.01 &&
         Math.abs(pHeart - 26 * pScale) < 0.01,
    '炸弹 / 花 / 爱心共用同一系数，视觉与判定同步');
  assert(pRectW < dRectW * 0.7, '竖屏接住判定框同比缩小（不会看着小、判定还大）');

  // 恢复桌面尺寸，别影响收尾
  appEl.clientWidth = deskW; appEl.clientHeight = deskH;
  run_('__test.layout()');

  /* ---- 17. 投掷者避让贴顶 HUD：窄屏下移，宽屏原位 ----
     用户要求「UI 放回顶部 + 把投掷者往下挪让开 HUD」，并确认接受
     下落距离变短（不改 vy0 / gravity）。 */
  console.log('\n[17] 投掷者避让贴顶 HUD');

  const desk = JSON.parse(run_('JSON.stringify(__test.topOffsets())'));
  console.log(`      桌面：W=${desk.W} 投掷者脚底=${desk.throwerFootY.toFixed(1)} 掉落起点=${desk.dropStartY.toFixed(1)}`);
  assert(desk.W > 820, '桌面逻辑宽度 > 820（不触发避让）');
  assert(Math.abs(desk.throwerFootY - desk.H * 0.184) < 0.01, '桌面投掷者保持原位 H*0.184');
  assert(Math.abs(desk.dropStartY - desk.H * 0.234) < 0.01, '桌面掉落起点保持原位 H*0.234');

  appEl.clientWidth = 370; appEl.clientHeight = 760;
  run_('__test.layout()');
  const phone = JSON.parse(run_('JSON.stringify(__test.topOffsets())'));
  console.log(`      竖屏：W=${phone.W} 投掷者脚底=${phone.throwerFootY.toFixed(1)} 掉落起点=${phone.dropStartY.toFixed(1)}`);
  assert(phone.W === 380 && phone.W <= 820, '竖屏触发避让');
  assert(phone.throwerFootY > desk.throwerFootY + 80, '竖屏投掷者明显下移');
  assert(phone.throwerFootY - phone.hudBottom >= 155 * 0.6,
    '投掷者头顶在 HUD 底部之下（完整露出，不被挡）');
  assert(phone.dropStartY > phone.throwerFootY, '掉落起点仍在投掷者脚底下方，符合「往下扔」');
  const dDist = desk.groundY - desk.dropStartY, pDist = phone.groundY - phone.dropStartY;
  console.log(`      下落距离：桌面 ${dDist.toFixed(0)} → 竖屏 ${pDist.toFixed(0)}（-${((1 - pDist / dDist) * 100).toFixed(0)}%）`);
  assert(pDist < dDist * 0.8, '下落距离确实变短（用户已确认接受变难）');

  appEl.clientWidth = deskW; appEl.clientHeight = deskH;
  run_('__test.layout()');

  /* ---- 18. 手机掉落节奏：反应时间与电脑持平 ----
     用户反馈「手机比电脑掉落速度快、难度太高」。真实原因是窄屏下落距离
     被压缩 29%，而 vy0 / gravity 没变。修法：初速与重力同乘 fallPace，
     让"落完窄屏距离"等价于"用原速落宽屏距离"。电脑 fallPace 恒为 1。 */
  console.log('\n[18] 手机掉落节奏补偿');

  const vy0 = run_('CONFIG.item.vy0');
  const grav = run_('CONFIG.item.gravity');
  const fallTime = (dist, k) => {
    const v = vy0 * k, a = grav * k;
    return (-v + Math.sqrt(v * v + 2 * a * dist)) / a;
  };

  run_('__test.layout()');
  const desk2 = JSON.parse(run_('JSON.stringify(__test.topOffsets())'));
  const tDesk = fallTime(desk2.groundY - desk2.dropStartY, desk2.fallPace);
  console.log(`      桌面：fallPace=${desk2.fallPace.toFixed(3)} 反应时间=${tDesk.toFixed(3)}s`);
  assert(desk2.fallPace === 1, '桌面节奏系数恒为 1（电脑完全不变）');

  run_('(function(){ Math.random = function(){ return 0.5; }; })()');
  const dVy = run_('__test.makeItem("flower", 0, 400, { fallScale: 1 }).vy');

  appEl.clientWidth = 370; appEl.clientHeight = 760;
  run_('__test.layout()');
  const phone2 = JSON.parse(run_('JSON.stringify(__test.topOffsets())'));
  const tPhone = fallTime(phone2.groundY - phone2.dropStartY, phone2.fallPace);
  const pVy = run_('__test.makeItem("flower", 0, 190, { fallScale: 1 }).vy');
  console.log(`      竖屏：fallPace=${phone2.fallPace.toFixed(3)} 反应时间=${tPhone.toFixed(3)}s 初速=${dVy.toFixed(1)}→${pVy.toFixed(1)}`);
  assert(phone2.fallPace > 0.65 && phone2.fallPace < 0.75, '竖屏按剩余距离同比放慢');
  assert(Math.abs(tPhone - tDesk) < 0.01,
    `手机反应时间与电脑持平（${tPhone.toFixed(3)}s vs ${tDesk.toFixed(3)}s）`);
  assert(Math.abs(pVy - dVy * phone2.fallPace) < 0.01, '生成的初速确实按系数缩小');
  assert(run_('CONFIG.player.speed') === 470 && grav === 105,
    '生成密度 / 角色速度 / 全局配置均未改动');

  appEl.clientWidth = deskW; appEl.clientHeight = deskH;
  run_('__test.layout()');

  done();
})();

function done() {
  console.log('');
  console.log(`总帧数：${frames}   失败断言：${failed}   循环存活：${rafQueue.length > 0 ? '是' : '否'}`);
  console.log(failed === 0 ? '✔ 全部通过' : '✘ 有失败项，见上方 ✘');
  process.exit(failed === 0 ? 0 : 1);
}
