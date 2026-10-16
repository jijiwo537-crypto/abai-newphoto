/* 「模糊」圖形：星星、圓角星星、愛心、圓形、十字星、方形的整顆高斯模糊版。
 *
 * 不是羽化：羽化是把邊緣往內變透明，圖形看起來會縮小一圈；
 * 這裡是像整張拍糊那樣，邊緣同時往外暈開、往內變淡，一半透明的地方剛好落在原本的邊上，
 * 所以看起來大小不變。
 *
 * 畫法：在一張小畫布上用三次盒狀模糊（≈ 高斯）糊一次再拉大貼上（見 drawBlurredShape）。
 * 不用 ctx.filter = 'blur()'：iPhone 的 Safari 對它支援不穩。 */
export const BLUR_SHAPE_KINDS = new Set(['blur-star', 'blur-star-rounded', 'blur-heart', 'blur-circle', 'blur-cross-star', 'blur-square', 'blur-sparkle4']);
export const isBlurShape = (kind?: string) => !!kind && BLUR_SHAPE_KINDS.has(kind);
/** 模糊滑桿的預設值（畫面上的 0～100）。圖案裡借來的模糊圖案也照這個值畫。 */
export const BLUR_SHAPE_DEFAULT = 50;
/** 每種模糊圖形自己的預設模糊值：模糊圓形預設糊到最滿（100），其他照 BLUR_SHAPE_DEFAULT。 */
/** 按鈕小圖與「圖案」裡模糊圖形的模糊程度：兩個星星、兩個十字星照滑桿 20 的樣子，
 *  其他（愛心、圓形）照預設。圖形本身的預設值不受影響（blurShapeDefault）。 */
const BLUR_LOOK_20 = new Set(['blur-star', 'blur-star-rounded', 'blur-cross-star', 'blur-sparkle4']);
export const blurLookValue = (kind?: string) => kind && BLUR_LOOK_20.has(kind) ? 20 : BLUR_SHAPE_DEFAULT;
export const blurShapeDefault = (kind?: string) => kind === 'blur-circle' ? 100 : BLUR_SHAPE_DEFAULT;

/** 模糊半徑（圖形自己的座標單位）。
 *  滑桿看起來是 0～100，實際對應最早那版滑桿的 5～23（＝改範圍之前那根滑桿的 0～120）：
 *  0 ＝ 一點點糊，100 ＝ 短邊的 6.9%。 */
export const blurShapeRadius = (w: number, h: number, value?: number) =>
  Math.min(Math.abs(w), Math.abs(h)) * 0.3 * (5 + 0.18 * Math.max(0, Math.min(100, value ?? BLUR_SHAPE_DEFAULT))) / 100;

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

/* 只糊透明度：模糊圖形整顆只有一個顏色，RGB 不用算，最後整張補上顏色就好（比四個通道一起糊快 4 倍）。 */
const boxBlurA = (src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horizontal: boolean) => {
  const len = horizontal ? w : h, lines = horizontal ? h : w, step = horizontal ? 1 : w, inv = 1 / (2 * r + 1);
  for (let l = 0; l < lines; l++) {
    const base = horizontal ? l * w : l;
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[base + Math.min(len - 1, Math.max(0, i)) * step];
    for (let i = 0; i < len; i++) {
      dst[base + i * step] = acc * inv;
      acc += src[base + Math.min(len - 1, i + r + 1) * step] - src[base + Math.max(0, i - r) * step];
    }
  }
};
export const blurAlpha = (c: HTMLCanvasElement, r: number, color: string) => {
  const g = c.getContext('2d')!, img = g.getImageData(0, 0, c.width, c.height), d = img.data, n = c.width * c.height;
  let a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = d[i * 4 + 3];
  for (let p = 0; p < 3; p++) { boxBlurA(a, b, c.width, c.height, r, true); boxBlurA(b, a, c.width, c.height, r, false); }
  for (let i = 0; i < n; i++) { d[i * 4] = 0; d[i * 4 + 1] = 0; d[i * 4 + 2] = 0; d[i * 4 + 3] = a[i]; }
  g.putImageData(img, 0, 0);
  // 透明度糊好了，再整張染成圖形的顏色
  g.setTransform(1, 0, 0, 1, 0, 0);   // source-in 會清掉蓋不到的地方，一定要整張蓋滿
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'source-over';
};
/* 同一顆（形狀、顏色、模糊值）已經糊好的那幾種長寬比 */
const blurFamilies = new Map<string, Map<number, string>>();
const nearestBlur = (fam: string, aspect: number) => {
  const fa = blurFamilies.get(fam);
  if (!fa) return null;
  let best: string | null = null, bd = Infinity;
  fa.forEach((key, a) => {
    if (!blurredCache.has(key)) { fa.delete(a); return; }
    const d = Math.abs(Math.log(a / aspect));
    if (d < bd) { bd = d; best = key; }
  });
  // 差太多（拖很快一下跨了好幾格）就不拿來頂，直接當場糊正確的那張，免得畫面上留著拉歪的模糊
  return best ? blurredCache.get(best) ?? null : null;
};
let scratch: CanvasRenderingContext2D | null = null;
let forceBlurBuild = false;
const scratchCtx = () => scratch ??= document.createElement('canvas').getContext('2d')!;
const blurQueue = new Map<string, () => void>();
const blurListeners = new Set<() => void>();
/** 背景糊好一張新的之後要重畫畫面（兩個工具各自註冊；回傳取消註冊） */
export const setBlurRebuildListener = (f: (() => void) | null) => { if (f) blurListeners.add(f); return () => { if (f) blurListeners.delete(f); }; };
let blurTimer: ReturnType<typeof setTimeout> | null = null;
/* 擠壓中完全不重糊：每一格都只是把手上已經糊好的那張照新的長寬拉伸貼上。
   手停下來 0.2 秒（不再有新的長寬比進來）才糊一次正確的那張，糊好通知畫面重畫。 */
const queueBlurBuild = (key: string, build: () => void) => {
  if (blurredCache.has(key)) return;
  blurQueue.clear();
  blurQueue.set(key, build);
  if (blurTimer) clearTimeout(blurTimer);
  blurTimer = setTimeout(() => {
    blurTimer = null;
    const next = blurQueue.entries().next().value as [string, () => void] | undefined;
    blurQueue.clear();
    if (!next) return;
    try { next[1](); } catch { /* 下次再糊 */ }
    blurListeners.forEach(f => { try { f(); } catch { /* 忽略 */ } });
  }, 200);
};
/* 拖滑桿不會一格一格跳：盒狀模糊的半徑只能是整數像素，以前光柵大小固定、半徑跟著滑桿變，
   半徑一取整數，糊的程度就一階一階地跳。現在反過來 —— 盒狀半徑固定（BOX_R 像素），
   改成讓「光柵有多大」跟著模糊值連續變化：糊得越多，光柵越小（也越快算）。 */
const BOX_R = 5, BOX_SIGMA = Math.sqrt(BOX_R * (BOX_R + 1));   // 三次盒狀模糊 ≈ 這個 σ 的高斯
const blurredCache = new Map<string, { canvas: HTMLCanvasElement; img?: ImageBitmap; pad: number; scale: number; sh: number }>();
export const drawBlurredShape = (
  ctx: CanvasRenderingContext2D, kind: string, w: number, h: number, color: string, value: number | undefined,
  pathD: (k: string, w: number, h: number) => string,
) => {
  const aw = Math.abs(w), ah = Math.abs(h);
  if (aw < 0.5 || ah < 0.5) return;
  /* 長寬比照「對數」分格（每格約 6%），擠壓時只在跨格的那一下才重糊一次，
     格子裡面就把同一張糊好的圖照實際長寬拉伸貼上 —— 壓得很扁也不會每一格都重算。
     （以前是 0.01 一格：長寬比 10 的時候幾乎每動一下就要重糊一張大圖） */
  const ra = aw / ah, aspect = Math.exp(Math.round(Math.log(ra) / 0.06) * 0.06);
  const v = Math.max(0, Math.min(100, value ?? blurShapeDefault(kind)));
  const key = `${kind}|${aspect.toFixed(4)}|${color}|${Math.round(v * 10) / 10}`;
  let hit = blurredCache.get(key);
  /* 擠壓中（已經有同一顆、別的長寬比糊好的圖）：這一格先拿最接近的那張拉伸貼上，
     正確的那張排到下一個空檔再糊，糊好通知畫面重畫一次 —— 拖的那一格不用等。 */
  const fam = `${kind}|${color}|${Math.round(v * 10) / 10}`;
  if (!hit) {
    const near = nearestBlur(fam, aspect);
    if (near && !forceBlurBuild) { queueBlurBuild(key, () => { forceBlurBuild = true; try { drawBlurredShape(scratchCtx(), kind, w, h, color, value, pathD); } finally { forceBlurBuild = false; } }); hit = near; }
  }
  if (!hit) {
    // 光柵大小跟著模糊值連續變化（見上面 BOX_R 的說明），長邊最多 768px
    let short = BOX_SIGMA / Math.max(1e-6, blurShapeRadius(1, 1, v));
    short = Math.min(short, 512 / Math.max(aspect, 1 / aspect));
    const rw = aspect >= 1 ? short * aspect : short, rh = aspect >= 1 ? short : short / aspect;
    const radius = blurShapeRadius(rw, rh, v);
    const r = Math.max(1, Math.round((Math.sqrt(4 * radius * radius + 1) - 1) / 2));
    const pad = Math.ceil(radius * 3) + 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(rw + pad * 2); canvas.height = Math.ceil(rh + pad * 2);
    const g = canvas.getContext('2d')!;
    g.translate(pad, pad);
    g.fillStyle = '#000';
    g.fill(new Path2D(pathD(kind, rw, rh)));
    blurAlpha(canvas, r, color);
    const entry: { canvas: HTMLCanvasElement; img?: ImageBitmap; pad: number; scale: number; sh: number } = { canvas, pad, scale: rw, sh: rh };
    hit = entry;
    blurredCache.set(key, entry);
    let fa = blurFamilies.get(fam);
    if (!fa) { fa = new Map(); blurFamilies.set(fam, fa); }
    fa.set(aspect, key);
    // 轉成 ImageBitmap 讓它留在顯示卡上，之後每格貼圖不用再從記憶體搬一次
    if (typeof createImageBitmap === 'function') void createImageBitmap(canvas).then(bm => { entry.img = bm; }).catch(() => {});
    if (blurredCache.size > 48) { const old = blurredCache.keys().next().value!; blurredCache.get(old)?.img?.close(); blurredCache.delete(old); }
  }
  // 光柵像素 → 圖形座標；橫、直各自算，同一格裡的長寬比差一點點就照實際拉伸
  const kx = aw / hit.scale, ky = ah / hit.sh;
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(hit.img ?? hit.canvas, -hit.pad * kx, -hit.pad * ky, hit.canvas.width * kx, hit.canvas.height * ky);
  ctx.imageSmoothingEnabled = prev;
};
