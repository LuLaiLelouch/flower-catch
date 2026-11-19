/* ==========================================================================
   config.js · 游戏参数 & 素材替换入口
   --------------------------------------------------------------------------
   【怎么换成你自己画的素材？】
   把图片放进项目里（例如 assets/ 文件夹），然后把下面 IMAGE_ASSETS 里
   对应项目的 `src` 从 null 改成图片路径即可，代码会自动优先使用你的图片；
   留空（null）则使用 sprites.js 里内置的矢量角色。两者可以随时来回切换。

   建议尺寸（像素，人物按高度算）：
     player   玩家角色   约 120 宽 × 150 高   —— 脚在底边中心，头在上方
     thrower  投掷者     约 110 宽 × 140 高   —— 脚在底边中心
     flower   花朵       约 64  宽 × 64  高
     bomb     炸弹       约 64  宽 × 64  高
     basket   篮子       约 130 宽 × 60  高（可选，不填就用内置篮子）
     bg       背景整图   按 canvas.baseH 的高度做，宽度自适应

   每项还可以额外加：
     scale     数字，单独放大/缩小这个素材（默认 1，只影响视觉不影响判定）
     showBasket  仅 player 有效，true=图片模式也画内置篮子（默认 false）
   ========================================================================== */

const IMAGE_ASSETS = {
  player:  { src: 'assets/player.gif',  showBasket: false },
  thrower: { src: 'assets/thrower.gif' },
  flower:  { src: 'assets/flower.gif', scale: 1.7 },
  bomb:    { src: null },
  heart:   { src: null },      // 回血道具（第 3 关起出现），不填就用内置红心
  basket:  { src: null },
  bg:      { src: null },
};

/* -------------------------------------------------------------------------
   玩家动作帧动画（PNG 帧序列）
   - 帧放在 assets/player/<动作名>/ 下，按 1.png 2.png … 编号
   - fps 控制播放速度；loop=false 的动作播完一次自动回站立
   - displaySize：角色显示宽度（逻辑像素，随屏幕等比缩放）
   - anchorY：角色"脚底"在源图中的纵向位置（0=图顶 1=图底），用来把脚对齐地面
   以后想换动作：替换对应文件夹里的 PNG 即可；想加动作就加一个条目
   ------------------------------------------------------------------------- */
const seq = (dir, n) => Array.from({ length: n }, (_, i) => `assets/player/${dir}/${i + 1}.png`);

const PLAYER_ANIMS = {
  displaySize: 140,     // 角色显示宽度：嫌大/嫌小就改这个（源图 320，角色内容约占 42%）
  anchorY: 0.82,        // 脚底在源图 82% 高度处，用来把脚对齐地面
  catchY: 84,           // 接住判定线离脚底的高度 —— 要略高于角色头顶，花才会落在手上
  catchBand: 24,        // 判定带厚度：太薄会漏判，太厚会"隔空接到"
  bodyRatioH: 0.56,     // 全身判定高 = displaySize × 它（花朵专用，覆盖整个身子）
  bodyRatioW: 0.48,     // 全身判定宽 = displaySize × 它
  anims: {
    idle:      { frames: seq('walk-right', 1), fps: 1,  loop: true },   // 暂借走路第 1 帧当站立，以后可补 idle 文件夹
    walkRight: { frames: seq('walk-right', 4), fps: 9,  loop: true },
    walkLeft:  { frames: seq('walk-left', 4),  fps: 9,  loop: true },
    // 一次性动作的时长 = 帧数 ÷ fps，想播久一点就把 fps 调小
    catch:     { frames: seq('catch', 8),     fps: 10, loop: false },   // 8帧/10fps ≈ 0.8 秒
    hurt:      { frames: seq('hurt', 8),      fps: 8,  loop: false },   // 8帧/8fps  ≈ 1.0 秒
    dead:      { frames: seq('dead', 8),      fps: 5,  loop: false },   // 8帧/5fps  ≈ 1.6 秒
  },
};

/* -------------------------------------------------------------------------
   闯关模式 · 5 关难度曲线
     target      本关目标分（本关内拿到这么多分即过关）
     bombRate    炸弹出现比例
     spawnStart  本关开局生成间隔（毫秒）
     spawnMin    本关最快生成间隔（随本关进度从 spawnStart 缩到它）
     fallScale   下落速度倍率（× CONFIG.item.vy0，越大掉得越快）
     heartRate   回血道具出现比例（0 = 本关不出现，第 3 关起才有）
     bombFall    炸弹下落速度的额外倍率（再乘 fallScale，所以炸弹比花掉得快）
     bombDouble  一次生成 2 个并排炸弹的概率
     bombTriple  一次生成 3 个并排炸弹的概率（判定优先于 bombDouble）
   想改难度直接调这张表，不用动代码。
   ------------------------------------------------------------------------- */
const LEVELS = [
  { target: 300,  bombRate: 0.15, spawnStart: 1150, spawnMin: 780, fallScale: 1.00, heartRate: 0,     bombFall: 1.00, bombDouble: 0,    bombTriple: 0    },
  { target: 600,  bombRate: 0.22, spawnStart: 1000, spawnMin: 680, fallScale: 1.12, heartRate: 0,     bombFall: 1.10, bombDouble: 0.18, bombTriple: 0    },
  { target: 900,  bombRate: 0.30, spawnStart: 880,  spawnMin: 580, fallScale: 1.25, heartRate: 0.030, bombFall: 1.22, bombDouble: 0.32, bombTriple: 0.08 },
  { target: 1200, bombRate: 0.38, spawnStart: 780,  spawnMin: 500, fallScale: 1.40, heartRate: 0.035, bombFall: 1.38, bombDouble: 0.42, bombTriple: 0.18 },
  { target: 1500, bombRate: 0.46, spawnStart: 680,  spawnMin: 430, fallScale: 1.55, heartRate: 0.040, bombFall: 1.60, bombDouble: 0.48, bombTriple: 0.30 },
];

/* -------------------------------------------------------------------------
   花朵品种（随关卡累积解锁：第 N 关可以使用前 N 种）
     score   接到得分      rate  出现权重（越小越稀有）
     color   花瓣主色      color2 花瓣浅色（隔瓣交替，增加层次）
     core    花心颜色      petals 花瓣数   size 视觉大小倍率
     glow    是否带柔光（高分稀有花用）
   以后想换成自己的图：在 IMAGE_ASSETS 里加 flower1 ~ flower5 的 src 即可，
   没配的品种自动用下面这些颜色画矢量花。
   ------------------------------------------------------------------------- */
const FLOWERS = [
  { name: '粉花', score: 10, rate: 1.00, color: '#ff87b0', color2: '#ffc2d8', core: '#ffd447', petals: 5, size: 1.00, glow: false },
  { name: '金花', score: 20, rate: 0.55, color: '#ffc93c', color2: '#ffe89a', core: '#ff8c1a', petals: 6, size: 1.06, glow: false },
  { name: '蓝花', score: 30, rate: 0.40, color: '#5cc8f5', color2: '#b3e4fb', core: '#1d7fa8', petals: 6, size: 1.12, glow: true  },
  { name: '紫花', score: 40, rate: 0.30, color: '#b98cff', color2: '#dfccff', core: '#6c2fd1', petals: 8, size: 1.18, glow: true  },
  { name: '红莲', score: 50, rate: 0.22, color: '#ff5a5a', color2: '#ffaea8', core: '#b30d1f', petals: 8, size: 1.24, glow: true  },
];

/* -------------------------------------------------------------------------
   关卡背景主题：第 N 关用 THEMES[N-1]，无尽模式每升一档换一张
     sky      天空渐变三段色        grass  草地渐变两段色
     hill     两层远山颜色          cloud  云的颜色（夜晚用暗蓝紫）
     orb      天上的光体（sun 太阳 / moon 月亮）
     star     是否画星空            tree   是否画樱花树
     weather  飘落物：'petals' 花瓣 / 'snow' 雪花 / 'fireflies' 萤火虫 / null 无
     tuft     草丛的两种颜色
   想换配色改这张表；想加第 6 个主题就往数组里再推一条（无尽模式会自动轮到它）。
   ------------------------------------------------------------------------- */
const THEMES = [
  {
    name: '晴天草原',
    sky:   ['#7fd3ff', '#b9e9ff', '#eaf7ff'],
    grass: ['#8ed681', '#67b95a'],
    hill:  ['rgba(126,196,160,.55)', 'rgba(112,182,140,.7)'],
    orb:   { type: 'sun',  color: '#fff2a8', glow: '255,240,150' },
    cloud: '#ffffff', star: false, tree: false, weather: null,
    tuft:  ['#5fae52', '#79c463'],
  },
  {
    name: '星夜',
    sky:   ['#111c3f', '#24345f', '#4b5d88'],
    grass: ['#2f5b45', '#1e4331'],
    hill:  ['rgba(58,86,120,.7)', 'rgba(36,60,92,.85)'],
    orb:   { type: 'moon', color: '#f6f2d9', glow: '214,228,255' },
    cloud: 'rgba(126,146,196,.3)', star: true, tree: false, weather: 'fireflies',
    tuft:  ['#3d7a5c', '#2f6647'],
  },
  {
    name: '樱花林',
    sky:   ['#ffdcea', '#ffc4da', '#fff3f7'],
    grass: ['#a7d890', '#7cbb6b'],
    hill:  ['rgba(233,158,190,.55)', 'rgba(210,128,168,.7)'],
    orb:   { type: 'sun',  color: '#fff0c2', glow: '255,225,180' },
    cloud: '#fffafb', star: false, tree: true, weather: 'petals',
    tuft:  ['#69b055', '#87c96e'],
  },
  {
    name: '黄昏高原',
    sky:   ['#5b4b8a', '#e2714f', '#ffc48a'],
    grass: ['#b8894f', '#8a6440'],
    hill:  ['rgba(120,80,95,.6)', 'rgba(84,58,74,.75)'],
    orb:   { type: 'sun',  color: '#ff9d4d', glow: '255,150,90' },
    cloud: 'rgba(255,205,175,.75)', star: false, tree: false, weather: null,
    tuft:  ['#97703f', '#7d5a34'],
  },
  {
    name: '冰雪世界',
    sky:   ['#a9cdf0', '#d5e8f8', '#f4fbff'],
    grass: ['#eef7fd', '#c3dcef'],
    hill:  ['rgba(190,214,236,.7)', 'rgba(160,190,220,.8)'],
    orb:   { type: 'sun',  color: '#ffffff', glow: '235,246,255' },
    cloud: 'rgba(255,255,255,.8)', star: false, tree: false, weather: 'snow',
    tuft:  ['#ffffff', '#dcecf8'],
  },
];

const FLOWER_CONFIG = {
  useVariants: true,   // true = 按上面 5 个品种画不同的花；false = 所有花都用 IMAGE_ASSETS.flower 那一张素材
};

/* -------------------------------------------------------------------------
   无尽模式：必须通关第 5 关才解锁
   规则 = 3 点生命 + 全程随机回血道具；难度按分数分档，
   每累计 stageStep 分升一档，档位越高掉得越快、炸弹越多、出得越密。
   只有无尽模式记录「最高分」并在结束时弹分数结算。
   ------------------------------------------------------------------------- */
const ENDLESS = {
  stageStep: 1000,        // 每累计这么多分升一档
  heartRate: 0.035,       // 回血道具出现比例（全程都有）
  fallPerStage: 0.08,     // 每档下落速度 +0.08 倍
  bombPerStage: 0.02,     // 每档炸弹比例 +0.02
  bombMax: 0.62,          // 炸弹比例上限，避免后期全是炸弹
  spawnCutPerStage: 24,   // 每档生成间隔 -24 毫秒
  spawnMinFloor: 320,     // 生成间隔下限（毫秒）
  bombFallPerStage: 0.12, // 每档炸弹下落再快一点
  bombFallMax: 2.8,       // 炸弹下落倍率上限
  tripleMax: 0.5,         // 三连炸概率上限
  bannerTime: 1.1,        // 升档提示停留秒数
};

/* -------------------------------------------------------------------------
   游戏玩法参数：想调难度改这里就够了
   ------------------------------------------------------------------------- */
const CONFIG = {
  // 玩家移动
  player: {
    speed: 470,          // 键盘/触摸的最大速度（像素/秒，会按屏幕宽度微调）
    mouseLerp: 0.22,     // 鼠标跟随的平滑系数，越大越跟手（0~1）
    margin: 62,          // 可移动范围距左右边缘的距离（窄屏会自动收敛）
    basketWidth: 104,    // 接东西的判定宽度（会随屏幕宽度小幅缩放）
  },

  // 掉落物
  item: {
    vy0: 165,            // 初始下落速度
    gravity: 105,        // 下落加速度
    radius: 26,          // 碰撞半径（视觉大小）
    spinSpeed: 2.6,      // 旋转速度
  },

  // 闯关模式（每关满血 3 点开局、本关分从 0 起算；过关只解锁下一关，不结算分数）
  levels: {
    bannerTime: 1.8,      // 画面中央提示条停留秒数
  },

  // 计分
  score: {
    perFlower: 10,       // 每朵花基础分（第 1 朵就是 10 分）
    comboStep: 1,        // 连击加成强度（每连击一次 +25% 倍率，调 0 关闭加成）
    comboMax: 5,         // 最高倍数
  },

  lives: 3,              // 总生命值

  /* 无尽模式排行榜（本地版）：数据全部存在浏览器 localStorage，没有服务器。
     破纪录瞬间就实时落榜（主动退出 / 关网页也不丢），结算面板里可改上榜 ID；
     不同玩家用了同一个 ID 时，按"主机指纹"（首次运行随机生成并永久保存）
     分配互不冲突的编号，排行榜里以灰色显示。 */
  board: {
    defaultId: '童琴99',                       // 默认上榜 ID
    key: 'flower-catch-leaderboard-v1',       // 排行榜数据
    playerIdKey: 'flower-catch-player-id-v1', // 玩家自己的上榜 ID
    hostKey: 'flower-catch-host-key-v1',      // 主机指纹（同 ID 编号的依据）
    max: 50,                                   // 排行榜最多保留几条
  },

  /* 自适应画布：逻辑高度固定，逻辑宽度随设备屏幕比例自动伸缩，
     这样电脑 / 平板 / 手机（横屏竖屏）都不会变形也不会被裁切 */
  canvas: {
    baseH: 640,          // 逻辑高度（所有纵向坐标都由它派生）
    refW: 900,           // 参考宽度（游戏平衡性以这个宽度为准）
    minW: 380,           // 逻辑宽度下限：手机竖屏
    maxW: 1300,          // 逻辑宽度上限：手机横屏 / 超宽显示器
  },

  /* 存档：进度存在浏览器本地，关掉网页再打开还在。
     想清空进度用开始界面右下角的「重置全部进度」，或手动删这两条 localStorage。 */
  progressKey: 'flower-catch-progress-v1',   // { unlocked: 已解锁到第几关, endless: 无尽模式是否已解锁 }
  endlessBestKey: 'flower-catch-endless-best-v1',  // 只有无尽模式记录最高分
};

/* -------------------------------------------------------------------------
   运行时视图状态：由 game.js 的 layout() 每次尺寸变化时更新，
   sprites.js 读取它来做角色的等比缩放（不需要你手动改）
   ------------------------------------------------------------------------- */
const VIEW = {
  w: CONFIG.canvas.refW,
  h: CONFIG.canvas.baseH,
  groundY: Math.round(CONFIG.canvas.baseH * 0.793),
  scale: 1,   // = w / refW，用于角色/装饰的等比缩放
};

/* -------------------------------------------------------------------------
   背景音乐（BGM）· 顺序轮播
     playlist 按顺序播放：一首播完自动淡出 → 切下一首 → 淡入，
               最后一首播完回到第 1 首，全程不区分关卡/模式。
     换曲子：把 mp3 放进 assets/bgm/，改这里的文件名（或替换同名文件）；
     调顺序：直接换数组顺序；想只播一首就把数组留一项。
     volume   音量 0~1，别开太大，要给接花/爆炸音效留余量
     fadeMs   切歌/暂停时的淡入淡出毫秒数，直接掐断会有"咔"一声
   音效（接花 / 爆炸 / 死亡 / 过关）是代码实时合成的，跟这里是两套，
   互不影响 —— 右上角两个按钮分别控制「音乐」和「音效」。
   注意：因为是本地 file:// 直接打开，这里用的是 <audio> 元素播放，
   不要用 fetch + WebAudio，浏览器在 file:// 下会禁掉 fetch 导致无声。
   ------------------------------------------------------------------------- */
const BGM = {
  playlist: [
    { src: 'assets/bgm/happy-vibes.mp3',    title: 'Happy Vibes'    },
    { src: 'assets/bgm/happy-ukulele.mp3',  title: 'Happy Ukulele'  },
    { src: 'assets/bgm/man-is-he-mega.mp3', title: 'Man Is He Mega' },
    { src: 'assets/bgm/8bit-warriors.mp3',  title: '8bit Warriors'  },
  ],
  volume: 0.34,
  fadeMs: 400,
};

/* -------------------------------------------------------------------------
   主题色：改这里可以整体换配色
   ------------------------------------------------------------------------- */
const PALETTE = {
  sky:    ['#7fd3ff', '#b9e9ff', '#eaf7ff'],
  grass:  ['#8ed681', '#67b95a'],
  soil:   ['#c98f57', '#a9713f'],
  skin:   '#ffd9b8',
  outline:'#3d3226',
  playerCloth:  '#4f8cff',
  throwerCloth: '#b06ce6',
  flowerPetal:  '#ff87b0',
  flowerCore:   '#ffd447',
  bombBody:     '#39424f',
  life:         '#ff4d6d',
};
