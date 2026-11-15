/* ==========================================================================
   节奏体检：用**真实**关卡参数跑一关，看分数/进度到底涨得多快。
   tools/headless.js 为了跑得快会把 target 压到 30，可能掩盖真实体感问题。
   用法：node tools/pace.js
   ========================================================================== */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const grad = { addColorStop() {} };
const ctxStub = () => new Proxy({ canvas: { width: 900, height: 640 } }, {
  get(t, p) {
    if (p in t) return t[p];
    if (p === 'measureText') return () => ({ width: 10 });
    return () => grad;
  },
  set(t, p, v) { t[p] = v; return true; },
});

function elStub(tag = 'div') {
  const listeners = {};
  const cls = new Set();
  const e = {
    tagName: tag, id: '', textContent: '', style: {}, disabled: false,
    clientWidth: 900, clientHeight: 640, offsetWidth: 900,
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
    volume: 1, loop: false, currentTime: 0,
    play() { return Promise.resolve(); }, pause() {}, load() {},
  };
  let _html = '';
  Object.defineProperty(e, 'innerHTML', {
    get: () => _html,
    set: v => { _html = v; if (v === '') e.children.length = 0; },
  });
  return e;
}

const registry = Object.create(null);
const rafQueue = [];
const store = Object.create(null);
class ImageStub {
  constructor() { this._nw = 320; this._nh = 320; this.onload = null; this.complete = true; }
  get naturalWidth() { return this._nw; }
  get naturalHeight() { return this._nh; }
  set src(v) { setTimeout(() => this.onload && this.onload(), 0); }
}

const sandbox = {
  console, Math, Date, JSON, Array, Object, String, Number, Boolean, Error, Promise,
  isNaN, parseInt, parseFloat, setTimeout, clearTimeout, setInterval, clearInterval,
  document: {
    getElementById: id => registry[id] || (registry[id] = elStub()),
    querySelector: s => registry[s] || (registry[s] = elStub()),
    querySelectorAll: () => [],
    createElement: t => elStub(t),
    addEventListener() {}, body: elStub(), documentElement: elStub(),
  },
  Image: ImageStub,
  performance: { now: () => Date.now() },
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  },
  getComputedStyle: () => ({ paddingLeft: '10px', paddingRight: '10px', paddingTop: '10px', paddingBottom: '10px' }),
  requestAnimationFrame: cb => rafQueue.push(cb),
  matchMedia: () => ({ matches: false }),
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.devicePixelRatio = 1;
sandbox.window.innerWidth = 900;
sandbox.window.innerHeight = 640;
sandbox.window.addEventListener = () => {};
sandbox.window.confirm = () => true;
sandbox.window.requestAnimationFrame = sandbox.requestAnimationFrame;

// 必须在加载脚本**之前**写好存档，否则 game.js 初始化时读到的还是空进度
store['flower-catch-progress-v1'] = JSON.stringify({ unlocked: 5, endless: true });

const ctx = vm.createContext(sandbox);
for (const f of ['js/config.js', 'js/sprites.js', 'js/game.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}

const el = id => registry[id];
const sleep = ms => new Promise(r => setTimeout(r, ms));
let clock = Date.now();

(async () => {
  await sleep(40);
  const level = Number(process.argv[2] || 1);
  const seconds = Number(process.argv[3] || 60);
  el('overlayOver').classList.add('hidden');   // 模拟 HTML 里的 class="overlay hidden"

  const target = vm.runInContext(`LEVELS[${level - 1}].target`, ctx);
  console.log(`第 ${level} 关 · 目标分 ${target} · 模拟 ${seconds} 秒\n`);

  el('levelGrid').children[level - 1].dispatch('click');
  const canvas = el('game');
  let cleared = false;
  let lastText = '';

  for (let i = 0; i < seconds * 60; i++) {
    // 角色来回横扫接花（模拟正常游玩）
    canvas.dispatch('pointermove', { clientX: (454 + Math.sin(i / 22) * 390) * 900 / 908 });
    const cb = rafQueue.shift();
    if (!cb) { console.log('✘ 主循环断了'); return; }
    clock += 16.7;
    try { cb(clock); } catch (e) { console.log('✘ 异常: ' + e.message + '\n' + e.stack.split('\n')[1]); return; }
    if (i % 60 === 59) await sleep(1);
    if (i % 600 === 599) {
      const t = el('levelScore').textContent;
      const lost = (String(el('lives').innerHTML).match(/heart empty/g) || []).length;
      console.log(`  ${((i + 1) / 60).toFixed(0)}s  分数 ${String(el('score').textContent).padStart(5)}  ` +
                  `进度 ${t.padStart(12)}  进度条 ${String(el('levelFill').style.width).padStart(6)}  ` +
                  `剩余生命 ${'♥'.repeat(3 - lost)}${'·'.repeat(lost)}${lost >= 3 ? ' ← 已阵亡' : ''}`);
      lastText = t;
    }
    if (!el('overlayOver').__classes.has('hidden') && !cleared) {
      cleared = true;
      console.log(`\n★ ${(i / 60).toFixed(1)}s 时弹出面板：${el('overTitle').textContent} — ${el('overSub').textContent}`);
      break;
    }
  }
  if (!cleared) console.log(`\n⚠ ${seconds} 秒还没过关，最后一次进度：${lastText}`);
})();
