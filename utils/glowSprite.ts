/* 高品質發光／陰影（文字、符號、圖形、圖案、邊框、字元畫共用）。

   問題：以前直接在畫面上設 shadowBlur。shadowBlur 的單位是「裝置像素」，物件或畫面放大時半徑變成
   幾十、幾百像素 ——
     ‧ Safari 遇到大半徑會自己先縮小再模糊再放大，放大看就是方塊、像素感；
     ‧ 模糊核是整數取整的，半徑連續變化（拖滑桿、縮放）時每一格取整結果不同 → 光在抖。

   做法（多層金字塔模糊，遊戲與系統介面的標準作法）：
     1. 形狀以「螢幕解析度」畫成遮罩（跟畫面的像素一一對齊，不會有放大的像素格）。
     2. 每次縮小一半（2×2 平均），縮到「剛好讓剩下要模糊的量只有固定 2.5px」為止 ——
        最後一步縮的比例是連續的，所以模糊量也是連續的，拖滑桿不會一格一格跳。
     3. 在最小的那層用固定的 2.5px（shadowBlur 5）模糊：瀏覽器永遠只看到這個小半徑，
        不會降解析度、也不會因為半徑取整而抖。
     4. 再每次放大一倍放回原本大小。畫布在 2 倍放大時的雙線性內插就是 Chaikin 細分，
        連續放大會收斂成平滑曲線，不會出現格子。
   結果是一張螢幕解析度、真正平滑的高斯光暈，模糊量跟以前的 shadowBlur 一樣（外觀不變）。 */

/** 最小那層的模糊（σ，像素）。瀏覽器只會收到 shadowBlur = 2×這個值。 */
const COARSE_SIGMA = 2.5;
/** 縮小、放大過程本身會多出一點點模糊；校正係數（在 Chromium 上對照直接 shadowBlur 量出來的） */
let SIGMA_FIX = 1;
/** 快取的總像素上限（約 48MB；手機記憶體吃緊時 WebContent 會被系統砍掉） */
const CACHE_PIXELS = 12e6;

type Ctx2D = CanvasRenderingContext2D;
const pool = new Map<string, HTMLCanvasElement>();
const scratch = (name: string, w: number, h: number): [HTMLCanvasElement, Ctx2D] => {
  let c = pool.get(name);
  if (!c) { c = document.createElement('canvas'); pool.set(name, c); }
  w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const g = c.getContext('2d')!;
  reset(g); g.clearRect(0, 0, w, h);
  return [c, g];
};
const reset = (g: Ctx2D) => {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetX = 0; g.shadowOffsetY = 0;
  try { g.filter = 'none'; } catch { /* 舊瀏覽器 */ }
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
};

/** 直接用 shadowBlur 模糊（σ 很小時；跟以前完全一樣的畫法） */
const shadowInto = (dst: Ctx2D, src: CanvasImageSource, sw: number, sh: number, sigma: number,
  dw = sw, dh = sh) => {
  const off = Math.ceil(dw) * 2 + 16;
  dst.save();
  dst.shadowColor = '#000'; dst.shadowBlur = sigma * 2; dst.shadowOffsetX = off; dst.shadowOffsetY = 0;
  dst.drawImage(src, 0, 0, sw, sh, -off, 0, dw, dh);
  dst.restore();
};

/**
 * 把 src（左上角 W×H 那一塊）的 alpha 模糊 σ 之後，用 src-over 疊到 dst 的 (0,0)。dst 必須是單位矩陣。
 */
export function blurAlphaInto(dst: Ctx2D, src: HTMLCanvasElement, W: number, H: number, sigma: number) {
  sigma *= SIGMA_FIX;
  if (sigma <= 0.05) { dst.drawImage(src, 0, 0, W, H, 0, 0, W, H); return; }
  if (sigma <= COARSE_SIGMA) { shadowInto(dst, src, W, H, sigma); return; }
  const q = COARSE_SIGMA / sigma;                // 最小那層相對原圖的比例（連續）
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

/**
 * 用遮罩（任何顏色，只看 alpha）做出多層發光，疊到 dst 的 (0,0)。dst 必須是單位矩陣。
 * 每一層：模糊 → 上色 → 疊上去，跟以前「每層各畫一次 shadowBlur」的合成結果相同。
 */
export function glowFromMask(dst: Ctx2D, mask: HTMLCanvasElement, W: number, H: number,
  sigmas: number[], color: string) {
  for (const sg of sigmas) {
    if (!(sg > 0)) continue;
    const [cl, gl] = scratch('layer', W, H);
    blurAlphaInto(gl, mask, W, H, sg);
    gl.globalCompositeOperation = 'source-in';
    gl.fillStyle = color; gl.fillRect(0, 0, W, H);
    dst.drawImage(cl, 0, 0, W, H, 0, 0, W, H);
  }
}

type Cached = { c: HTMLCanvasElement; m: string; x: number; y: number };
const cache = new Map<string, Cached>();
let cachedPixels = 0;
const dropOldest = () => {
  while (cachedPixels > CACHE_PIXELS && cache.size) {
    const [k, v] = cache.entries().next().value!;
    cache.delete(k); cachedPixels -= v.c.width * v.c.height; v.c.width = v.c.height = 0;
  }
};
/** 離開工具時把快取與暫存畫布整個還回去 */
export const releaseGlowSprites = () => {
  for (const v of cache.values()) v.c.width = v.c.height = 0;
  cache.clear(); cachedPixels = 0;
  for (const c of pool.values()) c.width = c.height = 0;
  pool.clear();
};

/** 把畫筆狀態（字型、線條、虛線…）複製到遮罩上，draw 才能原樣把形狀畫出來 */
const copyState = (src: Ctx2D, g: Ctx2D) => {
  g.font = src.font; g.textAlign = src.textAlign; g.textBaseline = src.textBaseline; g.direction = src.direction;
  const a = src as any, b = g as any;
  for (const k of ['letterSpacing', 'wordSpacing', 'fontKerning', 'fontStretch', 'fontVariantCaps', 'textRendering']) if (k in a) { try { b[k] = a[k]; } catch { /* 不支援就略過 */ } }
  g.lineWidth = src.lineWidth; g.lineJoin = src.lineJoin; g.lineCap = src.lineCap; g.miterLimit = src.miterLimit;
  g.setLineDash(src.getLineDash()); g.lineDashOffset = src.lineDashOffset;
  g.fillStyle = src.fillStyle; g.strokeStyle = src.strokeStyle;
};

/**
 * 在 ctx 目前的座標系畫發光（只有光，不含形狀本身）。
 * @param box   形狀在目前座標系裡大概佔的範圍（給大一點沒關係）
 * @param blurs 每一層的 shadowBlur，**裝置像素**（就是以前直接設給 ctx.shadowBlur 的值）
 * @param draw  把形狀畫到 g 上（g 已經對好目前的座標系）
 * @param key   內容沒變時的識別字串；null＝不快取（逐幀動畫中）
 */
export function paintGlow(ctx: Ctx2D, box: { x: number; y: number; w: number; h: number },
  blurs: number[], color: string, draw: (g: Ctx2D) => void, key: string | null = null) {
  const sigmas = blurs.filter(b => b > 0).map(b => b / 2);
  if (!sigmas.length || typeof document === 'undefined') return;
  const m = ctx.getTransform();
  // 光會散出去的距離（裝置像素）：3σ
  const pad = Math.ceil(Math.max(...sigmas) * 3 + 2);
  const pts = [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]]
    .map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
  let x0 = Math.min(...pts.map(p => p[0])) - pad, x1 = Math.max(...pts.map(p => p[0])) + pad;
  let y0 = Math.min(...pts.map(p => p[1])) - pad, y1 = Math.max(...pts.map(p => p[1])) + pad;
  // 只做畫面看得到的那一塊（放很大時字可能比整個畫面大好幾倍）
  const cw = (ctx.canvas as any).width || 0, ch = (ctx.canvas as any).height || 0;
  if (cw > 0 && ch > 0) { x0 = Math.max(x0, -pad); y0 = Math.max(y0, -pad); x1 = Math.min(x1, cw + pad); y1 = Math.min(y1, ch + pad); }
  x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.ceil(x1); y1 = Math.ceil(y1);
  const W = x1 - x0, H = y1 - y0;
  if (W <= 0 || H <= 0 || W * H > 40e6) return;
  const ms = [m.a, m.b, m.c, m.d, m.e, m.f].map(v => v.toFixed(4)).join(',');
  const fullKey = key === null ? null : `${key}|${color}|${sigmas.map(v => v.toFixed(3)).join(',')}`;
  let hit = fullKey ? cache.get(fullKey) : undefined;
  if (hit && (hit.m !== ms || hit.x !== x0 || hit.y !== y0)) hit = undefined;
  let out: HTMLCanvasElement;
  if (hit) { cache.delete(fullKey!); cache.set(fullKey!, hit); out = hit.c; }
  else {
    // 形狀畫成遮罩：跟畫面同一個矩陣，只平移到這一塊的左上角
    const [cm, gm] = scratch('mask', W, H);
    copyState(ctx, gm);
    gm.setTransform(m.a, m.b, m.c, m.d, m.e - x0, m.f - y0);
    gm.save(); try { draw(gm); } finally { gm.restore(); }
    const old = fullKey ? cache.get(fullKey) : undefined;
    if (old) { cache.delete(fullKey!); cachedPixels -= old.c.width * old.c.height; }
    out = old?.c && fullKey ? old.c : (fullKey ? document.createElement('canvas') : scratch('acc', W, H)[0]);
    if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
    const go = out.getContext('2d')!;
    reset(go); go.clearRect(0, 0, W, H);
    glowFromMask(go, cm, W, H, sigmas, color);
    if (fullKey) { cache.set(fullKey, { c: out, m: ms, x: x0, y: y0 }); cachedPixels += W * H; dropOldest(); }
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
  ctx.drawImage(out, x0, y0);
  ctx.restore();
}

/** 測試用：校正係數 */
export const __setGlowSigmaFix = (v: number) => { SIGMA_FIX = v; };
