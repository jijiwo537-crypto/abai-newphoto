/* 大半徑發光／陰影的高品質畫法（文字、符號、圖形共用）。

   原本的畫法是直接在畫面上設 shadowBlur 畫三層。半徑小的時候這樣完全沒問題，所以**小半徑照舊**；
   只有半徑大（物件或畫面放大）的那幾層，Safari 會自己降成低解析度模糊 → 放大看是方塊、像素感。

   大半徑的層改成：
     1. 形狀畫成遮罩，解析度跟光的大小成比例（光越大、遮罩越小 —— 模糊本來就沒有細節），
        而且只畫畫面看得到的那一塊；所有暫存畫布都有硬上限，遠低於 iPhone 的畫布限制。
     2. 金字塔模糊：一次縮一半、最小那層只用固定 2.5px 的模糊、再一次放大一倍回來
        （2 倍的雙線性放大＝Chaikin 細分，連續放大是平滑曲線，不會出現格子）。
        瀏覽器永遠只收到很小的固定半徑：不會降解析度，模糊量也是連續的。
     3. 放大回畫面時也是一次一倍，最後一步不超過 2 倍。
   任何一步失敗（例如記憶體不夠建不出畫布）都退回原本的畫法 —— 寧可有一點像素感，也不能讓東西消失。 */

/** σ（裝置像素）不超過這個值的層照原本直接畫 */
const DIRECT_MAX_SIGMA = 4;
/** 遮罩上最小那層的 σ（像素）：遮罩解析度就是照這個比例決定的 */
const WORK_SIGMA = 3;
/** 金字塔最小那層的模糊 σ（像素） */
const COARSE_SIGMA = 2.5;
/** 遮罩最多多少像素 */
const MAX_WORK_PIXELS = 300_000;
/** 放大回去途中的暫存畫布最多多少像素 */
const MAX_UP_PIXELS = 1_000_000;

type Ctx2D = CanvasRenderingContext2D;
const pool = new Map<string, HTMLCanvasElement>();
const reset = (g: Ctx2D) => {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetX = 0; g.shadowOffsetY = 0;
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
};
const ctxOf = (c: HTMLCanvasElement) => {
  const g = c.getContext('2d');
  if (!g) throw new Error('no 2d context');
  return g;
};
/* iPhone：所有畫布加起來超過系統上限時，新的畫布不會報錯，而是「畫什麼都是空白」。
   所以不能只靠例外來判斷 —— 每張暫存畫布建立或長大時，實際畫一個點再讀回來確認；
   畫不出來就整段停用，改回原本的畫法（寧可有一點像素感，也不能沒有光）。 */
let broken = false;
const fail = (why: string): never => { broken = true; releaseGlowSprites(); throw new Error(why); };
const probe = (c: HTMLCanvasElement, g: Ctx2D) => {
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, 2, 2); g.fillStyle = '#000'; g.fillRect(0, 0, 1, 1);
  let a = 0;
  try { a = g.getImageData(0, 0, 1, 1).data[3]; } catch { a = 0; }
  if (a < 200) fail('canvas draws nothing');
  void c;
};
/* 暫存畫布只長不縮：同一張一直重用，不會每一格都重新配置記憶體（也只在長大的那一次需要確認） */
const scratch = (name: string, w: number, h: number): [HTMLCanvasElement, Ctx2D] => {
  w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
  if (w * h > MAX_UP_PIXELS * 1.05) throw new Error('scratch too big');
  let c = pool.get(name);
  if (!c) { c = document.createElement('canvas'); (c as any).__glow = 1; c.width = c.height = 0; pool.set(name, c); }
  if (c.width < w || c.height < h) {
    const nw = Math.max(c.width, w), nh = Math.max(c.height, h);
    c.width = nw; c.height = nh;
    if (c.width !== nw || c.height !== nh) fail('canvas alloc failed');
    const g0 = c.getContext('2d', { willReadFrequently: false } as any) as Ctx2D | null;
    if (!g0) fail('no 2d context');
    probe(c, g0!);
  }
  const g = ctxOf(c);
  reset(g); g.clearRect(0, 0, c.width, c.height);
  return [c, g];
};

/** 直接用 shadowBlur 模糊（σ 很小時） */
const shadowInto = (dst: Ctx2D, src: CanvasImageSource, sw: number, sh: number, sigma: number) => {
  const off = Math.ceil(sw) * 2 + 16;
  dst.save();
  dst.shadowColor = '#000'; dst.shadowBlur = sigma * 2; dst.shadowOffsetX = off; dst.shadowOffsetY = 0;
  dst.drawImage(src, 0, 0, sw, sh, -off, 0, sw, sh);
  dst.restore();
};

/** src 左上角 W×H 的 alpha 模糊 σ 後疊到 dst (0,0)（dst 是單位矩陣） */
function blurAlphaInto(dst: Ctx2D, src: HTMLCanvasElement, W: number, H: number, sigma: number) {
  if (sigma <= COARSE_SIGMA) { shadowInto(dst, src, W, H, sigma); return; }
  const q = COARSE_SIGMA / sigma;
  let cur: HTMLCanvasElement = src, s = 1, i = 0;
  while (s * 0.5 > q * 1.0001) {
    const ns = s * 0.5;
    const [c, g] = scratch('d' + (i++ % 2), W * ns + 2, H * ns + 2);
    g.drawImage(cur, 0, 0, W * s, H * s, 0, 0, W * ns, H * ns);
    cur = c; s = ns;
  }
  const [cq, gq] = scratch('q', W * q + 2, H * q + 2);
  gq.drawImage(cur, 0, 0, W * s, H * s, 0, 0, W * q, H * q);
  const [cb, gb] = scratch('qb', W * q + 2, H * q + 2);
  shadowInto(gb, cq, W * q, H * q, COARSE_SIGMA);
  cur = cb; s = q; i = 0;
  while (s * 2 < 0.9999) {
    const ns = s * 2;
    const [c, g] = scratch('u' + (i++ % 2), W * ns + 2, H * ns + 2);
    g.drawImage(cur, 0, 0, W * s, H * s, 0, 0, W * ns, H * ns);
    cur = c; s = ns;
  }
  dst.drawImage(cur, 0, 0, W * s, H * s, 0, 0, W, H);
}

const copyState = (src: Ctx2D, g: Ctx2D) => {
  g.font = src.font; g.textAlign = src.textAlign; g.textBaseline = src.textBaseline; g.direction = src.direction;
  const a = src as any, b = g as any;
  for (const k of ['letterSpacing', 'wordSpacing', 'fontKerning', 'fontStretch', 'fontVariantCaps', 'textRendering']) if (k in a) { try { b[k] = a[k]; } catch { /* 不支援就略過 */ } }
  g.lineWidth = src.lineWidth; g.lineJoin = src.lineJoin; g.lineCap = src.lineCap; g.miterLimit = src.miterLimit;
  g.setLineDash(src.getLineDash()); g.lineDashOffset = src.lineDashOffset;
  g.fillStyle = src.fillStyle; g.strokeStyle = src.strokeStyle;
};

type Cached = { c: HTMLCanvasElement; ms: string; x0: number; y0: number; W: number; H: number; r: number };
/** 離開工具時把快取與暫存畫布整個還回去 */
export const releaseGlowSprites = () => {
  for (const c of pool.values()) c.width = c.height = 0;
  pool.clear();
};

/** 把大半徑的那幾層畫成一張（遮罩解析度）光暈圖；回傳 null＝這次不適用 */
function bigLayers(ctx: Ctx2D, box: { x: number; y: number; w: number; h: number }, sigmas: number[],
  color: string, draw: (g: Ctx2D) => void, key: string | null): Cached | null {
  const m = ctx.getTransform();
  const sMin = Math.min(...sigmas), sMax = Math.max(...sigmas);
  const pad = Math.ceil(sMax * 3 + 2);
  const pts = [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]]
    .map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
  let x0 = Math.min(...pts.map(p => p[0])) - pad, x1 = Math.max(...pts.map(p => p[0])) + pad;
  let y0 = Math.min(...pts.map(p => p[1])) - pad, y1 = Math.max(...pts.map(p => p[1])) + pad;
  // 只做畫面看得到的那一塊
  const cw = (ctx.canvas as any)?.width || 0, ch = (ctx.canvas as any)?.height || 0;
  if (cw > 0 && ch > 0) { x0 = Math.max(x0, -pad); y0 = Math.max(y0, -pad); x1 = Math.min(x1, cw + pad); y1 = Math.min(y1, ch + pad); }
  x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.ceil(x1); y1 = Math.ceil(y1);
  const W = x1 - x0, H = y1 - y0;
  if (W <= 0 || H <= 0) return { c: null as any, ms: '', x0, y0, W: 0, H: 0, r: 1 };
  let r = Math.min(1, WORK_SIGMA / Math.max(1e-3, sMin));
  if (W * H * r * r > MAX_WORK_PIXELS) r = Math.sqrt(MAX_WORK_PIXELS / (W * H));
  const ms = [m.a, m.b, m.c, m.d, m.e, m.f].map(v => v.toFixed(3)).join(',');
  const fullKey = key === null ? null : `${key}|${color}|${sigmas.map(v => v.toFixed(3)).join(',')}`;
  void fullKey; void ms;
  const Mw = W * r, Mh = H * r;
  const [cm, gm] = scratch('mask', Mw + 2, Mh + 2);
  copyState(ctx, gm);
  gm.setTransform(m.a * r, m.b * r, m.c * r, m.d * r, (m.e - x0) * r, (m.f - y0) * r);
  gm.save(); try { draw(gm); } finally { gm.restore(); }
  reset(gm);
  /* 不留快取（少佔記憶體）：遮罩解析度跟光的大小成比例，每次重畫的量本來就很小 */
  const [out, go] = scratch('acc', Mw + 2, Mh + 2);
  for (const sg of sigmas) {
    const [cl, gl] = scratch('layer', Mw + 2, Mh + 2);
    blurAlphaInto(gl, cm, Mw, Mh, sg * r);
    gl.globalCompositeOperation = 'source-in';
    gl.fillStyle = color; gl.fillRect(0, 0, cl.width, cl.height);
    go.drawImage(cl, 0, 0);
  }
  return { c: out, ms, x0, y0, W, H, r };
}

/** 把遮罩解析度的光暈圖一次放大一倍貼回畫面（最後一步不超過 2 倍） */
function putBack(ctx: Ctx2D, g: Cached, offX: number, offY: number) {
  if (!g.c || g.W <= 0) return;
  let cur: HTMLCanvasElement = g.c, s = g.r, i = 0;
  while (s * 2 < 0.5 && (g.W * s * 2) * (g.H * s * 2) <= MAX_UP_PIXELS) {
    const ns = s * 2;
    const [c, gg] = scratch('U' + (i++ % 2), g.W * ns + 2, g.H * ns + 2);
    gg.drawImage(cur, 0, 0, g.W * s, g.H * s, 0, 0, g.W * ns, g.H * ns);
    cur = c; s = ns;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, g.W * s, g.H * s, g.x0 + offX, g.y0 + offY, g.W, g.H);
  ctx.restore();
}

/**
 * 畫發光，取代原本的「for 每一層 { ctx.shadowBlur = b; 畫形狀 }」。
 * 小半徑的層原封不動照原本畫（含形狀本身）；大半徑的層走高品質畫法，再照樣把形狀本身畫一次。
 * @param box   形狀在目前座標系裡大概佔的範圍（給大一點沒關係）
 * @param blurs 每一層的 shadowBlur（裝置像素，就是原本直接設給 ctx.shadowBlur 的值）
 * @param draw  把形狀畫到 g 上（g 已經對好目前的座標系；g 也可能就是 ctx 本身）
 * @param key   內容沒變時的識別字串；null＝不快取
 */
/* 第一次用到時整條流程實際跑一次：方塊模糊後，外面一點的地方一定要有光。沒有就停用（某些裝置的畫布行為不同） */
let tested = false;
const selfTest = () => {
  if (tested) return; tested = true;
  try {
    const m = document.createElement('canvas'); m.width = 80; m.height = 80;
    const gm = m.getContext('2d'); if (!gm) fail('no ctx');
    gm!.fillStyle = '#000'; gm!.fillRect(30, 30, 20, 20);
    const [, gl] = scratch('layer', 80, 80);
    blurAlphaInto(gl, m, 80, 80, 8);
    const near = gl.getImageData(56, 40, 1, 1).data[3], far = gl.getImageData(2, 2, 1, 1).data[3];
    m.width = m.height = 0;
    // σ=8：離方塊邊 6px 的地方大約 0.2～0.25 的不透明度；角落應該幾乎是 0
    if (!(near > 25 && near < 110 && far < 10)) fail('self test failed ' + near + ',' + far);
  } catch { broken = true; releaseGlowSprites(); }
};
export const glowFallbackActive = () => broken;

export function paintGlow(ctx: Ctx2D, box: { x: number; y: number; w: number; h: number },
  blurs: number[], color: string, draw: (g: Ctx2D) => void, key: string | null = null, allBig = false) {
  const isBig = (b: number) => b > 0 && (allBig || b / 2 > DIRECT_MAX_SIGMA);
  const big = blurs.filter(isBig);
  const small = blurs.filter(b => !isBig(b));
  let fallback = small;
  if (big.length && typeof document !== 'undefined') selfTest();
  if (big.length && typeof document !== 'undefined' && !broken) {
    try {
      const g = bigLayers(ctx, box, big.map(b => b / 2), color, draw, key);
      if (g) {
        putBack(ctx, g, 0, 0);
        // 原本每一層也會連同形狀本身畫一次，照樣畫
        ctx.save(); ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
        for (let i = 0; i < big.length; i++) draw(ctx);
        ctx.restore();
      } else fallback = blurs;
    } catch { fallback = blurs; }
  } else fallback = blurs;
  if (!fallback.length) return;
  ctx.save();
  ctx.shadowColor = color;
  for (const b of fallback) { ctx.shadowBlur = b; draw(ctx); }
  ctx.restore();
}

/**
 * 只畫影子（不畫形狀本身），位移是螢幕方向的裝置像素。大半徑走高品質畫法；
 * 回傳 false＝這次不適用，呼叫端照原本畫。
 */
export function paintBigShadow(ctx: Ctx2D, box: { x: number; y: number; w: number; h: number },
  blur: number, color: string, offX: number, offY: number, draw: (g: Ctx2D) => void, key: string | null = null): boolean {
  if (!(blur / 2 > DIRECT_MAX_SIGMA) || typeof document === 'undefined') return false;
  selfTest();
  if (broken) return false;
  try {
    const g = bigLayers(ctx, box, [blur / 2], color, draw, key);
    if (!g) return false;
    putBack(ctx, g, offX, offY);
    return true;
  } catch { return false; }
}
