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

/** 條紋預設的兩個顏色。第一個顏色實際上會用「那個東西當下的顏色」
    （遮罩就是遮罩色、圖形就是圖形色），這裡只是最後的退路；第二個固定純白。 */
export const STRIPE_A = '#D2E8E1';
export const STRIPE_B = '#FFFFFF';

/** 條紋的方向選單。直式在前 —— 預設就是直式。 */
export const STRIPE_DIRS: ['v' | 'h', string][] = [['v', '直式'], ['h', '橫式']];

/** 條紋預設的方向 */
export const STRIPE_DIR_DEFAULT: 'v' = 'v';

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

/** 條紋的「數量」滑桿：0～30 條，預設 11 條。 */
export const STRIPE_N_MAX = 30;
export const STRIPE_N_DEFAULT = 11;

/**
 * 條紋改成直接指定「有幾條」，不是指定粗細。
 *
 * 這樣有兩個好處，而且都是白拿的：
 *   ① 一定剛好填滿 —— 每一條就是「整段長度 ÷ 條數」，
 *      不再需要以前那套「先算理想條寬、再湊到最接近的整數條」。
 *   ② 跟畫布大小完全無關 —— 預覽、匯出、大圖形、小圖形，
 *      同一個數字看到的條數一模一樣，不必再拿寬度去換算。
 *
 * 0 條在畫面上沒有意義，所以夾成 1 條（＝整片都是第一個顏色）。
 */
export const stripeBand = (span: number, count = STRIPE_N_DEFAULT) => {
  const n = Math.max(1, Math.min(STRIPE_N_MAX, Math.round(count || 0)));
  return { band: span > 0 ? span / n : 0, n };
};

/**
 * 把條紋鋪滿 (0,0)~(w,h)。兩個顏色相間，沒有間距可以調。
 * dir：'h' 橫式（一條一條橫著排）／'v' 直式。
 * count 是「總共幾條」，所以一定剛好填滿、每一條也一定一樣寬。
 */
export const paintStripesRect = (
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  count = STRIPE_N_DEFAULT, dir: 'h' | 'v' = STRIPE_DIR_DEFAULT, a = STRIPE_A, b = STRIPE_B,
) => {
  if (w <= 0 || h <= 0) return;
  const span = dir === 'h' ? h : w;
  const { band, n } = stripeBand(span, count);
  ctx.save();
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = i % 2 === 0 ? a : b;
    // 多鋪 0.6px：相鄰兩條之間不要因為反鋸齒露出一條細縫（最後一條不會超出去，
    // 因為呼叫端本來就把這一塊剪裁住了）
    if (dir === 'h') ctx.fillRect(0, i * band, w, band + 0.6);
    else ctx.fillRect(i * band, 0, band + 0.6, h);
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
  /** 條紋：條數 0~30、方向、兩個顏色 */
  stripeN?: number;
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
    paintStripesRect(ctx, w, h, o.stripeN ?? STRIPE_N_DEFAULT,
      o.stripeDir === 'h' ? 'h' : 'v', o.stripeA || STRIPE_A, o.stripeB || STRIPE_B);
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
