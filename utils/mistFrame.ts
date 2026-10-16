/* 新圖形分類「邊框」的第一種：霧白邊框。
   跟照片特效「亮角」同一個樣子（往白色 screen 上去 → 邊緣變成霧白），
   但亮角只有四個角，這個是四個角加四個邊都有，中間是透明的。
   顏色跟著圖形的顏色走（預設白），所以畫的是「顏色 × 霧的濃度」。

   中間透明的那一塊有兩個旋鈕：
     範圍：霧從框邊往內延伸多少；
     形狀：0＝圓角方形，100＝完整的橢圓（預設）。
   距離用「超橢圓」量：s = (|x|ⁿ + |y|ⁿ)^(1/n)（x、y 以框的一半為 1），
   n＝2 就是橢圓，n 越大越接近方形。霧的濃度＝s 在「透明區邊界～框邊」之間的平滑過渡，
   超出框邊的四個角就是滿的。

   畫法：在一張小畫布（長邊 256px）上逐像素算，只算四分之一再鏡像，結果快取起來；
   移動、縮放只是把同一張貼上去，只有改比例或改旋鈕時才重算（約一毫秒）。 */
export const MIST_FRAME_KIND = 'mist-frame';
export const isMistFrame = (kind?: string) => kind === MIST_FRAME_KIND;

/** 面板「範圍」0～100。預設 50 */
export const MIST_RANGE_DEFAULT = 50;
/** 面板「形狀」0～100（0 圓角方形、100 橢圓）。預設 100 */
export const MIST_ROUND_DEFAULT = 100;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** 霧的寬度（以框的一半為 1）：範圍 0 → 0.12、100 → 1 */
const bandOf = (range = MIST_RANGE_DEFAULT) => .12 + clamp01(range / 100) * .88;
/** 超橢圓的次方：形狀 100 → 2（橢圓）、0 → 9（接近方形的圓角） */
const powerOf = (round = MIST_ROUND_DEFAULT) => 2 + (1 - clamp01(round / 100)) * 7;

const rgbOf = (hex: string) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [255, 255, 255];
};

const cache = new Map<string, HTMLCanvasElement>();
const MAX_CACHE = 12;
/** 已經上好顏色的霧（小畫布），比例、範圍、形狀、顏色一樣就直接拿 */
const mistCanvas = (w: number, h: number, color: string, range?: number, round?: number) => {
  const ar = Math.max(.05, Math.min(20, w / Math.max(1e-6, h)));
  const arQ = Math.round(ar * 100) / 100;
  const band = bandOf(range), n = powerOf(round);
  const key = `${arQ}|${band.toFixed(3)}|${n.toFixed(3)}|${color}`;
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  const L = 256;
  const W = Math.max(8, Math.round(arQ >= 1 ? L : L * arQ)) & ~1;
  const H = Math.max(8, Math.round(arQ >= 1 ? L / arQ : L)) & ~1;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(W, H), d = img.data;
  const [r, gg, b] = rgbOf(color);
  const r0 = Math.max(0, 1 - band);
  const hw = W / 2, hh = H / 2;
  for (let py = 0; py < hh; py++) {
    const v = (hh - py - .5) / hh;
    const vn = Math.pow(v, n);
    for (let px = 0; px < hw; px++) {
      const u = (hw - px - .5) / hw;
      const sd = Math.pow(Math.pow(u, n) + vn, 1 / n);
      const t = clamp01((sd - r0) / Math.max(1e-3, 1 - r0));
      const a = Math.round(t * t * (3 - 2 * t) * 255);
      if (!a) continue;
      for (const [x, y] of [[px, py], [W - 1 - px, py], [px, H - 1 - py], [W - 1 - px, H - 1 - py]]) {
        const o = (y * W + x) * 4;
        d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = a;
      }
    }
  }
  g.putImageData(img, 0, 0);
  cache.set(key, cv);
  while (cache.size > MAX_CACHE) {
    const old = cache.keys().next().value as string;
    const c = cache.get(old); cache.delete(old);
    if (c) c.width = c.height = 1;
  }
  return cv;
};

let texSurface: HTMLCanvasElement | null = null;
/**
 * 在 (0,0)～(w,h) 這個框裡畫霧白邊框。
 * texture：要疊紋理時傳進來（收到的是暫存畫布、跟框一樣大的路徑），紋理只會出現在有霧的地方。
 */
export const paintMistFrame = (
  ctx: CanvasRenderingContext2D, w: number, h: number, color = '#FFFFFF', range?: number, round?: number,
  texture?: (tc: CanvasRenderingContext2D, bodyPath: Path2D) => void,
) => {
  if (!(w > 0) || !(h > 0)) return;
  const mist = mistCanvas(w, h, color, range, round);
  if (!texture) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    (ctx as any).imageSmoothingQuality = 'high';
    ctx.drawImage(mist, 0, 0, w, h);
    ctx.restore();
    return;
  }
  /* 有紋理：先在暫存畫布上貼霧，再用 source-atop 把紋理疊上去（只留在霧上、跟著霧的濃淡），
     最後整張貼回來。暫存畫布照實際像素開，貼回來才不會糊。 */
  const m = ctx.getTransform();
  const k = Math.max(.25, Math.min(4, Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d))));
  const W = Math.max(1, Math.min(4096, Math.ceil(w * k))), H = Math.max(1, Math.min(4096, Math.ceil(h * k)));
  const cv = texSurface ??= document.createElement('canvas');
  if (cv.width !== W) cv.width = W;
  if (cv.height !== H) cv.height = H;
  const g = cv.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, W, H);
  g.imageSmoothingEnabled = true;
  (g as any).imageSmoothingQuality = 'high';
  g.drawImage(mist, 0, 0, W, H);
  g.setTransform(W / w, 0, 0, H / h, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  const body = new Path2D(); body.rect(0, 0, w, h);
  texture(g, body);
  g.globalCompositeOperation = 'source-over';
  g.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(cv, 0, 0, W, H, 0, 0, w, h);
};
