/* 高品質發光（文字、符號、圖形共用）。

   以前的做法是直接在畫面上設 shadowBlur 畫三層。shadowBlur 的單位是「裝置像素」，
   物件放大、畫面放大時半徑跟著變成幾十、幾百像素：
     ‧ Safari（CoreGraphics）遇到大半徑會先縮小再模糊再放大 —— 那就是看到的像素感、方塊感；
     ‧ 模糊核的大小是取整的整數像素，半徑連續變化時每一格取整結果不同 —— 那就是縮放時光在抖。

   現在的做法：光暈另外畫在一張小畫布上，並且讓「最小那層光在小畫布上的模糊半徑」永遠是同一個數字
   （GLOW_SIGMA_PX）。不管物件多大、畫面放多大，交給瀏覽器的模糊永遠是同一組小半徑 ——
   不會被降解析度、也不會因為取整而跳；畫回畫面時只是把這張平滑的光暈圖用高品質內插放大／縮小，
   模糊本來就沒有細節，放大不會出現像素格，縮放時也只是連續的幾何變換，不會抖。 */

/** 最小那層光在光暈圖上的 shadowBlur（像素）。三層就是 8／16／24，都在瀏覽器能全解析度處理的範圍內。 */
const GLOW_BLUR_PX = 8;
/** 光暈圖最多多少像素（超過就整體降一點解析度，光暈仍然平滑） */
const MAX_SIDE = 2048, MAX_PIXELS = 2048 * 1536;
/** 快取的總像素上限（約 32MB 以內；手機記憶體吃緊時 WebContent 會被系統砍掉） */
const CACHE_PIXELS = 8e6;

type Sprite = { c: HTMLCanvasElement; x: number; y: number; w: number; h: number };
const cache = new Map<string, Sprite>();
let cachedPixels = 0;
let scratch: HTMLCanvasElement | null = null;

const dropOldest = () => {
  while (cachedPixels > CACHE_PIXELS && cache.size) {
    const [k, v] = cache.entries().next().value!;
    cache.delete(k); cachedPixels -= v.c.width * v.c.height; v.c.width = v.c.height = 0;
  }
};
/** 離開工具時把光暈快取整個還回去 */
export const releaseGlowSprites = () => {
  for (const v of cache.values()) v.c.width = v.c.height = 0;
  cache.clear(); cachedPixels = 0;
  if (scratch) { scratch.width = scratch.height = 0; scratch = null; }
};

/** 把畫筆狀態（字型、線條、虛線…）複製到光暈圖上，draw 才能原樣把形狀畫出來 */
const copyState = (src: CanvasRenderingContext2D, g: CanvasRenderingContext2D) => {
  g.font = src.font; g.textAlign = src.textAlign; g.textBaseline = src.textBaseline; g.direction = src.direction;
  const a = src as any, b = g as any;
  for (const k of ['letterSpacing', 'wordSpacing', 'fontKerning', 'fontStretch', 'fontVariantCaps', 'textRendering']) if (k in a) { try { b[k] = a[k]; } catch { /* 不支援就略過 */ } }
  g.lineWidth = src.lineWidth; g.lineJoin = src.lineJoin; g.lineCap = src.lineCap; g.miterLimit = src.miterLimit;
  g.setLineDash(src.getLineDash()); g.lineDashOffset = src.lineDashOffset;
  g.fillStyle = src.fillStyle; g.strokeStyle = src.strokeStyle;
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
};

/**
 * 在 ctx 目前的座標系畫發光（只有光，不含形狀本身）。
 * @param box   形狀在目前座標系裡大概佔的範圍（給大一點沒關係，只影響光暈圖大小）
 * @param blurs 每一層的 shadowBlur，**裝置像素**（就是以前直接設給 ctx.shadowBlur 的值）
 * @param draw  把形狀畫到 g 上（g 已經對好目前的座標系）。呼叫端的繪製函式如果寫死畫在 ctx 上，
 *              在 draw 裡把那個變數暫時換成 g 即可。
 * @param key   內容沒變時的識別字串（不要含縮放倍率）；null＝每次重畫（逐幀動畫中）。
 */
export function paintGlow(ctx: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number },
  blurs: number[], color: string, draw: (g: CanvasRenderingContext2D) => void, key: string | null = null) {
  const list = blurs.filter(b => b > 0);
  if (!list.length || typeof document === 'undefined') return;
  const m = ctx.getTransform();
  const dev = Math.max(1e-4, Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)));
  // 換成目前座標系的單位：這樣光暈圖跟縮放倍率無關
  const local = list.map(b => b / dev);
  const b0 = Math.min(...local), bMax = Math.max(...local);
  // 光暈圖的解析度：讓最小那層剛好是 GLOW_BLUR_PX。光很小（比螢幕上還小）的時候不必比螢幕更細。
  let k = Math.min(GLOW_BLUR_PX / b0, dev * 2);
  const pad = bMax * 1.6 + (ctx.lineWidth || 0);
  const lw = box.w + pad * 2, lh = box.h + pad * 2;
  k = Math.min(k, MAX_SIDE / lw, MAX_SIDE / lh, Math.sqrt(MAX_PIXELS / (lw * lh)));
  const W = Math.max(1, Math.ceil(lw * k)), H = Math.max(1, Math.ceil(lh * k));
  const fullKey = key === null ? null : `${key}|${color}|${local.map(v => v.toFixed(3)).join(',')}|${k.toFixed(4)}|${box.x},${box.y},${box.w},${box.h}`;
  let sp = fullKey ? cache.get(fullKey) : undefined;
  if (sp) { cache.delete(fullKey!); cache.set(fullKey!, sp); }
  else {
    const c = fullKey ? document.createElement('canvas') : (scratch || (scratch = document.createElement('canvas')));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
    copyState(ctx, g);
    // 形狀畫在光暈圖外面，只讓影子落進來（形狀本身的半透明邊緣不會混進光裡）
    const off = lw * 4;
    g.setTransform(k, 0, 0, k, (pad - box.x - off) * k, (pad - box.y) * k);
    g.shadowOffsetX = off * k; g.shadowOffsetY = 0; g.shadowColor = color;
    for (const b of local) {
      g.shadowBlur = b * k;
      g.save();
      try { draw(g); } finally { g.restore(); }
    }
    g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetX = 0;
    sp = { c, x: box.x - pad, y: box.y - pad, w: W / k, h: H / k };
    if (fullKey) { cache.set(fullKey, sp); cachedPixels += W * H; dropOldest(); }
  }
  ctx.save();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sp.c, sp.x, sp.y, sp.w, sp.h);
  ctx.restore();
}
