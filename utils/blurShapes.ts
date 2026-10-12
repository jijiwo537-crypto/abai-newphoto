/* 「模糊」圖形：星星、圓角星星、愛心、圓形、十字星、方形的整顆高斯模糊版。
 *
 * 不是羽化：羽化是把邊緣往內變透明，圖形看起來會縮小一圈；
 * 這裡是像整張拍糊那樣，邊緣同時往外暈開、往內變淡，一半透明的地方剛好落在原本的邊上，
 * 所以看起來大小不變。
 *
 * 畫法用陰影：把圖形畫到畫布外面很遠的地方，只讓它的陰影（shadowBlur）落回原位。
 * iPhone 的 Safari 對 ctx.filter = 'blur()' 支援不穩，陰影模糊則是每一台都一樣。 */
export const BLUR_SHAPE_KINDS = new Set(['blur-star', 'blur-star-rounded', 'blur-heart', 'blur-circle', 'blur-cross-star', 'blur-square']);
export const isBlurShape = (kind?: string) => !!kind && BLUR_SHAPE_KINDS.has(kind);
/** 模糊滑桿的預設值（畫面上的 0～100） */
export const BLUR_SHAPE_DEFAULT = 10;

/** 模糊半徑（圖形自己的座標單位）。
 *  滑桿看起來是 0～100，實際對應舊版滑桿的 5～20（0 ＝ 一點點糊，100 ＝ 短邊的 6%）。 */
export const blurShapeRadius = (w: number, h: number, value?: number) =>
  Math.min(Math.abs(w), Math.abs(h)) * 0.3 * (5 + 0.15 * Math.max(0, Math.min(100, value ?? BLUR_SHAPE_DEFAULT))) / 100;

/** 模糊之前那顆清楚的圖形長怎樣 —— 跟原本那顆實心圖形同一條路徑 */
export const blurShapeBaseD = (kind: string, w: number, h: number, pathD: (k: string, w: number, h: number) => string) => {
  const base = kind.slice('blur-'.length);
  if (base === 'cross-star') {
    // 跟「十字星」圖案一樣：直線四角星，內圈半徑 0.25
    const cx = w / 2, cy = h / 2, pts: string[] = [];
    for (let i = 0; i < 8; i++) {
      const t = -Math.PI / 2 + i * Math.PI / 4, k = i % 2 ? 0.25 : 1;
      pts.push(`${Math.round((cx + Math.cos(t) * cx * k) * 1000) / 1000} ${Math.round((cy + Math.sin(t) * cy * k) * 1000) / 1000}`);
    }
    return `M ${pts.join(' L ')} Z`;
  }
  return pathD(base, w, h);
};

/* 有紋理（點點、條紋…）時陰影只能畫單色，所以改成：先把圖形連同紋理畫到一張小畫布，
   用三次盒狀模糊（≈ 高斯）把像素糊開，再貼回去。結果依「外形＋紋理＋大小」快取，
   拖曳時不用每格重算。 */
const texturedCache = new Map<string, { canvas: HTMLCanvasElement; pad: number; k: number }>();
const boxBlur = (src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horizontal: boolean) => {
  const len = horizontal ? w : h, lines = horizontal ? h : w, step = horizontal ? 4 : w * 4, inv = 1 / (2 * r + 1);
  for (let l = 0; l < lines; l++) {
    const base = horizontal ? l * w * 4 : l * 4;
    for (let c = 0; c < 4; c++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += src[base + Math.min(len - 1, Math.max(0, i)) * step + c];
      for (let i = 0; i < len; i++) {
        dst[base + i * step + c] = acc * inv;
        acc += src[base + Math.min(len - 1, i + r + 1) * step + c] - src[base + Math.max(0, i - r) * step + c];
      }
    }
  }
};
const blurCanvas = (c: HTMLCanvasElement, sigma: number) => {
  const g = c.getContext('2d')!, img = g.getImageData(0, 0, c.width, c.height), d = img.data, n = d.length;
  let a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i += 4) { const al = d[i + 3] / 255; a[i] = d[i] * al; a[i + 1] = d[i + 1] * al; a[i + 2] = d[i + 2] * al; a[i + 3] = d[i + 3]; }
  const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2));
  for (let p = 0; p < 3; p++) { boxBlur(a, b, c.width, c.height, r, true); boxBlur(b, a, c.width, c.height, r, false); }
  for (let i = 0; i < n; i += 4) { const al = a[i + 3]; const m = al > 0 ? 255 / al : 0; d[i] = a[i] * m; d[i + 1] = a[i + 1] * m; d[i + 2] = a[i + 2] * m; d[i + 3] = al; }
  g.putImageData(img, 0, 0);
};
export const fillBlurredTextured = (
  ctx: CanvasRenderingContext2D, path: Path2D, color: string, radius: number, w: number, h: number,
  paintTexture: (ctx: CanvasRenderingContext2D, path: Path2D) => void, key: string,
) => {
  const m = ctx.getTransform();
  let k = Math.hypot(m.a, m.b) || 1;
  k = Math.min(k, 1400 / Math.max(1, Math.abs(w) + radius * 6), 1400 / Math.max(1, Math.abs(h) + radius * 6));
  const cacheKey = `${key}|${w.toFixed(1)}|${h.toFixed(1)}|${radius.toFixed(2)}|${k.toFixed(2)}|${color}`;
  let hit = texturedCache.get(cacheKey);
  if (!hit) {
    const pad = Math.ceil(radius * 3 * k) + 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(Math.abs(w) * k) + pad * 2; canvas.height = Math.ceil(Math.abs(h) * k) + pad * 2;
    const g = canvas.getContext('2d')!;
    g.setTransform(k, 0, 0, k, pad, pad);
    g.fillStyle = color; g.fill(path); paintTexture(g, path);
    blurCanvas(canvas, radius * k);
    hit = { canvas, pad, k };
    texturedCache.set(cacheKey, hit);
    if (texturedCache.size > 24) texturedCache.delete(texturedCache.keys().next().value!);
  }
  ctx.drawImage(hit.canvas, -hit.pad / hit.k, -hit.pad / hit.k, hit.canvas.width / hit.k, hit.canvas.height / hit.k);
};

/** 用陰影畫出模糊的實心圖形。radius 是圖形座標；會換算成目前縮放下的實際像素。 */
export const fillBlurredPath = (ctx: CanvasRenderingContext2D, path: Path2D, color: string, radius: number) => {
  if (radius <= 0.01) { ctx.fillStyle = color; ctx.fill(path); return; }
  const m = ctx.getTransform(), k = Math.hypot(m.a, m.b) || 1;
  const off = 20000 + Math.abs(m.e);
  ctx.save();
  ctx.setTransform(m.a, m.b, m.c, m.d, m.e + off, m.f);
  ctx.shadowColor = color;
  ctx.shadowBlur = radius * k * 2;   // shadowBlur ≈ 2σ
  ctx.shadowOffsetX = -off;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = color;
  ctx.fill(path);
  ctx.restore();
};
