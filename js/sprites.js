/* ==========================================================================
   sprites.js · 素材管理 + 内置矢量绘制
   --------------------------------------------------------------------------
   所有 draw* 函数都遵循一个约定：只要 IMAGE_ASSETS 里配置了同名图片，
   就自动改画你的图片；没配置则使用下面的手绘版角色。
   所以你随时可以只替换其中一两个（例如只换玩家），剩下的仍用内置造型。
   ========================================================================== */

const Assets = {
  imgs: {},

  /** 异步加载 IMAGE_ASSETS 中配置了的图片 */
  load() {
    Object.entries(IMAGE_ASSETS).forEach(([key, asset]) => {
      if (!asset || !asset.src) return;
      const img = new Image();
      img.onload = () => { this.imgs[key] = img; };
      img.onerror = () => console.warn(`[素材] ${key} 加载失败：${asset.src}`);
      img.src = asset.src;
    });
  },

  ready(key) {
    const img = this.imgs[key];
    return !!(img && img.complete && img.naturalWidth > 0);
  },
};

/** 按目标框尺寸绘制图片（等比缩放，多余空间留白） */
function drawAsset(ctx, key, cx, cy, boxW, boxH, align = 'center') {
  if (!Assets.ready(key)) return false;
  const img = Assets.imgs[key];
  const scale = Math.min(boxW / img.naturalWidth, boxH / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  const y = align === 'bottom' ? cy - h : cy - h / 2;
  ctx.drawImage(img, cx - w / 2, y, w, h);
  return true;
}

/* ====================== 玩家动作帧动画 ====================== */

const PlayerAnims = { imgs: {} };

/** 预加载 PLAYER_ANIMS 中所有动作的帧（onerror 静默，单帧失败不影响其他帧） */
function loadPlayerAnims() {
  if (typeof PLAYER_ANIMS === 'undefined') return;
  Object.entries(PLAYER_ANIMS.anims).forEach(([key, def]) => {
    PlayerAnims.imgs[key] = def.frames.map(src => {
      const img = new Image();
      img.onerror = () => console.warn(`[动画帧] 加载失败：${src}`);
      img.src = src;
      return img;
    });
  });
}

/** 取当前帧图片；未加载完返回 null（上层自动回退到单图/矢量角色） */
function playerAnimImg(anim) {
  if (!anim) return null;
  const imgs = PlayerAnims.imgs[anim.key];
  if (!imgs) return null;
  const img = imgs[Math.min(anim.index, imgs.length - 1)];
  return (img && img.complete && img.naturalWidth > 0) ? img : null;
}

/**
 * 绘制玩家当前动作帧。
 * 返回 true = 已绘制（drawPlayer 就不用再画单图/矢量角色了）
 * anim.hidden = true 表示死亡动画播完、角色消散，直接"已绘制"但不画东西。
 */
function drawPlayerFrame(ctx, x, footY, anim, flash = 0) {
  if (anim.hidden) return true;
  const img = playerAnimImg(anim);
  if (!img) return false;

  const s = VIEW.scale;
  const dispW = PLAYER_ANIMS.displaySize * s;
  const scale = dispW / img.naturalWidth;
  const dispH = img.naturalHeight * scale;
  const anchorY = PLAYER_ANIMS.anchorY != null ? PLAYER_ANIMS.anchorY : 0.82;

  ctx.save();
  if (flash > 0) ctx.globalAlpha = 0.55 + Math.abs(Math.sin(flash * 40)) * 0.45;
  ctx.imageSmoothingEnabled = false;   // 像素画风：关闭插值，保持锐利
  ctx.drawImage(img, x - dispW / 2, footY - dispH * anchorY, dispW, dispH);
  ctx.restore();
  return true;
}

/** 读取某个素材的独立缩放系数（IMAGE_ASSETS[key].scale，默认 1）
 *  只影响视觉大小，不影响碰撞判定 —— 想让花大一点就调 flower 的 scale */
function assetScale(key) {
  const a = IMAGE_ASSETS[key];
  return (a && typeof a.scale === 'number' && a.scale > 0) ? a.scale : 1;
}

/* 颜色小工具：给矢量花做描边（同色加深）和柔光（同色半透明） */
function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
function hexA(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
function shade(hex, amt) {           // amt > 0 变亮，< 0 变暗
  const [r, g, b] = hexToRgb(hex);
  const f = c => Math.max(0, Math.min(255, Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function outline(ctx, w = 3, color = PALETTE.outline) {
  ctx.lineWidth = w;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
}

/** 圆角矩形路径 */
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/* ============================ 玩家 ============================
   x,y 为「脚底中心」；返回篮子信息给碰撞逻辑使用
   ============================================================== */
function drawPlayer(ctx, x, y, t, speedRatio = 0, hurt = 0, basketW = 104, anim = null) {
  const footY = y;
  const s = VIEW.scale;
  const bodyBottom = footY - 24;
  const headR = 25;
  const headCY = footY - 81;
  const basketBottom = footY - 118 * s;
  const basketTop = basketBottom - 40 * s;
  const basketCY = (basketBottom + basketTop) / 2;

  // ① 优先：帧序列动画（动作状态机）—— 命中即整只角色由帧图构成
  if (anim && drawPlayerFrame(ctx, x, footY, anim, hurt)) {
    if (IMAGE_ASSETS.player && IMAGE_ASSETS.player.showBasket === true) {
      drawBasket(ctx, x, basketCY, basketW, 40 * s);
    }
    return;
  }

  // ② 回退：单张角色图
  const pw = 130 * assetScale('player') * s;
  const ph = 165 * assetScale('player') * s;
  if (drawAsset(ctx, 'player', x, footY, pw, ph, 'bottom')) {
    // 图片模式下默认不画内置篮子（人物自己往往已有接物造型）
    // 想要内置篮子时，把 IMAGE_ASSETS.player.showBasket 设为 true 即可
    if (IMAGE_ASSETS.player && IMAGE_ASSETS.player.showBasket === true) {
      drawBasket(ctx, x, basketCY, basketW, 40 * s);
    }
    return;
  }

  ctx.save();
  // 以脚底为中心整体等比缩放，适配不同屏幕宽度
  ctx.translate(x, footY);
  ctx.scale(s, s);
  ctx.translate(-x, -footY);
  if (hurt > 0) { ctx.globalAlpha = 0.55 + Math.abs(Math.sin(hurt * 40)) * 0.45; }

  const step = Math.sin(t * 11) * Math.min(1, Math.abs(speedRatio));
  const bob = Math.sin(t * 22) * 1.5 * Math.min(1, Math.abs(speedRatio)) + Math.sin(t * 3) * 1.2;

  // 影子
  ctx.fillStyle = 'rgba(40,60,40,.18)';
  ctx.beginPath();
  ctx.ellipse(x, footY + 4, 46, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.translate(0, bob);

  // 腿
  outline(ctx, 4);
  ctx.fillStyle = '#3f4a68';
  [-1, 1].forEach((dir, i) => {
    const swing = i === 0 ? step : -step;
    ctx.save();
    ctx.translate(x + dir * 13, bodyBottom);
    ctx.rotate(swing * 0.35);
    roundRect(ctx, -8, 0, 16, 28, 7);
    ctx.fill(); ctx.stroke();
    // 鞋
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, -10, 22, 21, 11, 5);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3f4a68';
    ctx.restore();
  });

  // 身体（小衣服）
  outline(ctx, 3.5);
  ctx.fillStyle = PALETTE.playerCloth;
  ctx.beginPath();
  ctx.moveTo(x - 26, bodyBottom + 2);
  ctx.quadraticCurveTo(x - 30, footY - 62, x - 20, footY - 68);
  ctx.lineTo(x + 20, footY - 68);
  ctx.quadraticCurveTo(x + 30, footY - 62, x + 26, bodyBottom + 2);
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  // 衣服上的小图案
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.beginPath();
  ctx.arc(x, footY - 52, 8, 0, Math.PI * 2);
  ctx.fill();

  // 手臂（举向篮子）
  outline(ctx, 4);
  ctx.strokeStyle = PALETTE.skin;
  ctx.beginPath();
  ctx.moveTo(x - 24, footY - 62);
  ctx.quadraticCurveTo(x - 40, footY - 88, x - 34, basketBottom - 6);
  ctx.moveTo(x + 24, footY - 62);
  ctx.quadraticCurveTo(x + 40, footY - 88, x + 34, basketBottom - 6);
  ctx.stroke();
  outline(ctx, 3, PALETTE.outline);

  // 头
  ctx.fillStyle = PALETTE.skin;
  ctx.beginPath();
  ctx.arc(x, headCY, headR, 0, Math.PI * 2);
  ctx.fill(); outline(ctx, 3); ctx.stroke();

  // 头发（刘海）
  ctx.fillStyle = '#5b3a29';
  ctx.beginPath();
  ctx.arc(x, headCY - 3, headR, Math.PI * 1.05, Math.PI * 1.95);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - headR + 1, headCY - 4);
  ctx.quadraticCurveTo(x - 6, headCY - 12, x + 6, headCY - 6);
  ctx.quadraticCurveTo(x + 16, headCY - 18, x + headR - 2, headCY - 8);
  ctx.lineTo(x + headR - 2, headCY - 10);
  ctx.lineTo(x - headR + 1, headCY - 10);
  ctx.closePath();
  ctx.fill();

  // 眼睛 / 腮红 / 嘴
  ctx.fillStyle = '#3d3226';
  const blink = (Math.sin(t * 1.7) > 0.985) ? 0.15 : 1;
  [-8, 8].forEach(dx => {
    ctx.beginPath();
    ctx.ellipse(x + dx, headCY + 3, 3.2, 4 * blink, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = 'rgba(255,140,160,.55)';
  [-15, 15].forEach(dx => {
    ctx.beginPath();
    ctx.ellipse(x + dx, headCY + 10, 5.5, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.strokeStyle = '#3d3226';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, headCY + 7, 5, 0.25 * Math.PI, 0.75 * Math.PI);
  ctx.stroke();

  ctx.restore();

  if (!drawAsset(ctx, 'basket', x, basketCY, basketW * assetScale('basket'), 40 * s)) {
    drawBasket(ctx, x, basketCY, basketW, 40 * s);
  }
}

/** 篮子（梯形编织篮） */
function drawBasket(ctx, cx, cy, w, h) {
  const topW = w, botW = w * 0.66;
  const top = cy - h / 2, bot = cy + h / 2;
  ctx.save();
  outline(ctx, 3.5);
  ctx.fillStyle = PALETTE.soil[0];
  ctx.beginPath();
  ctx.moveTo(cx - topW / 2, top);
  ctx.lineTo(cx + topW / 2, top);
  ctx.lineTo(cx + botW / 2, bot);
  ctx.lineTo(cx - botW / 2, bot);
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  // 编织纹
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(120,70,30,.35)';
  ctx.lineWidth = 2;
  for (let i = -topW; i < topW; i += 13) {
    ctx.beginPath();
    ctx.moveTo(cx + i, top);
    ctx.lineTo(cx + i * 0.66, bot);
    ctx.stroke();
  }
  for (let j = top + 8; j < bot; j += 11) {
    ctx.beginPath();
    ctx.moveTo(cx - topW, j);
    ctx.lineTo(cx + topW, j);
    ctx.stroke();
  }
  ctx.restore();

  // 篮口高光
  ctx.fillStyle = PALETTE.soil[1];
  roundRect(ctx, cx - topW / 2 - 3, top - 7, topW + 6, 10, 5);
  ctx.fill(); outline(ctx, 3); ctx.stroke();
  ctx.restore();
}

/* ====================== 投掷者（撒花的人）帧动画 ====================== */

const ThrowerAnims = { imgs: {} };

/** 预加载 THROWER_ANIMS 里的所有帧（单帧失败不影响其他帧） */
function loadThrowerAnims() {
  if (typeof THROWER_ANIMS === 'undefined') return;
  Object.entries(THROWER_ANIMS.anims).forEach(([key, def]) => {
    ThrowerAnims.imgs[key] = def.frames.map(src => {
      const img = new Image();
      img.onerror = () => console.warn(`[投掷者帧] 加载失败：${src}`);
      img.src = src;
      return img;
    });
  });
}

/** 取投掷者当前帧；未加载完返回 null（上层回退到单图/矢量版） */
function throwerAnimImg(anim) {
  if (!anim) return null;
  const imgs = ThrowerAnims.imgs[anim.key];
  if (!imgs) return null;
  const img = imgs[Math.min(anim.index, imgs.length - 1)];
  return (img && img.complete && img.naturalWidth > 0) ? img : null;
}

/** 画投掷者当前帧；返回 true = 已绘制（drawThrower 不用再画素材/矢量版） */
function drawThrowerFrame(ctx, x, footY, anim) {
  if (anim.hidden) return true;
  const img = throwerAnimImg(anim);
  if (!img) return false;
  const s = VIEW.scale;
  const isFinish = anim.key === 'finish';
  const dispW = (isFinish ? THROWER_ANIMS.finishWidth : THROWER_ANIMS.displaySize) * s;
  const scale = dispW / img.naturalWidth;
  const dispH = img.naturalHeight * scale;
  ctx.save();
  ctx.imageSmoothingEnabled = false;   // 像素画风：保持锐利
  ctx.drawImage(img, x - dispW / 2, footY - dispH * THROWER_ANIMS.anchorY, dispW, dispH);
  ctx.restore();
  return true;
}

/* ============================ 投掷者 ============================ */
function drawThrower(ctx, x, y, t, throwPhase = 0, anim = null) {
  const footY = y;
  const headR = 22;
  const s = VIEW.scale;   // 和玩家 / 掉落物共用同一个系数，窄屏一起变小

  // ① 优先：帧序列动画（撒花 / 左右走 / 结算画面）
  if (anim && drawThrowerFrame(ctx, x, footY, anim)) return;

  // ② 回退：单张素材图
  const tw = 120 * assetScale('thrower') * s;
  const th = 155 * assetScale('thrower') * s;
  if (drawAsset(ctx, 'thrower', x, footY, tw, th, 'bottom')) return;

  ctx.save();
  // 矢量造型以脚底为中心整体等比缩放，避免只缩图片、不缩手绘版
  ctx.translate(x, footY);
  ctx.scale(s, s);
  ctx.translate(-x, -footY);
  // 蹲下去的特制云朵座台
  drawCloud(ctx, x, footY + 18, 1.15, 0.95);

  const bodyBottom = footY;
  const headCY = footY - 66;
  const breathe = Math.sin(t * 2.2) * 1.6;

  ctx.translate(0, breathe);

  // 腿
  outline(ctx, 4);
  ctx.fillStyle = '#5a4a8a';
  [-1, 1].forEach(dir => {
    roundRect(ctx, x + dir * 11 - 7, footY - 20, 15, 22, 6);
    ctx.fill(); ctx.stroke();
  });

  // 身体
  outline(ctx, 3.5);
  ctx.fillStyle = PALETTE.throwerCloth;
  ctx.beginPath();
  ctx.moveTo(x - 22, footY - 14);
  ctx.quadraticCurveTo(x - 26, footY - 50, x - 17, footY - 56);
  ctx.lineTo(x + 17, footY - 56);
  ctx.quadraticCurveTo(x + 26, footY - 50, x + 22, footY - 14);
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  // 披风 / 小装饰
  ctx.fillStyle = 'rgba(255,255,255,.5)';
  ctx.beginPath();
  ctx.moveTo(x - 17, footY - 54);
  ctx.quadraticCurveTo(x, footY - 34, x + 17, footY - 54);
  ctx.quadraticCurveTo(x, footY - 44, x - 17, footY - 54);
  ctx.fill();

  // 手臂：throwPhase 0→1 表示一次投掷（举手过头顶再甩下）
  const armSwing = Math.sin(Math.PI * throwPhase);
  const shoulderY = footY - 50;
  outline(ctx, 5);
  ctx.strokeStyle = PALETTE.skin;
  ctx.beginPath();
  ctx.moveTo(x - 20, shoulderY);
  ctx.quadraticCurveTo(x - 32, shoulderY - 14, x - 26 - armSwing * 6, shoulderY - 26 - armSwing * 10);
  ctx.moveTo(x + 20, shoulderY);
  ctx.quadraticCurveTo(x + 34, shoulderY - 10 - armSwing * 24, x + 30 + armSwing * 14, shoulderY - 30 - armSwing * 26);
  ctx.stroke();
  outline(ctx, 3, PALETTE.outline);

  // 头
  ctx.fillStyle = PALETTE.skin;
  ctx.beginPath();
  ctx.arc(x, headCY, headR, 0, Math.PI * 2);
  ctx.fill(); outline(ctx, 3); ctx.stroke();

  // 长发
  ctx.fillStyle = '#8a5cc4';
  ctx.beginPath();
  ctx.arc(x, headCY - 2, headR + 3, Math.PI * 0.98, Math.PI * 2.02);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - headR - 3, headCY - 2);
  ctx.quadraticCurveTo(x - headR - 12, headCY + 26, x - headR + 2, headCY + 34);
  ctx.lineTo(x - headR + 6, headCY + 12);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + headR + 3, headCY - 2);
  ctx.quadraticCurveTo(x + headR + 12, headCY + 26, x + headR - 2, headCY + 34);
  ctx.lineTo(x + headR - 6, headCY + 12);
  ctx.closePath();
  ctx.fill();

  // 表情
  ctx.fillStyle = '#3d3226';
  ctx.beginPath();
  ctx.ellipse(x - 7, headCY + 2, 2.8, 3.6, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 7, headCY + 2, 2.8, 3.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,140,160,.45)';
  ctx.beginPath();
  ctx.ellipse(x - 13, headCY + 9, 4.5, 3, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 13, headCY + 9, 4.5, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#3d3226';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, headCY + 5, 4, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();

  ctx.restore();
}

/* ============================ 花朵 ============================ */
function drawFlower(ctx, x, y, size, rot, kind = 0) {
  const def = (typeof FLOWERS !== 'undefined' && FLOWERS[kind]) || null;
  const variants = typeof FLOWER_CONFIG === 'undefined' || FLOWER_CONFIG.useVariants !== false;
  const s = size * 2 * assetScale('flower') * (def ? def.size : 1);

  // 素材优先：多品种模式按 flower1~flower5 找，单素材模式统一用 flower
  if (variants) {
    if (drawAsset(ctx, 'flower' + (kind + 1), x, y, s, s)) return;
  } else if (drawAsset(ctx, 'flower', x, y, s, s)) return;

  const color  = def ? def.color  : PALETTE.flowerPetal;
  const color2 = def ? def.color2 : '#ff9cc0';
  const core   = def ? def.core   : PALETTE.flowerCore;
  const petals = def ? def.petals : 5;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);

  // 稀有花带一层柔光，一眼能看出值钱
  if (def && def.glow) {
    const g = ctx.createRadialGradient(0, 0, size * 0.15, 0, 0, size * 1.6);
    g.addColorStop(0, hexA(color, 0.5));
    g.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, size * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  outline(ctx, 2.5, shade(color, -0.28));
  for (let i = 0; i < petals; i++) {
    ctx.save();
    ctx.rotate((Math.PI * 2 / petals) * i);
    ctx.fillStyle = i % 2 ? color : color2;
    ctx.beginPath();
    ctx.ellipse(0, -size * 0.52, size * 0.36, size * 0.52, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.34, 0, Math.PI * 2);
  ctx.fill(); outline(ctx, 2.5, shade(core, -0.22)); ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.beginPath();
  ctx.arc(-size * 0.1, -size * 0.1, size * 0.13, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* ============================ 炸弹 ============================ */
function drawBomb(ctx, x, y, size, rot, fuseT = 0) {
  const s = size * 2 * assetScale('bomb');
  if (drawAsset(ctx, 'bomb', x, y, s, s)) return;
  const r = size * 0.72;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot * 0.5);

  // 引线
  ctx.strokeStyle = '#8a6a4a';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.quadraticCurveTo(size * 0.3, -r - 10, size * 0.34, -r - 20);
  ctx.stroke();

  // 火花
  const flick = 0.75 + Math.sin(fuseT * 22) * 0.25;
  ctx.fillStyle = 'rgba(255,170,40,.55)';
  ctx.beginPath();
  ctx.arc(size * 0.34, -r - 22, size * 0.3 * flick, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff3a6';
  ctx.beginPath();
  ctx.arc(size * 0.34, -r - 22, size * 0.15 * flick, 0, Math.PI * 2);
  ctx.fill();

  // 弹体
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.15, 0, 0, r);
  g.addColorStop(0, '#5d6775');
  g.addColorStop(1, PALETTE.bombBody);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill(); outline(ctx, 3, '#232a33'); ctx.stroke();

  // 顶部小柄
  ctx.fillStyle = '#5d6775';
  roundRect(ctx, -r * 0.28, -r - 6, r * 0.56, 9, 3);
  ctx.fill(); outline(ctx, 2.5, '#232a33'); ctx.stroke();

  // 高光
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.35, -r * 0.4, r * 0.26, r * 0.16, -0.6, 0, Math.PI * 2);
  ctx.fill();

  // 骷髅标记
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.beginPath();
  ctx.arc(0, r * 0.1, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.bombBody;
  ctx.beginPath();
  ctx.arc(-r * 0.13, r * 0.05, r * 0.1, 0, Math.PI * 2);
  ctx.arc(r * 0.13, r * 0.05, r * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* ============================ 回血道具（红心） ============================ */
function drawHeart(ctx, x, y, size, rot) {
  if (drawAsset(ctx, 'heart', x, y, size * 2, size * 2)) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(rot) * 0.18);          // 轻微左右摆动
  const s = size / 26;
  ctx.scale(s, s);

  ctx.beginPath();
  ctx.moveTo(0, 22);
  ctx.bezierCurveTo(-30, 2, -20, -18, 0, -8);
  ctx.bezierCurveTo(20, -18, 30, 2, 0, 22);
  ctx.closePath();
  ctx.fillStyle = PALETTE.life || '#ff4d6d';
  ctx.fill();
  outline(ctx, 2.6, '#7a2038');
  ctx.stroke();

  ctx.beginPath();                            // 高光
  ctx.ellipse(-8, -6, 4, 6.5, -0.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,.8)';
  ctx.fill();
  ctx.restore();
}

/* ============================ 云朵 ============================ */
function drawCloud(ctx, x, y, scale = 1, alpha = 1, tint = '#ffffff') {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = tint;
  ctx.beginPath();
  ctx.arc(-30, 4, 20, 0, Math.PI * 2);
  ctx.arc(-4, -8, 27, 0, Math.PI * 2);
  ctx.arc(26, 2, 21, 0, Math.PI * 2);
  ctx.arc(52, 8, 15, 0, Math.PI * 2);
  ctx.rect(-30, 4, 82, 18);
  ctx.fill();
  ctx.fillStyle = 'rgba(200,225,255,.6)';
  ctx.beginPath();
  ctx.ellipse(-6, 16, 42, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
