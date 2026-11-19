/* ==========================================================================
   game.js · 主逻辑
   状态机： menu（主菜单） → playing（游戏中） → over（结束）
   ========================================================================== */

(() => {
  'use strict';

  // 逻辑尺寸：随设备屏幕比例在 layout() 中重算（电脑 / 平板 / 手机通用）
  let W = CONFIG.canvas.refW;
  let H = CONFIG.canvas.baseH;
  let GROUND_Y = Math.round(H * 0.793);
  let marginX = CONFIG.player.margin;
  let basketW = CONFIG.player.basketWidth;
  let dpr = 1;

  // 与 sprites.js 中 drawPlayer 的骨架保持一致（方便以后换素材时只改一处）
  const PLAYER = {
    get footY() { return GROUND_Y + 6; },
    basketBottomOffset: 118,  // 篮底 = footY - 118 * VIEW.scale
    basketHeight: 40,         // 篮高 = 40 * VIEW.scale
  };

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const app = document.getElementById('app');
  const stage = document.getElementById('stage');

  // 屏幕越宽，玩家跑动距离越长 —— 按宽度微调速度与节奏，保证手感一致
  const widthRatio = () => W / CONFIG.canvas.refW;
  const playerSpeed = () => CONFIG.player.speed * (0.74 + 0.26 * widthRatio());
  const spawnScale = () => 0.92 + 0.08 * widthRatio();

  const el = {
    hud: document.getElementById('hud'),
    score: document.getElementById('score'),
    scoreCard: document.querySelector('.score-card'),
    combo: document.getElementById('combo'),
    comboNum: document.getElementById('comboNum'),
    lives: document.getElementById('lives'),
    levelPrefix: document.getElementById('levelPrefix'),
    levelSuffix: document.getElementById('levelSuffix'),
    levelNum: document.getElementById('levelNum'),
    levelScore: document.getElementById('levelScore'),
    levelFill: document.getElementById('levelFill'),
    overTitle: document.getElementById('overTitle'),
    overIcon: document.getElementById('overIcon'),
    overSub: document.getElementById('overSub'),
    resultBox: document.getElementById('resultBox'),
    start: document.getElementById('overlayStart'),
    over: document.getElementById('overlayOver'),
    pause: document.getElementById('overlayPause'),
    pauseInfo: document.getElementById('pauseInfo'),
    bgm: document.getElementById('bgm'),
    btnMusic: document.getElementById('btnMusic'),
    btnPause: document.getElementById('btnPause'),
    btnResume: document.getElementById('btnResume'),
    btnPauseRestart: document.getElementById('btnPauseRestart'),
    btnPauseHome: document.getElementById('btnPauseHome'),
    finalScore: document.getElementById('finalScore'),
    bestScore: document.getElementById('bestScore'),
    newRecord: document.getElementById('newRecord'),
    startHint: document.getElementById('startHint'),
    levelGrid: document.getElementById('levelGrid'),
    btnEndless: document.getElementById('btnEndless'),
    endlessHint: document.getElementById('endlessHint'),
    btnReset: document.getElementById('btnReset'),
    btnStart: document.getElementById('btnStart'),
    btnPrimary: document.getElementById('btnPrimary'),
    btnSecondary: document.getElementById('btnSecondary'),
    btnSound: document.getElementById('btnSound'),
    playerId: document.getElementById('playerId'),
    btnBoard: document.getElementById('btnBoard'),
    board: document.getElementById('overlayBoard'),
    boardList: document.getElementById('boardList'),
    boardEmpty: document.getElementById('boardEmpty'),
    btnBoardClose: document.getElementById('btnBoardClose'),
    recordBox: document.getElementById('recordBox'),
    recordId: document.getElementById('recordId'),
    btnRecord: document.getElementById('btnRecord'),
  };

  /* --------------------- 存档：解锁进度 / 无尽最高分 ---------------------
     存在浏览器 localStorage 里，关掉网页再打开还在。
     未解锁的关卡没有任何手动解锁途径 —— 只能靠通关前一关。
     ------------------------------------------------------------------- */
  function loadProgress() {
    let unlocked = 1, endless = false;
    try {
      const raw = JSON.parse(localStorage.getItem(CONFIG.progressKey) || '{}');
      unlocked = Math.min(LEVELS.length, Math.max(1, Number(raw.unlocked) || 1));
      endless = !!raw.endless;
    } catch (e) { /* 存档坏了就当新号，从第 1 关开始 */ }
    return { unlocked, endless };
  }

  function saveProgress() {
    try {
      localStorage.setItem(CONFIG.progressKey,
        JSON.stringify({ unlocked: progress.unlocked, endless: progress.endless }));
    } catch (e) { /* 隐私模式下写不进去也不影响本次游玩 */ }
  }

  const progress = loadProgress();

  /* ----------------------------- 游戏状态 ----------------------------- */
  const state = {
    phase: 'menu',
    mode: 'level',           // 'level' 闯关模式 | 'endless' 无尽模式
    time: 0,
    score: 0,                // 闯关 = 本关分（进关清零）；无尽 = 本局累计分
    best: Number(localStorage.getItem(CONFIG.endlessBestKey) || 0),
    combo: 0,
    lives: CONFIG.lives,
    level: 1,                // 当前关卡（1 ~ LEVELS.length）
    stage: 1,                // 无尽模式档位（每 ENDLESS.stageStep 分 +1）
    stars: [],               // 星空（夜空主题）
    weather: [],             // 飘落物：花瓣 / 雪花 / 萤火虫
    banner: null,            // 横幅提示 { title, sub, t }
    playerX: W / 2,
    targetX: W / 2,
    moveDir: 0,
    controlMode: 'mouse',
    velX: 0,
    playerAnim: { key: 'idle', t: 0, index: 0, hidden: false },
    hurt: 0,
    shake: 0,
    flash: 0,
    throwerX: W / 2,
    throwerDir: 1,
    throwPhase: 1,
    spawnTimer: 900,
    items: [],
    particles: [],
    texts: [],
    clouds: [],
    grassTufts: [],
    sound: localStorage.getItem('flower-catch-sound') !== 'off',   // 音效（接花/爆炸/死亡）
    music: localStorage.getItem('flower-catch-music') !== 'off',   // 背景音乐，跟音效分开存
    playerId: localStorage.getItem(CONFIG.board.playerIdKey) || CONFIG.board.defaultId,  // 排行榜 ID
  };

  /* 接东西的判定框 —— 花朵和炸弹用不同的框：
     花朵 = 全身（碰到身子任何位置都算接到）；炸弹 = 头顶的接住区（保持原样）。
     没有帧动画时退回内置篮子的几何。 */
  const hitRect = type => {
    const s = VIEW.scale;
    const footY = PLAYER.footY;
    const px = state.playerX;
    const framed = !!playerAnimImg(state.playerAnim);

    // 花和爱心都是"好东西"，共用全身大框；只有炸弹用下面的头顶小框
    if (type === 'flower' || type === 'heart') {
      const h = (framed ? PLAYER_ANIMS.displaySize * PLAYER_ANIMS.bodyRatioH : 120) * s;
      const w = (framed ? PLAYER_ANIMS.displaySize * PLAYER_ANIMS.bodyRatioW : basketW) * s;
      return { cx: px, top: footY - h, bottom: footY + 6 * s, w };
    }

    if (framed) {
      const top = footY - PLAYER_ANIMS.catchY * s;
      // 判定宽度跟着角色走（角色的显示框通常比角色本身宽出一圈透明边）
      const cw = Math.max(70, PLAYER_ANIMS.displaySize * 0.5) * s;
      return { cx: px, top, bottom: top + PLAYER_ANIMS.catchBand * s, w: cw };
    }

    const bottom = footY - PLAYER.basketBottomOffset * s;
    return {
      cx: px,
      top: bottom - PLAYER.basketHeight * s,
      bottom,
      w: basketW,
    };
  };

  /* ----------------------------- 音效 ----------------------------- */
  const Sound = {
    ac: null,
    ensure() {
      if (!this.ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ac = new AC();
      }
      if (this.ac && this.ac.state === 'suspended') this.ac.resume();
      return this.ac;
    },
    tone(freq, dur, type = 'sine', gain = 0.14, delay = 0) {
      if (!state.sound) return;
      const ac = this.ensure();
      if (!ac) return;
      const t0 = ac.currentTime + delay;
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    },
    slide(f1, f2, dur, type = 'sine', gain = 0.16) {
      if (!state.sound) return;
      const ac = this.ensure();
      if (!ac) return;
      const t0 = ac.currentTime;
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f1, t0);
      osc.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    },
    noise(dur = 0.25, gain = 0.2) {
      if (!state.sound) return;
      const ac = this.ensure();
      if (!ac) return;
      const len = Math.floor(ac.sampleRate * dur);
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ac.createBufferSource();
      const g = ac.createGain();
      g.gain.value = gain;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      src.buffer = buf;
      src.connect(lp).connect(g).connect(ac.destination);
      src.start();
    },
    flower(n = 0) {
      const base = 620 + Math.min(n, 6) * 70;
      this.tone(base, 0.13, 'triangle', 0.16);
      this.tone(base * 1.5, 0.14, 'sine', 0.11, 0.06);
    },
    bomb() { this.slide(220, 45, 0.42, 'sawtooth', 0.2); this.noise(0.32, 0.22); },
    miss()  { this.slide(300, 150, 0.2, 'sine', 0.1); },
    over()  { [523, 415, 330, 262].forEach((f, i) => this.tone(f, 0.32, 'triangle', 0.14, i * 0.13)); },
    start() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.16, 'sine', 0.12, i * 0.07)); },
  };

  /* ----------------------------- 背景音乐 -----------------------------
     用 <audio> 元素而不是 WebAudio：本地 file:// 打开时 fetch 会被浏览器
     禁掉，decodeAudioData 那套会直接没声音。
     播放列表 = BGM.playlist，顺序轮播：ended 事件里淡出 → 换 src → 淡入。
     音乐和音效是两个独立开关，互不影响。
     ------------------------------------------------------------------- */
  const Music = {
    audio: null,
    index: 0,
    fadeTimer: null,

    init() {
      this.audio = el.bgm;
      if (!this.audio || !BGM.playlist.length) return;
      this.audio.loop = false;          // 轮播靠 ended，单曲 loop 会卡在第一首
      this.audio.volume = BGM.volume;
      this.audio.addEventListener('ended', () => this.next());
      this.audio.addEventListener('error', () => {
        console.warn('[花朵大作战] 背景音乐加载失败：' + BGM.playlist[this.index].src);
      });
      this.load(0);
    },

    // 换到第 i 首（越界自动绕回，最后一首播完回到第 1 首）
    load(i) {
      const n = BGM.playlist.length;
      this.index = ((i % n) + n) % n;
      const track = BGM.playlist[this.index];
      this.audio.src = track.src;
      this.audio.load();
      console.log(`[花朵大作战] BGM ${this.index + 1}/${n}：${track.title}`);
    },

    // 音量渐变；到 0 时再 pause，避免直接掐断出现"咔"声
    fadeTo(target, done) {
      if (!this.audio) { if (done) done(); return; }
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
      const from = this.audio.volume;
      if (Math.abs(target - from) < 0.002) {
        this.audio.volume = target;
        if (target <= 0) this.audio.pause();
        if (done) done();
        return;
      }
      const step = 40;
      const delta = (target - from) * (step / Math.max(1, BGM.fadeMs));
      let v = from;
      this.fadeTimer = setInterval(() => {
        v += delta;
        const reached = delta > 0 ? v >= target : v <= target;
        if (reached) {
          this.audio.volume = target;
          clearInterval(this.fadeTimer);
          this.fadeTimer = null;
          if (target <= 0) this.audio.pause();
          if (done) done();
        } else {
          this.audio.volume = v;
        }
      }, step);
    },

    play() {
      if (!this.audio || !state.music) return;
      // 浏览器可能拦截自动播放（没经过用户手势），忽略即可，下次点击还会再试
      const p = this.audio.play();
      if (p && p.catch) p.catch(() => {});
      this.fadeTo(BGM.volume);
    },

    pause() { this.fadeTo(0); },

    // 一首播完：淡出 → 切下一首 → 从静音淡入
    next() {
      if (!this.audio || !state.music) return;
      this.fadeTo(0, () => {
        if (!state.music) return;        // 淡出期间刚把音乐关了就别再播
        this.load(this.index + 1);
        this.audio.volume = 0;
        const p = this.audio.play();
        if (p && p.catch) p.catch(() => {});
        this.fadeTo(BGM.volume);
      });
    },
  };

  // 音乐开关变化时同步按钮状态与播放（只在游戏进行中播放，菜单保持安静）
  function applyMusicSwitch() {
    el.btnMusic.classList.toggle('muted', !state.music);
    if (!state.music) Music.pause();
    else if (state.phase === 'playing') Music.play();
  }

  /* ----------------------------- 初始化装饰 ----------------------------- */
  function initDecor() {
    // 装饰一律用相对坐标（0~1）存储：resize 时不用重建，绘制时再乘 W / H
    const cloudCount = Math.max(4, Math.round(W / 240) + 2);
    state.clouds = [];
    for (let i = 0; i < cloudCount; i++) {
      state.clouds.push({
        rx: Math.random(),
        ry: 0.08 + Math.random() * 0.40,
        s: 0.5 + Math.random() * 0.6,
        v: 4 + Math.random() * 8,
        a: 0.5 + Math.random() * 0.4,
      });
    }

    const tuftCount = Math.max(14, Math.round(W / 36) + 6);
    state.grassTufts = [];
    for (let i = 0; i < tuftCount; i++) {
      state.grassTufts.push({
        rx: Math.random(),
        h: 12 + Math.random() * 18,
        delay: Math.random() * 6,
      });
    }

    // 星星（夜空主题才画）：相对坐标，闪烁相位随机
    state.stars = [];
    for (let i = 0; i < 90; i++) {
      state.stars.push({
        rx: Math.random(),
        ry: Math.random() * 0.55,
        r: 0.8 + Math.random() * 1.6,
        delay: Math.random() * 6,
      });
    }

    // 飘落物（花瓣 / 雪花 / 萤火虫）：同一套粒子，按主题的 weather 决定画成什么
    const wCount = Math.max(34, Math.round(W / 16));
    state.weather = [];
    for (let i = 0; i < wCount; i++) {
      state.weather.push({
        rx: Math.random(),
        ry: Math.random(),
        s: 0.5 + Math.random() * 0.9,
        vy: 0.10 + Math.random() * 0.14,      // 每秒下落屏幕高度的比例
        vx: (Math.random() * 2 - 1) * 0.035,
        sway: Math.random() * 6,
        rot: Math.random() * 6,
        rv: (Math.random() * 2 - 1) * 2.2,
      });
    }
  }

  // 飘落物按主题刷新位置（只在真的要画时才算，省性能）
  function updateWeather(dt) {
    const kind = curTheme().weather;
    if (!kind) return;
    for (const p of state.weather) {
      p.ry += p.vy * dt;
      p.rx += (p.vx + Math.sin(state.time * 1.3 + p.sway) * 0.02) * dt;
      p.rot += p.rv * dt;
      if (p.ry > 1.05) { p.ry = -0.05; p.rx = Math.random(); }
      if (p.rx > 1.06) p.rx = -0.05;
      if (p.rx < -0.06) p.rx = 1.05;
    }
  }

  /* ----------------------------- 生命 / HUD ----------------------------- */
  function renderLives(breakIndex = -1) {
    const heart = empty => `
      <svg class="heart${empty ? ' empty' : ''}" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 21.2s-7.6-4.9-9.6-9.4C.7 8.4 2.4 4.4 6.1 4.4c2.1 0 3.5 1.2 4.3 2.3.8-1.1 2.2-2.3 4.3-2.3 3.7 0 5.4 4 3.7 7.4-2 4.5-6.4 9.4-6.4 9.4z"
              fill="currentColor"/>
      </svg>`;
    el.lives.innerHTML = Array.from({ length: CONFIG.lives },
      (_, i) => heart(i >= state.lives)).join('');
    if (breakIndex >= 0) {
      const nodes = el.lives.querySelectorAll('.heart');
      if (nodes[breakIndex]) nodes[breakIndex].classList.add('breaking');
    }
  }

  function syncHud(popScore = false) {
    el.score.textContent = state.score;
    const cfg = curCfg();
    const base = scoreBase();
    const goal = scoreTarget();
    if (state.mode === 'endless') {
      el.levelPrefix.textContent = '无尽';
      el.levelSuffix.textContent = '档';
      el.levelNum.textContent = state.stage;
    } else {
      el.levelPrefix.textContent = '第';
      el.levelSuffix.textContent = '关';
      el.levelNum.textContent = state.level;
    }
    el.levelScore.textContent = `${state.score - base} / ${goal - base}`;
    const pct = goal > base ? (state.score - base) / (goal - base) : 0;
    // toFixed(1)：不取整的话会出现 "3.3000000000000003%" 这种脏值
    el.levelFill.style.width = (Math.min(100, pct * 100)).toFixed(1) + '%';
    if (popScore) {
      el.scoreCard.classList.remove('pop');
      void el.scoreCard.offsetWidth;
      el.scoreCard.classList.add('pop');
    }
    if (state.combo >= 2) {
      el.combo.classList.remove('hidden');
      el.comboNum.textContent = state.combo;
      el.combo.classList.remove('pop');
      void el.combo.offsetWidth;
    } else {
      el.combo.classList.add('hidden');
    }
  }

  /* ----------------------------- 开始 / 结束 -----------------------------
     闯关模式：分数每关重置，过关只提示"解锁下一关"，不做分数结算。
     无尽模式：分数累计、按分升档，结束时才显示得分与最高分。
     ------------------------------------------------------------------- */
  // 结束面板上两个按钮当前对应的动作（由 showPanel 写入）
  let pendingPrimary = null;
  let pendingSecondary = null;

  const bannerDur = () => (state.mode === 'endless' ? ENDLESS.bannerTime : CONFIG.levels.bannerTime);

  function resetRun() {
    state.score = 0;
    state.combo = 0;
    state.lives = CONFIG.lives;     // 无论从哪一关开始都是满血 3 点
    state.items.length = 0;
    state.particles.length = 0;
    state.texts.length = 0;
    state.hurt = 0;
    state.shake = 0;
    state.flash = 0;
    state.spawnTimer = 700;
    state.banner = null;
    state.playerX = W / 2;
    state.targetX = W / 2;
    restartAnim('idle');
    renderLives();
    syncHud();
  }

  function enterGame(mode, level = 1) {
    Sound.ensure();
    Sound.start();
    state.mode = mode;
    if (mode === 'endless') state.stage = 1;
    else state.level = Math.max(1, Math.min(LEVELS.length, level));
    resetRun();
    state.phase = 'playing';
    el.start.classList.add('hidden');
    el.over.classList.add('hidden');
    el.pause.classList.add('hidden');
    el.hud.classList.remove('hidden');
    Music.play();   // 这里是用户点击产生的手势，正好用来启动 BGM
  }

  /* ----------------------------- 暂停 -----------------------------
     phase 切成 'paused'：主循环不再 update/draw，画面定格在最后一帧。
     ---------------------------------------------------------------- */
  function pauseGame() {
    if (state.phase !== 'playing') return;
    state.phase = 'paused';
    el.pauseInfo.textContent = state.mode === 'endless'
      ? `无尽模式 · 第 ${state.stage} 档 · ${state.score} 分`
      : `第 ${state.level} 关 · ${state.score} / ${scoreTarget()}`;
    // 无尽模式没有"本关"概念，按钮文案跟着换
    el.btnPauseRestart.textContent = state.mode === 'endless' ? '重新开始' : '重新开始本关';
    el.pause.classList.remove('hidden');
    Music.pause();
  }

  function resumeGame() {
    if (state.phase !== 'paused') return;
    state.phase = 'playing';
    el.pause.classList.add('hidden');
    Music.play();
  }

  function togglePause() {
    if (state.phase === 'playing') pauseGame();
    else if (state.phase === 'paused') resumeGame();
  }

  const startLatest = () => enterGame('level', progress.unlocked);
  const startEndless = () => { if (progress.endless) enterGame('endless'); };

  function backToMenu() {
    state.phase = 'menu';
    el.over.classList.add('hidden');
    el.pause.classList.add('hidden');
    el.hud.classList.add('hidden');
    el.start.classList.remove('hidden');
    Music.pause();
    renderMenu();
  }

  /* --------------------- 无尽模式排行榜（本地版） ---------------------
     数据存在浏览器 localStorage，没有服务器；以后接后端只换 boardStore 两个函数。
     同名玩家的编号：按"主机指纹"分配 —— 首次运行生成随机标识并永久保存，
     同一台机器永远拿同一个编号，不同机器互不冲突。编号只在同名玩家超过
     一个时才显示（排行榜里透明灰色小字）。 */
  const esc = s => String(s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const boardStore = {
    load() {
      try { return JSON.parse(localStorage.getItem(CONFIG.board.key) || '[]'); }
      catch (e) { return []; }
    },
    save(list) {
      try { localStorage.setItem(CONFIG.board.key, JSON.stringify(list)); } catch (e) {}
    },
  };

  function hostKey() {
    let k = null;
    try { k = localStorage.getItem(CONFIG.board.hostKey); } catch (e) {}
    if (!k) {
      k = 'H' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      try { localStorage.setItem(CONFIG.board.hostKey, k); } catch (e) {}
    }
    return k;
  }

  // 上榜：同名 + 同主机 → 更新自己的最高分；否则按主机指纹分配新编号
  function submitBoard(rawId) {
    const id = String(rawId == null ? el.recordId.value : rawId).trim() || CONFIG.board.defaultId;
    state.playerId = id;
    try { localStorage.setItem(CONFIG.board.playerIdKey, id); } catch (e) {}
    el.playerId.value = id;                        // 首页 ID 跟着同步
    el.recordId.value = id;

    const list = boardStore.load();
    const host = hostKey();
    const mine = list.find(e => e.id === id && e.host === host);
    if (mine) {
      mine.score = Math.max(mine.score, state.score);
      mine.at = Date.now();
    } else {
      const same = list.filter(e => e.id === id);
      const tag = same.length ? Math.max(...same.map(e => e.tag || 1)) + 1 : 1;
      list.push({ id, tag, host, score: state.score, at: Date.now() });
    }
    list.sort((a, b) => b.score - a.score || a.at - b.at);
    boardStore.save(list.slice(0, CONFIG.board.max));
    el.recordBox.classList.add('hidden');           // 已上榜，收起输入区（也当作"已提交"标记）
  }

  // 结算面板的两个按钮被点时：还没手动上榜的话，用输入框当前值自动提交
  function flushBoard() {
    if (el.recordBox.classList.contains('hidden')) return;
    submitBoard();
  }

  function renderBoard() {
    const list = boardStore.load();
    const counts = {};
    list.forEach(e => { counts[e.id] = (counts[e.id] || 0) + 1; });
    const host = hostKey();
    el.boardList.innerHTML = list.map((e, i) => {
      const tag = counts[e.id] > 1 ? ` <i class="board-tag">#${e.tag || 1}</i>` : '';
      const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}`;
      return `<li class="board-row${e.host === host ? ' me' : ''}">
        <b class="board-rank">${medal}</b>
        <span class="board-name">${esc(e.id)}${tag}</span>
        <span class="board-score">${e.score}</span>
      </li>`;
    }).join('');
    el.boardList.classList.toggle('hidden', !list.length);
    el.boardEmpty.classList.toggle('hidden', !!list.length);
  }

  /* 结束面板：标题 + 副标题 + 主按钮 + 次按钮；只有无尽模式带分数结算 */
  function showPanel(opt) {
    state.phase = opt.phase;
    el.overIcon.textContent = opt.icon;
    el.overTitle.textContent = opt.title;
    el.overSub.textContent = opt.sub;
    el.resultBox.classList.toggle('hidden', !opt.showResult);
    el.btnPrimary.textContent = opt.primaryText;
    el.btnSecondary.textContent = opt.secondaryText;
    pendingPrimary = opt.onPrimary;
    pendingSecondary = opt.onSecondary;
    el.newRecord.classList.add('hidden');
    el.recordBox.classList.add('hidden');      // 只有破纪录的结算才重新亮出来

    if (opt.showResult) {
      const isNew = state.score > state.best;
      if (isNew) {
        state.best = state.score;
        try { localStorage.setItem(CONFIG.endlessBestKey, String(state.best)); } catch (e) {}
        // 新纪录 → 亮出"上榜 ID"输入行；点"上榜"立即写入，
        // 不点就关面板（再来一次 / 返回菜单）也会自动提交
        el.recordId.value = state.playerId;
        el.recordBox.classList.remove('hidden');
      }
      el.finalScore.textContent = state.score;
      el.bestScore.textContent = state.best;
      el.newRecord.classList.toggle('hidden', !isNew);
    }
    setTimeout(() => el.over.classList.remove('hidden'), opt.delay || 0);
  }

  // 生命掉光：闯关不结算分数，只给"再来一次 / 返回关卡选择"
  function gameOver() {
    Sound.over();
    restartAnim('dead');
    const endless = state.mode === 'endless';
    // 等死亡动画播得差不多再弹面板（动画延长后会盖住）
    showPanel({
      phase: 'over',
      icon: '✸',
      title: '游戏结束',
      sub: endless ? `本局 ${state.score} 分 · 撑到第 ${state.stage} 档` : `第 ${state.level} 关没能通过`,
      showResult: endless,
      primaryText: '再 来 一 次',
      secondaryText: endless ? '返回菜单' : '返回关卡选择',
      onPrimary: () => enterGame(state.mode, state.level),
      onSecondary: backToMenu,
      delay: animDuration('dead') * 1000 * 0.8,
    });
  }

  /* ----------------------------- 生成掉落物 ----------------------------- */
  /* --------------------- 难度参数 / 生成 --------------------- */
  // 当前生效的难度：闯关 = LEVELS 表里那一行；无尽 = 在第 5 关基础上按档位叠加
  function curCfg() {
    if (state.mode !== 'endless') return LEVELS[Math.min(state.level - 1, LEVELS.length - 1)];
    const s = state.stage - 1;
    const b = LEVELS[LEVELS.length - 1];
    const cut = s * ENDLESS.spawnCutPerStage;
    return {
      bombRate: Math.min(ENDLESS.bombMax, b.bombRate + s * ENDLESS.bombPerStage),
      spawnStart: Math.max(ENDLESS.spawnMinFloor, b.spawnStart - cut),
      spawnMin: Math.max(ENDLESS.spawnMinFloor, b.spawnMin - cut),
      fallScale: b.fallScale + s * ENDLESS.fallPerStage,
      heartRate: ENDLESS.heartRate,
      // 炸弹越到后面掉得越快、越爱成排出现（都有上限，避免完全没法玩）
      bombFall: Math.min(ENDLESS.bombFallMax, b.bombFall + s * ENDLESS.bombFallPerStage),
      bombDouble: Math.min(0.6, b.bombDouble + s * 0.01),
      bombTriple: Math.min(ENDLESS.tripleMax, b.bombTriple + s * 0.02),
    };
  }

  // 当前背景主题：闯关按关卡号，无尽模式每升一档换一张
  const curTheme = () => THEMES[(state.mode === 'endless' ? state.stage : state.level) - 1]
    || THEMES[(state.level - 1) % THEMES.length];

  // 进度条起点 / 终点：闯关 = 0 → 本关目标分；无尽 = 本档起点分 → 下一档阈值
  const scoreBase = () => (state.mode === 'endless' ? (state.stage - 1) * ENDLESS.stageStep : 0);
  const scoreTarget = () => (state.mode === 'endless'
    ? state.stage * ENDLESS.stageStep
    : LEVELS[Math.min(state.level - 1, LEVELS.length - 1)].target);

  // 当前区间内的进度 0~1（节奏随之收紧）
  const levelProgress = () => {
    const b = scoreBase();
    const g = scoreTarget();
    return g > b ? Math.min(1, (state.score - b) / (g - b)) : 0;
  };

  // 按权重挑一种已解锁的花：越靠后的花权重越低 = 越稀有（无尽模式 5 种全开）
  function pickFlowerKind() {
    const n = state.mode === 'endless' ? FLOWERS.length : Math.min(state.level, FLOWERS.length);
    const pool = FLOWERS.slice(0, n);
    const total = pool.reduce((s, f) => s + f.rate, 0);
    let r = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].rate;
      if (r <= 0) return i;
    }
    return 0;
  }

  // 造一个掉落物：炸弹额外乘 bombFall，所以后期炸弹明显比花掉得快
  function makeItem(type, kind, x, cfg) {
    const f = FLOWERS[kind] || FLOWERS[0];
    return {
      x: Math.max(30, Math.min(W - 30, x)),
      y: H * 0.234,
      vx: (Math.random() * 2 - 1) * 45,
      vy: (CONFIG.item.vy0 + Math.random() * 25) * cfg.fallScale *
          (type === 'bomb' ? (cfg.bombFall || 1) : 1),
      rot: Math.random() * Math.PI,
      size: CONFIG.item.radius * (type === 'flower' ? f.size : 1),
      type,
      kind,
      fuseT: 0,
      dead: false,
    };
  }

  // 后期关卡：有概率一次并排掉下 2 个或 3 个炸弹
  function spawnBombGroup(cfg) {
    const dbl = cfg.bombDouble || 0;
    const trp = cfg.bombTriple || 0;
    const r = Math.random();
    const n = r < trp ? 3 : (r < trp + dbl ? 2 : 1);
    const gap = Math.min(104, W / 7);
    const start = state.throwerX - gap * (n - 1) / 2;
    for (let i = 0; i < n; i++) {
      state.items.push(makeItem('bomb', 0, start + gap * i + (Math.random() * 16 - 8), cfg));
    }
  }

  function spawnItem() {
    const cfg = curCfg();
    const r = Math.random();
    let type = 'flower';
    let kind = 0;
    if (cfg.heartRate > 0 && r < cfg.heartRate) type = 'heart';
    else if (r < cfg.heartRate + cfg.bombRate) type = 'bomb';
    else kind = pickFlowerKind();

    if (type === 'bomb') spawnBombGroup(cfg);
    else state.items.push(makeItem(type, kind, state.throwerX + (Math.random() * 40 - 20), cfg));

    state.throwPhase = 0;
    const p = levelProgress();
    state.spawnTimer = (cfg.spawnStart + (cfg.spawnMin - cfg.spawnStart) * p) * spawnScale();
  }

  /* ----------------------------- 特效工具 ----------------------------- */
  function burst(x, y, kind) {
    if (kind === 'flower') {
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 60 + Math.random() * 160;
        state.particles.push({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
          life: 0.7 + Math.random() * 0.4, age: 0,
          color: Math.random() > 0.5 ? PALETTE.flowerPetal : PALETTE.flowerCore,
          size: 4 + Math.random() * 5, kind: 'petal', rot: Math.random() * 6, rv: Math.random() * 8 - 4,
        });
      }
    } else if (kind === 'boom') {
      for (let i = 0; i < 22; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 80 + Math.random() * 260;
        state.particles.push({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80,
          life: 0.45 + Math.random() * 0.5, age: 0,
          color: ['#ff8a3d', '#ffd447', '#ff5252', '#8c8c8c'][Math.floor(Math.random() * 4)],
          size: 3 + Math.random() * 7, kind: 'spark', rot: 0, rv: 0,
        });
      }
    } else { // dust 落地灰尘
      for (let i = 0; i < 8; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
        const sp = 40 + Math.random() * 90;
        state.particles.push({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 0.4 + Math.random() * 0.3, age: 0,
          color: 'rgba(150,130,100,.75)', size: 3 + Math.random() * 4,
          kind: 'spark', rot: 0, rv: 0,
        });
      }
    }
  }

  function floatText(x, y, text, color) {
    state.texts.push({ x, y, text, color, age: 0, life: 0.9 });
  }

  function addScore(base, x, y, color, note = '') {
    // 第 1 朵是基础分，之后每连击一次 +25% 倍率，上限 CONFIG.score.comboMax
    const raw = 1 + Math.max(0, state.combo - 1) * CONFIG.score.comboStep * 0.25;
    const mul = Math.min(CONFIG.score.comboMax, raw);
    const delta = Math.round(base * mul);
    state.score += delta;
    const label = (note ? note + ' ' : '') +
      (mul > 1 ? `+${delta} ×${mul.toFixed(1)}` : `+${delta}`);
    floatText(x, y, label, color || (mul > 1 ? '#ff8a3d' : '#3fa96b'));
    syncHud(true);
    checkProgress();
  }

  /* --------------------- 回血道具 / 关卡进度 --------------------- */
  function healUp(x, y) {
    if (state.lives < CONFIG.lives) {
      state.lives++;
      renderLives();                            // 别传 breakIndex：那是扣血时的碎裂动画
      floatText(x, y - 10, '+1 ♥', '#ff4d6d');
    } else {
      // 满血时折算成分数，飘字写清楚"满血"，避免误以为吃了没反应
      addScore(30, x, y - 10, '#ff4d6d', '满血');
    }
    Sound.tone(880, 0.12, 'sine', 0.14);
    Sound.tone(1320, 0.16, 'sine', 0.12, 0.08);
    burst(x, y, 'flower');
  }

  /* 达到目标后：闯关 = 解锁下一关并弹面板；无尽 = 升一档，只闪个横幅继续打 */
  function checkProgress() {
    if (state.phase !== 'playing') return;
    if (state.score < scoreTarget()) return;
    if (state.mode === 'endless') endlessStageUp();
    else if (state.level >= LEVELS.length) allCleared();
    else levelCleared();
  }

  // 无尽模式升档：不打断游戏，难度再上一档
  function endlessStageUp() {
    state.stage++;
    state.banner = { title: `第 ${state.stage} 档！`, sub: '掉得更快、炸弹更多', t: 0 };
    [659, 880, 1174].forEach((f, i) => Sound.tone(f, 0.16, 'triangle', 0.13, i * 0.08));
    syncHud();
  }

  /* 通关第 N 关（N < 5）：解锁下一关 —— 这是唯一的解锁途径，写进存档 */
  function levelCleared() {
    const next = state.level + 1;
    if (progress.unlocked < next) {
      progress.unlocked = next;
      saveProgress();
    }
    const nf = FLOWERS[Math.min(next - 1, FLOWERS.length - 1)];
    [523, 659, 784, 1046].forEach((f, i) => Sound.tone(f, 0.18, 'triangle', 0.14, i * 0.1));
    state.items.length = 0;      // 清屏，面板弹出时画面干净
    showPanel({
      phase: 'cleared',
      icon: '✿',
      title: `第 ${state.level} 关 通过！`,
      sub: `已解锁第 ${next} 关 · 新花 ${nf.name} 每朵 +${nf.score}`,
      showResult: false,
      primaryText: '下 一 关',
      secondaryText: '返回关卡选择',
      onPrimary: () => enterGame('level', next),
      onSecondary: backToMenu,
      delay: 420,
    });
  }

  /* 通关第 5 关：解锁无尽模式 */
  function allCleared() {
    progress.endless = true;
    saveProgress();
    [523, 659, 784, 1046, 1318].forEach((f, i) => Sound.tone(f, 0.24, 'triangle', 0.15, i * 0.12));
    state.items.length = 0;
    showPanel({
      phase: 'allcleared',
      icon: '🏆',
      title: '全部通关！',
      sub: '5 关全部通过 · 无尽模式已解锁',
      showResult: false,
      primaryText: '去 无 尽 模 式',
      secondaryText: '返回关卡选择',
      onPrimary: () => enterGame('endless'),
      onSecondary: backToMenu,
      delay: 420,
    });
  }

  /* --------------------- 开始界面：关卡选择 --------------------- */
  function renderMenu() {
    el.startHint.textContent = `从第 ${progress.unlocked} 关开始`;

    el.levelGrid.innerHTML = '';
    for (let i = 1; i <= LEVELS.length; i++) {
      const locked = i > progress.unlocked;
      const b = document.createElement('button');
      b.className = 'tile' + (locked ? ' locked' : '');
      b.innerHTML = `<b>${locked ? '🔒' : i}</b><span>${locked ? '未解锁' : LEVELS[i - 1].target + ' 分'}</span>`;
      if (locked) b.disabled = true;
      else b.addEventListener('click', () => enterGame('level', i));
      el.levelGrid.appendChild(b);
    }

    el.btnEndless.classList.toggle('locked', !progress.endless);
    el.btnEndless.disabled = !progress.endless;
    el.endlessHint.textContent = progress.endless ? '撑到最后，分数没有上限' : '通关第 5 关后解锁';
  }

  /* ----------------------------- 更新 ----------------------------- */
  function update(dt) {
    state.time += dt;

    // 云飘动（速度换算成每秒移动的相对比例，换屏幕不会突变）
    state.clouds.forEach(c => {
      c.rx += (c.v * dt) / W;
      if (c.rx > 1.15) c.rx = -0.15;
    });

    updateThrower(dt);
    updatePlayer(dt);
    updatePlayerAnim(dt);
    updateWeather(dt);

    // 受击闪烁 / 抖动 / 投掷动作
    if (state.hurt > 0) state.hurt -= dt;
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 3.2);
    if (state.flash > 0) state.flash = Math.max(0, state.flash - dt * 2.4);
    if (state.throwPhase < 1) state.throwPhase = Math.min(1, state.throwPhase + dt * 3.2);
    // 横幅只用于提示（无尽升档 / 过关），到点自动消失，不阻塞游戏
    if (state.banner) {
      state.banner.t += dt;
      if (state.banner.t > bannerDur()) state.banner = null;
    }

    if (state.phase === 'playing') {
      state.spawnTimer -= dt * 1000;
      if (state.spawnTimer <= 0) spawnItem();
    }

    updateItems(dt, state.phase === 'playing');
    updateParticles(dt);
  }

  function updateThrower(dt) {
    const pad = Math.max(70, 130 * VIEW.scale);
    state.throwerX += state.throwerDir * 70 * dt;
    if (state.throwerX > W - pad) { state.throwerX = W - pad; state.throwerDir = -1; }
    if (state.throwerX < pad) { state.throwerX = pad; state.throwerDir = 1; }
  }

  function updatePlayer(dt) {
    if (state.playerAnim.key === 'dead') { state.velX = 0; return; }   // 角色已消散，停止移动
    const p = CONFIG.player;
    if (state.controlMode === 'keys') {
      const targetVel = state.moveDir * playerSpeed();
      state.velX += (targetVel - state.velX) * Math.min(1, dt * 14);
      state.playerX += state.velX * dt;
    } else {
      const diff = state.targetX - state.playerX;
      const lerp = Math.min(1, p.mouseLerp * dt * 60);
      state.velX = diff * lerp / Math.max(dt, 0.0001);
      state.playerX += diff * lerp;
    }
    state.playerX = Math.max(marginX, Math.min(W - marginX, state.playerX));
  }

  /* --------------------- 玩家动作状态机 ---------------------
     优先级：dead（不可打断）> hurt / catch（一次性，播完自动回）> walk > idle
     --------------------------------------------------------- */
  function setAnim(key) {
    const a = state.playerAnim;
    if (a.key === key) return;               // 同动作不重置，走路/站立才能连续播
    restartAnim(key);
  }

  function restartAnim(key) {                // 强制从头播（接花/受击时反复触发）
    const a = state.playerAnim;
    a.key = key;
    a.t = 0;
    a.index = 0;
    a.hidden = false;
  }

  const animDuration = key => {
    const def = PLAYER_ANIMS.anims[key];
    return def ? def.frames.length / def.fps : 0;
  };

  // 接花动作：已经播过六成才允许重播，否则连击时会一直卡在第一帧
  function playCatchAnim() {
    const a = state.playerAnim;
    if (a.key !== 'catch' || a.t >= animDuration('catch') * 0.6) restartAnim('catch');
  }

  function updatePlayerAnim(dt) {
    const a = state.playerAnim;
    const def = PLAYER_ANIMS.anims[a.key] || PLAYER_ANIMS.anims.idle;
    a.t += dt;
    const n = def.frames.length;
    const idx = Math.floor(a.t * def.fps);

    if (def.loop) {
      a.index = idx % n;
    } else if (idx >= n) {
      if (a.key === 'dead') { a.index = n - 1; a.hidden = true; return; }  // 消散完毕
      setAnim('idle');                       // catch / hurt 播完 → 回站立
      return;
    } else {
      a.index = idx;
    }

    if (a.key === 'dead') return;            // 死亡不可打断
    if (!def.loop) return;                   // 一次性动作播放中不被走路打断

    const moving = Math.abs(state.velX) > 30;
    if (moving) setAnim(state.velX < 0 ? 'walkLeft' : 'walkRight');
    else if (a.key !== 'idle') setAnim('idle');
  }

  function updateItems(dt, collide) {
    const hits = [];   // 本帧命中的道具先收集，最后统一结算
    for (const it of state.items) {
      it.vy += CONFIG.item.gravity * dt;
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      it.rot += CONFIG.item.spinSpeed * dt * (it.type === 'bomb' ? 0.6 : 1);
      it.fuseT += dt;

      if (it.x < 24 || it.x > W - 24) {
        it.vx *= -1;
        it.x = Math.max(24, Math.min(W - 24, it.x));
      }

      // 接住判定：花朵用全身大框，炸弹用头顶接住区
      const r = hitRect(it.type);
      const halfW = r.w / 2 + 4;
      if (collide && it.vy > 0 && it.y > r.top - 12 && it.y < r.bottom + 10 &&
          Math.abs(it.x - r.cx) < halfW + it.size * 0.25) {
        it.dead = true;
        hits.push({ it, r });
        continue;
      }

      // 落地（按视觉半径判定，避免放大的素材"陷进"草地）
      if (it.y > GROUND_Y + it.size * assetScale(it.type) * 0.35) {
        it.dead = true;
        if (it.type === 'flower') {
          if (collide) { state.combo = 0; syncHud(); }
          Sound.miss();
          burst(it.x, GROUND_Y, 'dust');
        } else {
          burst(it.x, GROUND_Y, 'boom');
          Sound.slide(180, 60, 0.2, 'sine', 0.06);
        }
      }
    }
    state.items = state.items.filter(it => !it.dead);

    /* 统一结算：先加花 / 回血，再处理炸弹。
       本帧吃到爱心时，爱心会吸收这一帧的炸弹伤害 —— 否则会出现
       「+1 ♥ 飘了、右上角却没涨」：回血被同一帧里的炸弹立刻扣回去了。
       无尽模式后期炸弹密集，爱心又用全身大判定框，很容易同时命中。 */
    const healed = hits.some(h => h.it.type === 'heart');
    for (const { it, r } of hits) {
      if (it.type === 'flower') {
        state.combo++;
        playCatchAnim();
        const f = FLOWERS[it.kind] || FLOWERS[0];
        addScore(f.score, it.x, r.top - 16, f.color);
        Sound.flower(state.combo);
        burst(it.x, it.y, 'flower');
      } else if (it.type === 'heart') {
        healUp(it.x, r.top - 10);
      } else if (healed) {
        // 被爱心挡下：炸弹照常爆开、照常有音效，但不扣血
        burst(it.x, it.y, 'boom');
        Sound.bomb();
      } else {
        takeDamage(it.x, it.y);
      }
    }
  }

  function takeDamage(x, y) {
    state.lives--;
    state.combo = 0;
    state.hurt = 0.7;
    restartAnim('hurt');
    state.shake = 1;
    state.flash = 1;
    renderLives(state.lives);
    syncHud();
    burst(x, y, 'boom');
    floatText(x, y - 10, '-1 ♥', '#ff4d6d');
    Sound.bomb();
    state.lives = Math.max(0, state.lives);
    if (state.lives <= 0 && state.phase === 'playing') gameOver();
  }

  function updateParticles(dt) {
    for (const p of state.particles) {
      p.age += dt;
      p.vy += 420 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot && (p.rot += p.rv * dt);
    }
    state.particles = state.particles.filter(p => p.age < p.life);

    for (const t of state.texts) {
      t.age += dt;
      t.y -= 52 * dt;
    }
    state.texts = state.texts.filter(t => t.age < t.life);
  }

  /* ----------------------------- 自适应布局 -----------------------------
     逻辑高度固定，逻辑宽度按设备屏幕比例伸缩 —— 电脑 / 平板 / 手机都能铺满
     且不变形、不裁切。所有游戏坐标都由 W / H 派生，切换设备只需重算一次。
     ------------------------------------------------------------------- */
  function layout() {
    const cs = getComputedStyle(app);
    const availW = Math.max(200, app.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    const availH = Math.max(200, app.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));

    const c = CONFIG.canvas;
    H = c.baseH;
    W = Math.round(Math.min(c.maxW, Math.max(c.minW, H * (availW / availH))));

    GROUND_Y = Math.round(H * 0.793);
    marginX = Math.round(Math.min(CONFIG.player.margin, W * 0.11));
    basketW = Math.round(Math.min(124, Math.max(88, W * 0.115)));

    // VIEW 供 sprites.js 做等比缩放（限制范围，避免窄屏角色过小 / 宽屏过大）
    VIEW.w = W;
    VIEW.h = H;
    VIEW.groundY = GROUND_Y;
    VIEW.scale = Math.min(1.1, Math.max(0.74, W / c.refW));

    // 舞台显示尺寸：按 contain 等比铺满可用区域
    const s = Math.min(availW / W, availH / H);
    stage.style.width = Math.floor(W * s) + 'px';
    stage.style.height = Math.floor(H * s) + 'px';

    // 像素缓冲：高 DPI 屏更清晰（上限 2 倍，兼顾手机性能）
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);

    // 把角色 / 投掷者的位置收敛到新的可移动范围
    state.playerX = Math.max(marginX, Math.min(W - marginX, state.playerX));
    state.targetX = Math.max(marginX, Math.min(W - marginX, state.targetX));
    const tPad = Math.max(70, 130 * VIEW.scale);
    state.throwerX = Math.max(tPad, Math.min(W - tPad, state.throwerX));
  }

  /* ----------------------------- 绘制 ----------------------------- */

  /* 樱花树：画在远山之前，玩家之后会盖在它前面 */
  function drawSakuraTree(x, groundY, s, night) {
    const trunkW = 15 * s;
    const trunkH = 130 * s;
    const top = groundY - trunkH;
    ctx.strokeStyle = night ? '#4a3350' : '#6b4a3a';
    ctx.lineWidth = trunkW;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, groundY + 4);
    ctx.quadraticCurveTo(x - 8 * s, groundY - trunkH * 0.5, x + 4 * s, top);
    ctx.stroke();

    const canopy = night
      ? ['rgba(120,80,150,.85)', 'rgba(150,105,175,.8)', 'rgba(96,64,124,.9)']
      : ['#ffc2d8', '#ff9ec1', '#ffd9e6'];
    const blobs = [[0, -18, 46], [-40, 6, 34], [40, 4, 36], [-22, -40, 30], [24, -38, 30]];
    blobs.forEach((b, i) => {
      ctx.fillStyle = canopy[i % canopy.length];
      ctx.beginPath();
      ctx.arc(x + b[0] * s, top + b[1] * s, b[2] * s, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawBackground() {
    const T = curTheme();

    // 天空
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, T.sky[0]);
    sky.addColorStop(0.5, T.sky[1]);
    sky.addColorStop(1, T.sky[2]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // 自己配了背景整图就优先用它（配了就不会再画主题背景）
    if (Assets.ready('bg')) {
      ctx.drawImage(Assets.imgs.bg, 0, 0, W, H);
      return;
    }

    // 星空
    if (T.star) {
      for (const st of state.stars) {
        const tw = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(state.time * 2.2 + st.delay));
        ctx.globalAlpha = tw;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(st.rx * W, st.ry * H, st.r * VIEW.scale, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // 太阳 / 月亮
    const orb = T.orb;
    const sr = orb.type === 'moon' ? 92 * VIEW.scale : 110 * VIEW.scale;
    const sx = W - sr;
    const sy = H * 0.156;
    const glow = ctx.createRadialGradient(sx, sy, sr * 0.09, sx, sy, sr);
    glow.addColorStop(0, `rgba(${orb.glow},.95)`);
    glow.addColorStop(1, `rgba(${orb.glow},0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = orb.color;
    ctx.beginPath();
    ctx.arc(sx, sy, sr * 0.345, 0, Math.PI * 2);
    ctx.fill();
    if (orb.type === 'moon') {   // 月牙：用天空色挖掉一角
      ctx.fillStyle = T.sky[0];
      ctx.beginPath();
      ctx.arc(sx - sr * 0.16, sy - sr * 0.1, sr * 0.30, 0, Math.PI * 2);
      ctx.fill();
    }

    // 云（颜色跟着主题走）
    state.clouds.forEach(c => drawCloud(ctx, c.rx * W, c.ry * H, c.s * VIEW.scale,
      c.a * (T.star ? 0.55 : 1), T.cloud));

    // 远山
    const hill = (baseY, color, offset) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-20, H);
      ctx.lineTo(-20, baseY);
      for (let x = -20; x <= W + 20; x += 20) {
        const y = baseY - Math.sin((x + offset) * 0.006) * 46 - Math.sin((x + offset) * 0.017) * 18;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W + 20, H);
      ctx.closePath();
      ctx.fill();
    };
    hill(GROUND_Y - 40, T.hill[0], 0);
    hill(GROUND_Y - 12, T.hill[1], 260);

    // 樱花树（只有樱花林主题）
    if (T.tree) {
      drawSakuraTree(W * 0.14, GROUND_Y + 6, VIEW.scale * 1.05, !!T.star);
      drawSakuraTree(W * 0.83, GROUND_Y + 6, VIEW.scale * 0.9, !!T.star);
    }

    // 草地
    const g = ctx.createLinearGradient(0, GROUND_Y, 0, H);
    g.addColorStop(0, T.grass[0]);
    g.addColorStop(1, T.grass[1]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y + 6);
    for (let x = 0; x <= W; x += 12) {
      ctx.lineTo(x, GROUND_Y + 6 - Math.sin(x * 0.03) * 3);
    }
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();

    // 草丛（颜色跟着主题，索引固定避免每帧换色闪烁）
    state.grassTufts.forEach((t, i) => {
      const sway = Math.sin(state.time * 1.6 + t.delay) * 3;
      const gx = t.rx * W;
      ctx.strokeStyle = T.tuft[i % 2];
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(gx, GROUND_Y + 4);
      ctx.quadraticCurveTo(gx + sway * 0.6, GROUND_Y - t.h * 0.6, gx + sway, GROUND_Y - t.h);
      ctx.stroke();
    });

    // 飘落物：花瓣 / 雪花 / 萤火虫
    if (T.weather) {
      for (const p of state.weather) {
        const x = p.rx * W;
        const y = p.ry * H;
        const s = p.s * VIEW.scale;
        if (T.weather === 'petals') {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(p.rot);
          ctx.fillStyle = 'rgba(255,170,200,.9)';
          ctx.beginPath();
          ctx.ellipse(0, 0, 5 * s, 3 * s, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else if (T.weather === 'snow') {
          ctx.fillStyle = 'rgba(255,255,255,.92)';
          ctx.beginPath();
          ctx.arc(x, y, 2.6 * s, 0, Math.PI * 2);
          ctx.fill();
        } else {  // fireflies 萤火虫：一闪一闪
          const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(state.time * 3 + p.sway));
          ctx.globalAlpha = tw;
          ctx.fillStyle = '#ffe37a';
          ctx.beginPath();
          ctx.arc(x, y, 2.4 * s, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = tw * 0.28;
          ctx.beginPath();
          ctx.arc(x, y, 7 * s, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  function drawItems() {
    for (const it of state.items) {
      const size = it.size;
      const visR = size * assetScale(it.type);   // 视觉半径（含素材缩放）
      // 地面投影，帮助判断落点：越接近地面越小越清晰
      const air = Math.max(0, Math.min(1, (GROUND_Y - it.y) / (GROUND_Y - 150)));
      ctx.save();
      ctx.globalAlpha = 0.26 * (1 - air * 0.75);
      ctx.fillStyle = '#3b5230';
      ctx.beginPath();
      ctx.ellipse(it.x, GROUND_Y + 2, visR * (1 - air * 0.55), 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      if (it.type === 'flower') drawFlower(ctx, it.x, it.y, size, it.rot, it.kind);
      else if (it.type === 'heart') drawHeart(ctx, it.x, it.y, size, it.fuseT);
      else drawBomb(ctx, it.x, it.y, size, it.rot, it.fuseT);
    }
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const shakeX = state.shake ? (Math.random() - 0.5) * 16 * state.shake : 0;
    const shakeY = state.shake ? (Math.random() - 0.5) * 12 * state.shake : 0;
    ctx.save();
    ctx.translate(shakeX, shakeY);

    drawBackground();

    // 投掷者
    drawThrower(ctx, state.throwerX, H * 0.184, state.time, state.throwPhase);

    drawItems();

    // 玩家（anim 非空时优先走帧动画）
    const speedRatio = state.velX / playerSpeed();
    drawPlayer(ctx, state.playerX, PLAYER.footY, state.time, speedRatio, state.hurt, basketW, state.playerAnim);

    // 粒子
    state.particles.forEach(p => {
      const k = 1 - p.age / p.life;
      ctx.save();
      ctx.globalAlpha = Math.max(0, k);
      ctx.fillStyle = p.color;
      if (p.kind === 'petal') {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * k, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });

    // 飘字（字号随屏幕宽度走，小屏不至于糊成一团）
    const floatFs = Math.max(20, Math.round(26 * W / CONFIG.canvas.refW));
    state.texts.forEach(t => {
      const k = 1 - t.age / t.life;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, k * 1.6));
      ctx.font = `800 ${floatFs}px "PingFang SC","Microsoft YaHei",sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
      ctx.restore();
    });

    ctx.restore();

    // 过关横幅
    if (state.banner) {
      const dur = bannerDur();
      const k = Math.min(1, state.banner.t / dur);
      const alpha = k < 0.15 ? k / 0.15 : (k > 0.82 ? (1 - k) / 0.18 : 1);
      const bw = Math.min(440, W * 0.86);
      const bh = Math.round(Math.min(130, H * 0.22));
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.fillStyle = 'rgba(255,255,255,.82)';
      roundRect(ctx, W / 2 - bw / 2, H / 2 - bh / 2, bw, bh, 24);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff8a3d';
      ctx.font = `800 ${Math.round(Math.max(22, Math.min(40, bw * 0.095)))}px "PingFang SC","Microsoft YaHei",sans-serif`;
      ctx.fillText(state.banner.title, W / 2, H / 2 - 6);
      ctx.fillStyle = '#46536b';
      ctx.font = `600 ${Math.round(Math.max(14, Math.min(22, bw * 0.052)))}px "PingFang SC","Microsoft YaHei",sans-serif`;
      ctx.fillText(state.banner.sub, W / 2, H / 2 + 32);
      ctx.restore();
    }

    // 受击红闪
    if (state.flash > 0) {
      ctx.save();
      ctx.globalAlpha = state.flash * 0.45;
      const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.78);
      grad.addColorStop(0, 'rgba(255,60,90,0)');
      grad.addColorStop(1, 'rgba(255,40,80,1)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  /* ----------------------------- 主循环 ----------------------------- */
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.045, (now - last) / 1000);
    last = now;
    // 暂停时不 update 也不 draw：画面定格在最后一帧，恢复时也不会有时间跳变
    if (state.phase !== 'paused') {
      update(dt);
      draw();
    }
    requestAnimationFrame(loop);
  }

  /* ----------------------------- 输入 ----------------------------- */
  function canvasX(clientX) {
    const rect = canvas.getBoundingClientRect();
    return (clientX - rect.left) / rect.width * W;
  }

  const clampX = v => Math.max(marginX, Math.min(W - marginX, v));
  canvas.addEventListener('pointermove', e => {
    if (state.phase === 'paused') return;      // 暂停时别偷偷挪位置
    state.controlMode = 'mouse';
    state.targetX = clampX(canvasX(e.clientX));
  });
  canvas.addEventListener('pointerdown', e => {
    if (state.phase === 'paused') return;
    state.controlMode = 'mouse';
    state.targetX = clampX(canvasX(e.clientX));
    Sound.ensure();
  });

  const keyDown = e => {
    const k = e.key.toLowerCase();
    if (k === 'escape') { togglePause(); e.preventDefault(); return; }
    if (k === 'arrowleft' || k === 'a') { state.controlMode = 'keys'; state.moveDir = -1; e.preventDefault(); }
    if (k === 'arrowright' || k === 'd') { state.controlMode = 'keys'; state.moveDir = 1; e.preventDefault(); }
    // 只有面板状态才响应空格/回车：等同点「主按钮」；游戏中按到不会误触发
    const panelPhase = ['menu', 'over', 'cleared', 'allcleared'].includes(state.phase);
    if (panelPhase && (k === ' ' || k === 'enter')) {
      e.preventDefault();
      if (state.phase === 'menu') startLatest();
      else if (pendingPrimary) { flushBoard(); pendingPrimary(); }
    }
  };
  const keyUp = e => {
    const k = e.key.toLowerCase();
    if ((k === 'arrowleft' || k === 'a') && state.moveDir === -1) state.moveDir = 0;
    if ((k === 'arrowright' || k === 'd') && state.moveDir === 1) state.moveDir = 0;
  };
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);

  el.btnStart.addEventListener('click', startLatest);
  el.btnEndless.addEventListener('click', startEndless);
  // 面板上任何一个"离开"动作都先把没提交的新纪录落榜（空 ID → 默认童琴99）
  el.btnPrimary.addEventListener('click', () => { flushBoard(); pendingPrimary && pendingPrimary(); });
  el.btnSecondary.addEventListener('click', () => { flushBoard(); pendingSecondary && pendingSecondary(); });
  el.btnReset.addEventListener('click', () => {
    if (!window.confirm('确定清空所有进度吗？已解锁的关卡会全部锁回去，需要重新从第 1 关打起。')) return;
    progress.unlocked = 1;
    progress.endless = false;
    saveProgress();
    renderMenu();
  });
  el.btnPause.addEventListener('click', togglePause);
  el.btnResume.addEventListener('click', resumeGame);
  el.btnPauseRestart.addEventListener('click', () => enterGame(state.mode, state.level));
  el.btnPauseHome.addEventListener('click', backToMenu);

  /* --------------------- 排行榜交互 --------------------- */
  // 首页改 ID：留空自动回退默认 ID，持久保存
  el.playerId.addEventListener('change', () => {
    const v = el.playerId.value.trim() || CONFIG.board.defaultId;
    state.playerId = v;
    el.playerId.value = v;
    try { localStorage.setItem(CONFIG.board.playerIdKey, v); } catch (e) {}
  });
  el.btnBoard.addEventListener('click', () => {
    renderBoard();
    el.board.classList.remove('hidden');
  });
  el.btnBoardClose.addEventListener('click', () => el.board.classList.add('hidden'));
  el.btnRecord.addEventListener('click', () => submitBoard());
  /* 两个独立的声音开关：
       #btnSound 只管接花 / 爆炸 / 死亡等实时合成的音效
       #btnMusic 只管 BGM 播放列表
     各自存各自的 localStorage，互不影响。 */
  el.btnSound.addEventListener('click', () => {
    state.sound = !state.sound;
    localStorage.setItem('flower-catch-sound', state.sound ? 'on' : 'off');
    el.btnSound.classList.toggle('muted', !state.sound);
    if (state.sound) Sound.tone(880, 0.1, 'sine', 0.12);   // 试听一下，确认音效还开着
  });

  el.btnMusic.addEventListener('click', () => {
    state.music = !state.music;
    localStorage.setItem('flower-catch-music', state.music ? 'on' : 'off');
    applyMusicSwitch();
  });

  // 切到别的标签页时自动停音乐，回来再续上
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) Music.pause();
    else if (state.phase === 'playing') Music.play();
  });

  // 监听所有会改变可视区域的场景：窗口缩放 / 手机旋转 / 地址栏收放
  let layoutPending = false;
  const relayout = () => {
    if (layoutPending) return;
    layoutPending = true;
    requestAnimationFrame(() => { layoutPending = false; layout(); });
  };
  window.addEventListener('resize', relayout);
  window.addEventListener('orientationchange', () => setTimeout(relayout, 150));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', relayout);

  /* ----------------------------- 启动 ----------------------------- */
  Assets.load();
  loadPlayerAnims();
  layout();
  initDecor();

  // 启动自检：1.2 秒后确认帧动画到底有没有加载上（以后换素材也能靠它排错）
  setTimeout(() => {
    const bad = Object.keys(PLAYER_ANIMS.anims).filter(k => {
      const imgs = PlayerAnims.imgs[k] || [];
      return !imgs.length || !imgs[0].naturalWidth;
    });
    const ok = bad.length === 0;
    console.log(
      `%c[花朵大作战] 角色渲染：${ok ? '帧动画 ✔' : '帧动画 ✘ → 回退到 assets/player.gif'}`,
      `color:${ok ? '#2e9e5b' : '#d9480f'};font-weight:bold`
    );
    console.log(`[花朵大作战] displaySize=${PLAYER_ANIMS.displaySize} catchY=${PLAYER_ANIMS.catchY} 画布=${W}×${H}`);
    if (!ok) console.warn('[花朵大作战] 这些动作的帧没加载上，去 assets/player/ 核对路径：', bad.join(', '));
  }, 1200);
  Music.init();
  renderLives();
  renderMenu();
  syncHud();
  el.playerId.value = state.playerId;   // 首页 ID 输入框：上次用的 ID，没设置过就是默认值
  el.btnSound.classList.toggle('muted', !state.sound);
  el.btnMusic.classList.toggle('muted', !state.music);
  requestAnimationFrame(loop);
})();
