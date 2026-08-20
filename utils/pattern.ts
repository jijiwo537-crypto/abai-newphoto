/**
 * 紋理：點點／星星／愛心／條紋。
 *
 * 全 App 的紋理都走這一支 —— 遮罩、頁面背景、圖形、文字、符號都是同一份，
 * 所以同樣的數字在哪裡看起來都一樣，也不可能各改各的。
 *
 * 前三種（點點／星星／愛心）是「一個顏色 ＋ 大小 ＋ 間距」，鋪在交錯三角網格上；
 * 條紋是「兩個顏色 ＋ 粗細 ＋ 方向」，一條接著一條相間排列（沒有間距可調）。
 *
 * 尺寸基準是「寬 1000px」——每頁尺寸與預覽倍率都不同，用寬度換算，
 * 預覽跟匯出才會是同一張圖。
 */

/** 尺寸換算的基準寬度 */
const REF_W = 1000;

/** 紋理的種類 */
export type TexKind = 'none' | 'dot' | 'star' | 'heart' | 'stripe';

/** 每個紋理選單都用這一份，順序與字都一致 */
export const TEX_OPTIONS: [TexKind, string][] = [
  ['none', '無'],
  ['dot', '點點'],
  ['star', '星星'],
  ['heart', '愛心'],
  ['stripe', '條紋'],
];

/** 條紋預設的兩個顏色 */
export const STRIPE_A = '#A8CCF5';
export const STRIPE_B = '#FDEBF7';

/** 是不是那三種「鋪在網格上」的紋理（跟條紋分開處理） */
export const isGridTex = (t?: string) => t === 'dot' || t === 'star' || t === 'heart';

/**
 * 一顆紋理圖案。三種都以 (cx, cy) 為中心、r 為「點點的半徑」。
 * 星星與愛心會畫得比 r 大一些 —— 同樣半徑下它們的面積只有圓的三分之一
 * 到一半，不放大看起來會比點點小很多。
 */
export const patternGlyph = (
  c: CanvasRenderingContext2D,
  kind: string,
  cx: number, cy: number, r: number,
) => {
  c.beginPath();
  if (kind === 'star') {
    const R = r * 1.38;
    for (let k = 0; k < 10; k++) {
      const rad = k % 2 === 0 ? R : R * 0.45;
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      if (k === 0) c.moveTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
      else c.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
    c.closePath();
  } else if (kind === 'heart') {
    const s = r * 1.22;
    c.moveTo(cx, cy + s * 0.85);
    c.bezierCurveTo(cx - s * 1.5, cy - s * 0.2, cx - s * 0.55, cy - s * 1.15, cx, cy - s * 0.4);
    c.bezierCurveTo(cx + s * 0.55, cy - s * 1.15, cx + s * 1.5, cy - s * 0.2, cx, cy + s * 0.85);
    c.closePath();
  } else {
    c.arc(cx, cy, r, 0, Math.PI * 2);
  }
  c.fill();
};

/**
 * 一條條紋有多寬。粗細 0～100 對應 6～60 個單位
 * （最細像細線，最粗大約一條佔十分之一）。
 */
export const stripeBandOf = (refW: number, w = 50) =>
  (6 + (w / 100) * 54) * (refW / REF_W);

/**
 * 把條紋鋪滿 (0,0)~(w,h)。兩個顏色相間，沒有間距可以調。
 * dir：'h' 橫式（一條一條橫著排）／'v' 直式。
 * 起算點在正中心 —— 預覽跟匯出用同一個基準，條紋的位置才對得上。
 */
export const paintStripesRect = (
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  width = 50, dir: 'h' | 'v' = 'h', a = STRIPE_A, b = STRIPE_B,
) => {
  if (w <= 0 || h <= 0) return;
  const band = Math.max(0.5, stripeBandOf(w, width));
  const span = dir === 'h' ? h : w;
  const n = Math.ceil(span / band / 2) + 2;
  ctx.save();
  for (let i = -n; i <= n; i++) {
    // 用「取模再補正」拿到 0/1，負的索引才不會出現兩條同色黏在一起
    ctx.fillStyle = ((i % 2) + 2) % 2 === 0 ? a : b;
    // 多鋪 0.5px：相鄰兩條之間不要因為反鋸齒露出一條細縫
    if (dir === 'h') ctx.fillRect(-w, h / 2 + i * band, w * 3, band + 0.5);
    else ctx.fillRect(w / 2 + i * band, -h, band + 0.5, h * 3);
  }
  ctx.restore();
};

export interface PatternOpts {
  /** 'none' | 'dot' | 'star' | 'heart' | 'stripe' */
  type: string;
  color: string;
  /** UI 上的 0~100，對應實際大小 5~20 */
  size: number;
  /** UI 上的 0~100，對應實際間距 40~140 */
  gap: number;
  /** 條紋：粗細 0~100、方向、兩個顏色 */
  stripeW?: number;
  stripeDir?: string;
  stripeA?: string;
  stripeB?: string;
}

/** 把紋理鋪滿 (0,0)~(w,h)。type 是 'none' 就什麼都不做。 */
export const paintPattern = (
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  o: PatternOpts,
) => {
  if (!o || o.type === 'none' || w <= 0 || h <= 0) return;
  if (o.type === 'stripe') {
    paintStripesRect(ctx, w, h, o.stripeW ?? 50,
      o.stripeDir === 'v' ? 'v' : 'h', o.stripeA || STRIPE_A, o.stripeB || STRIPE_B);
    return;
  }
  const s = w / REF_W;
  const r = ((5 + (o.size ?? 50) / 100 * 15) * s) / 2;
  const dgap = (40 + (o.gap ?? 20)) * s;
  if (r <= 0.05 || dgap <= 0.5) return;

  const dx = dgap;
  const dy = dgap * Math.sqrt(3) / 2;   // 交錯三角網格的列高
  const rangeX = Math.ceil(w / dx) + 2;
  const rangeY = Math.ceil(h / dy) + 2;
  const pad = r * 1.5;                  // 星星／愛心畫得比 r 大，剔除範圍放寬

  ctx.save();
  ctx.fillStyle = o.color || '#FFFFFF';
  for (let j = -rangeY; j <= rangeY; j++) {
    const py = h / 2 + j * dy;
    if (py + pad < 0 || py - pad > h) continue;
    const shiftX = Math.abs(j) % 2 === 1 ? dx / 2 : 0;
    for (let i = -rangeX; i <= rangeX; i++) {
      const px = w / 2 + i * dx + shiftX;
      if (px + pad < 0 || px - pad > w) continue;
      patternGlyph(ctx, o.type, px, py, r);
    }
  }
  ctx.restore();
};

/* ── 顏色色票 ─────────────────────────────────────────────────────
   全 App 挑顏色的地方都用這一份（遮罩、紋理、條紋的兩個顏色）——
   使用者在哪一頁看到的色票都一樣。
   兩圈：淡的以 #D2E8E1 為基準（＝遮罩的預設色），深的以 #B8E3D8 為基準，
   各自照色相繞一圈；第一顆固定純白。 */
const MASK_BASE_LIGHT = '#D2E8E1';
const MASK_BASE_DEEP = '#B8E3D8';

const hslToHexLocal = (h: number, s: number, l: number): string => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((((h % 360) + 360) % 360)) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  const to = (v: number) => Math.round(Math.max(0, Math.min(1, v + m)) * 255).toString(16).padStart(2, '0');
  return `#${to(r1)}${to(g1)}${to(b1)}`.toUpperCase();
};

/** 把一個顏色拆成 HSL，只換色相繞一圈，回傳 n 顆照色相排好的顏色 */
const hueRing = (baseHex: string, n: number): string[] => {
  const r = parseInt(baseHex.slice(1, 3), 16) / 255;
  const g = parseInt(baseHex.slice(3, 5), 16) / 255;
  const b = parseInt(baseHex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const l = (mx + mn) / 2;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h0 = 0;
  if (d !== 0) {
    h0 = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  }
  const step = 360 / n;
  const hues: number[] = [];
  for (let i = 0; i < n; i++) hues.push((((h0 + i * step) % 360) + 360) % 360);
  hues.sort((a, b2) => a - b2);
  return hues.map(h => hslToHexLocal(h, sat, l));
};

export const TEX_SWATCHES: string[] = [
  '#FFFFFF',
  ...hueRing(MASK_BASE_LIGHT, 14),
  ...hueRing(MASK_BASE_DEEP, 14),
];


/* ── 給 DOM 的文字用的紋理 ───────────────────────────────────────────
   經典拼圖的文字是 DOM 元素（不是畫在 canvas 上），所以紋理得靠
   background-image ＋ background-clip: text 才蓋得上去。
   這裡把「一個週期」畫成一小張圖再轉成 data URL —— 用的就是上面那幾支
   同一份程式碼，所以預覽跟匯出畫出來的紋理一模一樣。
   同樣的參數只會產生一次（存在 Map 裡），拖動時不會一直重畫。 */
const tileCache = new Map<string, { url: string; w: number; h: number }>();

export const texTile = (o: any, unitW: number, unitH: number): { url: string; w: number; h: number } | null => {
  const t = o?.tex;
  if (!t || t === 'none' || typeof document === 'undefined') return null;
  /* 單位跟 utils/holeShapes 的 dotGridOf／stripeBandOf 完全一致（長邊 / 600），
     所以「同一個數字」在圖形上跟在文字上看起來一樣大。 */
  const s = Math.max(unitW, unitH) / 600;
  if (!(s > 0)) return null;
  const key = [t, s.toFixed(4), o.texSize ?? o.dotSize ?? 50, o.texGap ?? o.dotGap ?? 20,
    o.texColor || o.dotColor || '#FFFFFF', o.stripeW ?? 50, o.stripeDir || 'h',
    o.stripeA || STRIPE_A, o.stripeB || STRIPE_B].join('|');
  const hit = tileCache.get(key);
  if (hit) return hit;

  let w: number, h: number;
  if (t === 'stripe') {
    const band = Math.max(1, (6 + (o.stripeW ?? 50) / 100 * 54) * s);
    const vert = o.stripeDir === 'v';
    w = vert ? band * 2 : band;
    h = vert ? band : band * 2;
  } else {
    const dgap = Math.max(2, (40 + (o.texGap ?? o.dotGap ?? 20)) * s);
    w = dgap;
    h = dgap * Math.sqrt(3);           // 交錯三角格的一個週期是兩列
  }
  const W = Math.max(2, Math.ceil(w)), H = Math.max(2, Math.ceil(h));
  if (W > 512 || H > 512) return null;  // 太大就不做，避免一張很肥的 data URL
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  if (!c) return null;

  if (t === 'stripe') {
    const vert = o.stripeDir === 'v';
    const a = o.stripeA || STRIPE_A, b = o.stripeB || STRIPE_B;
    c.fillStyle = a;
    if (vert) c.fillRect(0, 0, W / 2 + 0.5, H); else c.fillRect(0, 0, W, H / 2 + 0.5);
    c.fillStyle = b;
    if (vert) c.fillRect(W / 2, 0, W / 2 + 0.5, H); else c.fillRect(0, H / 2, W, H / 2 + 0.5);
  } else {
    const r = ((5 + (o.texSize ?? o.dotSize ?? 50) / 100 * 15) * s) / 2;
    c.fillStyle = o.texColor || o.dotColor || '#FFFFFF';
    // 一個週期裡有兩顆：角上四個（拼起來是同一顆）＋ 正中間錯開的那一顆
    for (const [px, py] of [[0, 0], [W, 0], [0, H], [W, H], [W / 2, H / 2]] as const) {
      patternGlyph(c, t, px, py, r);
    }
  }
  const out = { url: cv.toDataURL('image/png'), w: W, h: H };
  cv.width = cv.height = 0;
  if (tileCache.size > 60) tileCache.clear();
  tileCache.set(key, out);
  return out;
};
