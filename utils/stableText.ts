/* 文字縮放時的「抖動」：fillText 在不同的縮放倍率下，瀏覽器（尤其 Safari）
   會依「實際顯示字級」重新 hint 字形、把每個字的位置各自吸到像素格上。
   倍率一路連續改變時，每個字吸附的那一格各不相同，整串字就在相鄰像素間跳。

   符號早就改成「同一張高解析度貼圖、只變矩陣」才穩定；一般文字也走同一招：
   用完全相同的字型狀態（font／字距／對齊／描邊）在離屏畫布排一次字，
   之後只用目前矩陣 drawImage —— 位置是連續的，不會再逐幀重新排字。
   貼圖解析度只在倍率跨過 2 的次方時才換一張（清晰度改變，位置不變）。 */

type Entry = { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number; px: number };
const cache = new Map<string, Entry>();
const MAX_ENTRIES = 48;
const MAX_TOTAL_PX = 48e6;
const MAX_ENTRY_PX = 8e6;
const MAX_SIDE = 8192;
let totalPx = 0;

const evict = () => {
  while (cache.size > MAX_ENTRIES || totalPx > MAX_TOTAL_PX) {
    const key = cache.keys().next().value;
    if (key === undefined) break;
    const old = cache.get(key)!;
    cache.delete(key); totalPx -= old.px;
    old.canvas.width = old.canvas.height = 1;
  }
};

/**
 * 跟 ctx.fillText / ctx.strokeText(text, x, y) 畫出同一個位置、同一種樣式，
 * 但以快取貼圖繪製，縮放時不抖。樣式（漸層等）無法快取時回傳 false，
 * 呼叫端照原本的 fillText 畫。陰影（發光）照常套用在 drawImage 上。
 */
export function drawStableText(ctx: CanvasRenderingContext2D, mode: 'fill' | 'stroke', text: string, x: number, y: number): boolean {
  if (!text) return true;
  const style = mode === 'stroke' ? ctx.strokeStyle : ctx.fillStyle;
  if (typeof style !== 'string' || typeof document === 'undefined') return false;
  const m = ctx.getTransform();
  const k = Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
  if (!(k > 0) || !Number.isFinite(k)) return false;
  const level = Math.min(16, Math.max(1, 2 ** Math.ceil(Math.log2(k))));
  const spacing = String((ctx as any).letterSpacing || '0px');
  // 字型還沒載好時排出來的是備用字型；載好後鑰匙不同，自然重排一次。
  const ready = (document as any).fonts?.check?.(ctx.font) ?? true;
  const key = [mode, text, ctx.font, spacing, ctx.textAlign, ctx.textBaseline, style,
    mode === 'stroke' ? `${ctx.lineWidth}|${ctx.lineJoin}|${ctx.miterLimit}` : '', level, ready].join('\u0001');
  let hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); }
  else {
    const canvas = document.createElement('canvas');
    const g = canvas.getContext('2d');
    if (!g) return false;
    const setup = () => {
      g.font = ctx.font; (g as any).letterSpacing = spacing;
      g.textAlign = ctx.textAlign; g.textBaseline = ctx.textBaseline;
      g.fillStyle = style; g.strokeStyle = style;
      g.lineWidth = ctx.lineWidth; g.lineJoin = ctx.lineJoin; g.miterLimit = ctx.miterLimit;
    };
    setup();
    const metrics = g.measureText(text);
    const fontPx = parseFloat(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] || '16');
    const margin = Math.ceil((mode === 'stroke' ? ctx.lineWidth : 0) + fontPx * .15 + 2);
    const left = Math.max(0, metrics.actualBoundingBoxLeft || 0) + margin;
    const right = Math.max(0, metrics.actualBoundingBoxRight || metrics.width) + margin;
    const top = Math.max(0, metrics.actualBoundingBoxAscent || fontPx) + margin;
    const bottom = Math.max(0, metrics.actualBoundingBoxDescent || fontPx * .3) + margin;
    const w = left + right, h = top + bottom;
    const lv = Math.max(.25, Math.min(level, MAX_SIDE / Math.max(w, h), Math.sqrt(MAX_ENTRY_PX / Math.max(1, w * h))));
    canvas.width = Math.max(1, Math.ceil(w * lv));
    canvas.height = Math.max(1, Math.ceil(h * lv));
    setup();
    g.setTransform(lv, 0, 0, lv, left * lv, top * lv);
    if (mode === 'stroke') g.strokeText(text, 0, 0); else g.fillText(text, 0, 0);
    hit = { canvas, x: -left, y: -top, w: canvas.width / lv, h: canvas.height / lv, px: canvas.width * canvas.height };
    cache.set(key, hit); totalPx += hit.px; evict();
  }
  const smoothing = ctx.imageSmoothingEnabled, quality = ctx.imageSmoothingQuality;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(hit.canvas, x + hit.x, y + hit.y, hit.w, hit.h);
  ctx.imageSmoothingEnabled = smoothing; ctx.imageSmoothingQuality = quality;
  return true;
}
