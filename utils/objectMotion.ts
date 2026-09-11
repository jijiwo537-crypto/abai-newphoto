export type ObjectMotionFrame = {
  k: number;
  /** 翻轉／流星只在水平方向需要的額外倍率。 */
  fx?: number;
  dx: number;
  dy: number;
  rot: number;
  a: number;
  /** 符號泡泡進場的總進度；由繪圖端拆成逐單位時間線。 */
  seq?: number;
  /** 常駐動畫開始後的本地時間，供文字／符號的縮放 II 使用。 */
  idleT?: number;
  /** 進場交棒到常駐時的平滑混合量。 */
  waveMix?: number;
};

export type ObjectMotionConfig = {
  delay: number;
  dur: number;
  in: string;
  idle: string;
  amp: number;
  speed: number;
};

export const OBJECT_MOTION_DEFAULT: ObjectMotionConfig = {
  delay: 0,
  dur: 0.63,
  in: 'pop',
  idle: 'none',
  amp: 50,
  speed: 0.9,
};

/** 經典拼圖的新物件預設完全靜止；保留其餘參數只是讓使用者首次切換時有合理值。 */
export const CLASSIC_OBJECT_MOTION_DEFAULT: ObjectMotionConfig = {
  ...OBJECT_MOTION_DEFAULT,
  in: 'none',
  idle: 'none',
};

export const OBJECT_IN_KINDS = [
  ['none', '無'], ['pop', '果凍'], ['fade', '淡入'], ['rise', '升起'],
  ['drop', '落下'], ['spin', '旋轉'], ['flip', '翻轉'], ['bounce', '彈跳'],
  ['spring', '流星'],
] as const;

/** 符號和創意拼圖一致：泡泡取代原本淡入的位置，淡入移到流星的位置。 */
export const SYMBOL_OBJECT_IN_KINDS = OBJECT_IN_KINDS.map(([id, name]) =>
  id === 'fade' ? ['bubble', '泡泡'] as const
    : id === 'spring' ? ['fade', '淡入'] as const
      : [id, name] as const,
);

export const OBJECT_IDLE_KINDS = [
  ['none', '靜止'], ['float', '漂浮'], ['grid-wave', '波浪'], ['breathe', '縮放I'],
  ['symbol-breathe2', '縮放II'], ['spin', '旋轉'], ['wobble', '搖擺'],
  ['orbit', '繞圈'], ['jitter', '抖動'],
] as const;

const flat: ObjectMotionFrame = { k: 1, dx: 0, dy: 0, rot: 0, a: 1 };
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const cubic = (p: number) => 1 - Math.pow(1 - p, 3);
const smooth = (p: number) => p * p * (3 - 2 * p);
const back = (p: number) => {
  const c1 = 1.70158, c3 = c1 + 1, q = p - 1;
  return 1 + c3 * q * q * q + c1 * q * q;
};
const bounce = (p0: number) => {
  let p = p0;
  const n = 7.5625, d = 2.75;
  if (p < 1 / d) return n * p * p;
  if (p < 2 / d) return n * (p -= 1.5 / d) * p + .75;
  if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + .9375;
  return n * (p -= 2.625 / d) * p + .984375;
};

export const objectMotionOf = (value?: Partial<ObjectMotionConfig> | null): ObjectMotionConfig => ({
  ...OBJECT_MOTION_DEFAULT,
  ...(value || {}),
});

export const classicObjectMotionOf = (value?: Partial<ObjectMotionConfig> | null): ObjectMotionConfig => ({
  ...CLASSIC_OBJECT_MOTION_DEFAULT,
  ...(value || {}),
});

export const objectMotionFrame = (
  value: Partial<ObjectMotionConfig> | null | undefined,
  time: number,
  phase = 0,
): ObjectMotionFrame => {
  const cfg = objectMotionOf(value);
  const hasIntro = cfg.in !== 'none';
  const introEnd = hasIntro ? cfg.delay + Math.max(.01, cfg.dur) : 0;
  const p = hasIntro ? clamp((time - cfg.delay) / Math.max(.01, cfg.dur)) : 1;
  let intro = flat;
  if (hasIntro && time < cfg.delay) intro = { ...flat, k: 0, a: 0 };
  else if (p < 1) {
    const e = cubic(p), fade = clamp(p * 1.6);
    if (cfg.in === 'bubble') intro = { ...flat, seq: p };
    else if (cfg.in === 'fade') intro = { ...flat, a: p };
    else if (cfg.in === 'rise') intro = { ...flat, dy: (1 - e) * .9, a: fade };
    else if (cfg.in === 'drop') intro = { ...flat, dy: -(1 - e) * .9, a: fade };
    else if (cfg.in === 'spin') intro = { ...flat, k: e, rot: -(1 - e) * 200, a: fade };
    else if (cfg.in === 'flip') intro = { ...flat, fx: Math.max(.02, Math.abs(Math.cos((1 - e) * Math.PI))), a: fade };
    else if (cfg.in === 'bounce') intro = { ...flat, dy: -(1 - bounce(p)) * 1.1, a: clamp(p * 4) };
    else if (cfg.in === 'spring') {
      const q = cubic(Math.min(1, p / .62));
      const z = Math.max(0, (p - .62) / .38);
      const over = z > 0 ? Math.sin(z * Math.PI) * .06 : 0;
      const stretch = (1 - q) * .55;
      intro = { ...flat, k: (1 + over) / (1 + stretch), fx: 1 + stretch, dx: -(1 - q) * 1.15, dy: -(1 - q) * .82, rot: -(1 - q) * 28, a: fade };
    }
    else intro = { ...flat, k: back(p), a: fade };
  }
  if (p < 1) return intro;

  const t = Math.max(0, time - introEnd);
  const blend = smooth(clamp(t / .72));
  const A = Math.max(0, cfg.amp) / 100;
  const w = t * Math.max(.05, cfg.speed) + phase;
  let idle = flat;
  if (cfg.idle === 'float') idle = { ...flat, dy: Math.sin(w * 2) * A * .28 };
  else if (cfg.idle === 'grid-wave') idle = { ...flat, dy: Math.sin(w * 2.2) * A * .18, rot: Math.sin(w * 1.1) * A * 3 };
  else if (cfg.idle === 'breathe') {
    const rate = 1 + (((phase * .6180339887) % 1) - .5) * .34;
    idle = { ...flat, k: 1 + Math.sin(t * cfg.speed * 1.9 * rate + phase) * A * .44 };
  }
  else if (cfg.idle === 'symbol-breathe2') idle = { ...flat, idleT: t };
  else if (cfg.idle === 'spin') idle = { ...flat, rot: t * cfg.speed * A * 90 };
  else if (cfg.idle === 'wobble') idle = { ...flat, rot: Math.sin(w * 2.4) * A * 22 };
  else if (cfg.idle === 'orbit') idle = { ...flat, dx: Math.cos(w * 1.6) * A * .2, dy: Math.sin(w * 1.6) * A * .2 };
  else if (cfg.idle === 'jitter') idle = {
    ...flat,
    dx: (Math.sin(w * 7.3) + Math.sin(w * 11.72)) * A * .05,
    dy: (Math.sin(w * 9.13 + 2.1) + Math.sin(w * 13.31)) * A * .05,
    rot: (Math.sin(w * 8.7 + 1.3) + Math.sin(w * 15.1)) * A * 2.4,
  };
  return {
    k: 1 + (idle.k - 1) * blend,
    fx: 1,
    dx: idle.dx * blend,
    dy: idle.dy * blend,
    rot: idle.rot * blend,
    a: 1,
    idleT: idle.idleT,
    waveMix: blend,
  };
};

export const motionDurationFromUi = (speed: number) =>
  3.49 * Math.pow(.3 / 3.49, Math.max(0, Math.min(100, speed)) / 100);

export const motionUiFromDuration = (duration: number) =>
  Math.max(0, Math.min(100, Math.round(100 * Math.log(Math.max(.0001, duration) / 3.49) / Math.log(.3 / 3.49))));
