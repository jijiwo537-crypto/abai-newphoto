/* 中性灰磨皮（Dodge & Burn，加深減淡）
 *
 * 修圖師的做法：開一層 50% 中性灰（柔光），用很淡的白筆把皮膚上「比周圍暗」的小區塊提亮、
 * 黑筆把「比周圍亮」的壓暗。痘印、斑、凹凸、暗沉其實都是局部亮度不均，把它修平皮膚就乾淨了；
 * 因為完全不模糊，毛孔與細紋理一個像素都不動 —— 這是它跟一般磨皮（模糊）最大的差別。
 *
 * 一鍵自動 —— 把修圖師用眼睛找不均的工作交給頻帶分析：
 *   1. 亮度轉成對數（亮暗的「比例」差才是人眼看到的不均，同樣 +10 在暗部比亮部明顯得多）。
 *   2. 拆三層：細節層（< 毛孔尺度，完全保留）、中頻層（痘印、斑、凹凸、暗沉 —— 要修的就是這層）、
 *      大結構層（臉的立體明暗、輪廓陰影，完全保留，臉才不會變平）。尺度全部跟著「臉的寬度」走，
 *      照片大小、臉遠臉近結果都一致。
 *   3. 中頻層取反當作「中性灰圖層」：暗的地方提亮、亮的地方壓暗，強度＝滑桿。
 *      特別強的起伏（髮絲、鏡框、睫毛殘影）用柔性上限擋住，不會修出灰色光暈。
 *   4. 只在皮膚上做：臉部 478 點畫出的皮膚範圍（挖掉眼睛、眉毛、嘴唇、鼻孔，柔邊）× 膚色判斷
 *      （鬍子、頭髮、背景不在膚色範圍）。找不到臉時退回只用膚色判斷，而且更保守。
 *   5. 色彩不均（泛紅、斑的色素）在同一個中頻帶裡也修掉一部分 —— 像修圖師另外用的「色彩均勻」那一步。
 *
 * 手動筆刷 —— 跟 Photoshop 的低流量加深減淡筆一樣：每一下只加一點點，同一筆裡越刷越多（累積），
 * 只改亮度不改色相；筆刷柔邊。 */

import { drawSkinMask, type MaskBufs } from '../faceSkinDraw';

export type Rect = { x: number; y: number; w: number; h: number };

const clampI = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

function boxH(s: Float32Array, d: Float32Array, w: number, h: number, r: number) {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += s[o + clampI(i, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      d[o + x] = sum * inv;
      sum += s[o + (x + r + 1 < w ? x + r + 1 : w - 1)] - s[o + (x - r > 0 ? x - r : 0)];
    }
  }
}
function boxV(s: Float32Array, d: Float32Array, w: number, h: number, r: number) {
  const inv = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += s[clampI(i, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      d[y * w + x] = sum * inv;
      sum += s[(y + r + 1 < h ? y + r + 1 : h - 1) * w + x] - s[(y - r > 0 ? y - r : 0) * w + x];
    }
  }
}
/** 三趟方塊模糊 ≈ 高斯（σ ≈ r），結果寫回 a */
function gauss(a: Float32Array, t: Float32Array, w: number, h: number, r: number) {
  if (r < 1) return;
  for (let k = 0; k < 3; k++) { boxH(a, t, w, h, r); boxV(t, a, w, h, r); }
}
/** 大半徑：縮小 f 倍算、再雙線性放大回來（結果跟全解析度算幾乎一樣，快 f² 倍） */
function gaussLarge(src: Float32Array, out: Float32Array, W: number, H: number, sigma: number) {
  const f = Math.max(1, Math.floor(sigma / 6));
  if (f === 1) { out.set(src); gauss(out, new Float32Array(W * H), W, H, Math.round(sigma)); return; }
  const w = Math.ceil(W / f), h = Math.ceil(H / f);
  const lo = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let yy = y * f, ye = Math.min(H, yy + f); yy < ye; yy++) for (let xx = x * f, xe = Math.min(W, xx + f); xx < xe; xx++) { s += src[yy * W + xx]; n++; }
    lo[y * w + x] = s / n;
  }
  gauss(lo, new Float32Array(w * h), w, h, Math.max(1, Math.round(sigma / f)));
  for (let y = 0; y < H; y++) {
    const fy = (y + 0.5) / f - 0.5, ya = clampI(Math.floor(fy), 0, h - 1), yb = clampI(ya + 1, 0, h - 1), ty = clampI(fy - ya, 0, 1);
    for (let x = 0; x < W; x++) {
      const fx = (x + 0.5) / f - 0.5, xa = clampI(Math.floor(fx), 0, w - 1), xb = clampI(xa + 1, 0, w - 1), tx = clampI(fx - xa, 0, 1);
      out[y * W + x] = (lo[ya * w + xa] * (1 - tx) + lo[ya * w + xb] * tx) * (1 - ty) + (lo[yb * w + xa] * (1 - tx) + lo[yb * w + xb] * tx) * ty;
    }
  }
}

/** 膚色可能性（YCbCr，邊界是柔的）：0～1 */
function skinLikelihood(r: number, g: number, b: number) {
  const Y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = (b - Y) * 0.564 + 128, cr = (r - Y) * 0.713 + 128;
  const ss = (e0: number, e1: number, x: number) => { const t = clampI((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  return ss(133, 141, cr) * (1 - ss(172, 182, cr)) * ss(77, 85, cb) * (1 - ss(124, 134, cb)) * ss(22, 48, Y) * (1 - ss(248, 255, Y) * 0.6);
}

/** 分析結果：跟強度無關的部分先算好，拖強度滑桿時只剩一次逐像素套用（幾十毫秒） */
export interface DBAnalysis {
  /** 分析用的尺寸（大照片會縮到長邊 2048 再分析：修正量本身是平滑的中頻，放大回原尺寸套用沒有差別，記憶體省很多） */
  W: number; H: number;
  /** 中頻層（對數亮度）× 皮膚權重 × 柔性上限：直接就是「強度 100 時要減掉的量」 */
  corrY: Float32Array;
  /** 色彩不均（Cb、Cr 的中頻）× 皮膚權重 */
  corrCb: Float32Array; corrCr: Float32Array;
  faces: number;
}

/** 皮膚範圍：臉部點畫出的遮罩（挖掉五官、柔邊）× 膚色。沒有臉時只用膚色（打七折，保守） */
function skinWeight(src: Uint8ClampedArray, W: number, H: number, faces: number[][]): Float32Array {
  const n = W * H, wgt = new Float32Array(n);
  if (faces.length) {
    const k = Math.min(1, 1024 / Math.max(W, H));
    const mw = Math.max(16, Math.round(W * k)), mh = Math.max(16, Math.round(H * k));
    const c = document.createElement('canvas'); c.width = mw; c.height = mh;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    const bufs: MaskBufs = { a: null, t: null };
    drawSkinMask(g, mw, mh, faces, W, H, bufs);
    const m = g.getImageData(0, 0, mw, mh).data;
    for (let y = 0; y < H; y++) {
      const fy = (y + 0.5) * mh / H - 0.5, ya = clampI(Math.floor(fy), 0, mh - 1), yb = clampI(ya + 1, 0, mh - 1), ty = clampI(fy - ya, 0, 1);
      for (let x = 0; x < W; x++) {
        const fx = (x + 0.5) * mw / W - 0.5, xa = clampI(Math.floor(fx), 0, mw - 1), xb = clampI(xa + 1, 0, mw - 1), tx = clampI(fx - xa, 0, 1);
        const v = (m[(ya * mw + xa) * 4] * (1 - tx) + m[(ya * mw + xb) * 4] * tx) * (1 - ty) + (m[(yb * mw + xa) * 4] * (1 - tx) + m[(yb * mw + xb) * 4] * tx) * ty;
        wgt[y * W + x] = v / 255;
      }
    }
  } else wgt.fill(0.7);
  // 膚色：先輕微平滑（單一像素的雜訊不要讓權重跳動），再乘上去
  const sk = new Float32Array(n);
  for (let i = 0, o = 0; i < n; i++, o += 4) sk[i] = wgt[i] > 0.002 ? skinLikelihood(src[o], src[o + 1], src[o + 2]) : 0;
  gauss(sk, new Float32Array(n), W, H, Math.max(1, Math.round(Math.max(W, H) / 900)));
  for (let i = 0; i < n; i++) wgt[i] *= faces.length ? 0.25 + 0.75 * sk[i] : sk[i];
  return wgt;
}

/** 臉的寬度（像素）：所有臉裡最大的那張；沒有臉就用短邊的三成 */
function faceWidth(faces: number[][], W: number, H: number) {
  let fw = 0;
  for (const f of faces) fw = Math.max(fw, Math.hypot((f[234 * 2] - f[454 * 2]) * W, (f[234 * 2 + 1] - f[454 * 2 + 1]) * H));
  return fw > 8 ? fw : Math.min(W, H) * 0.3;
}

const ANALYZE_LONG = 2048;
export function analyzeDodgeBurn(src0: Uint8ClampedArray, W0: number, H0: number, faces: number[][]): DBAnalysis {
  let src = src0, W = W0, H = H0;
  if (Math.max(W0, H0) > ANALYZE_LONG) {
    const k = ANALYZE_LONG / Math.max(W0, H0);
    W = Math.round(W0 * k); H = Math.round(H0 * k);
    const a = document.createElement('canvas'); a.width = W0; a.height = H0;
    a.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(src0.buffer, src0.byteOffset, W0 * H0 * 4), W0, H0), 0, 0);
    const b = document.createElement('canvas'); b.width = W; b.height = H;
    const g = b.getContext('2d', { willReadFrequently: true })!; g.imageSmoothingQuality = 'high'; g.drawImage(a, 0, 0, W, H);
    src = g.getImageData(0, 0, W, H).data; a.width = a.height = 0;
  }
  const n = W * H;
  const fw = faceWidth(faces, W, H);
  /* 尺度（跟著臉寬）：
     σs＝臉寬 0.6%：比這小的是毛孔、細紋理 → 保留；
     σl＝臉寬 6%：比這大的是臉的立體明暗 → 保留；中間那段就是要修平的不均 */
  const sS = Math.max(1, Math.round(fw * 0.006)), sL = Math.max(sS * 3, fw * 0.06);
  const lY = new Float32Array(n), Cb = new Float32Array(n), Cr = new Float32Array(n);
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const r = src[o], g = src[o + 1], b = src[o + 2];
    const Y = 0.299 * r + 0.587 * g + 0.114 * b;
    lY[i] = Math.log(Y + 2);
    Cb[i] = (b - Y) * 0.564; Cr[i] = (r - Y) * 0.713;
  }
  const w = skinWeight(src, W, H, faces);
  const tmp = new Float32Array(n), lo = new Float32Array(n);
  const band = (ch: Float32Array) => {
    const s = new Float32Array(ch); gauss(s, tmp, W, H, sS);
    gaussLarge(ch, lo, W, H, sL);
    for (let i = 0; i < n; i++) s[i] -= lo[i];
    return s;
  };
  const corrY = band(lY), corrCb = band(Cb), corrCr = band(Cr);
  /* 柔性上限：中頻起伏超過約 ±0.45（對數，約 1.6 倍亮度差）多半不是皮膚不均（髮絲、鏡框、睫毛），
     修它會修出灰暈；用 x/(1+(x/τ)²) 讓小的照修、大的漸漸不修 */
  const tau = 0.45;
  for (let i = 0; i < n; i++) {
    const m = corrY[i], k = 1 / (1 + (m / tau) * (m / tau));
    corrY[i] = m * k * w[i];
    corrCb[i] *= w[i] * k; corrCr[i] *= w[i] * k;
  }
  return { W, H, corrY, corrCb, corrCr, faces: faces.length };
}

/** 套用自動中性灰：dst ＝ src 修掉中頻不均；strength 0～1 */
export function applyDodgeBurnAuto(dst: Uint8ClampedArray, src: Uint8ClampedArray, an: DBAnalysis, strength: number, outW = an.W, outH = an.H) {
  const n = outW * outH;
  // 分析尺寸跟輸出不同（大照片）：修正量雙線性放大到輸出尺寸
  const up = outW !== an.W || outH !== an.H;
  const samp = (m: Float32Array, i: number) => {
    if (!up) return m[i];
    const x = i % outW, y = (i / outW) | 0;
    const fx = (x + 0.5) * an.W / outW - 0.5, fy = (y + 0.5) * an.H / outH - 0.5;
    const xa = clampI(Math.floor(fx), 0, an.W - 1), xb = clampI(xa + 1, 0, an.W - 1), ya = clampI(Math.floor(fy), 0, an.H - 1), yb = clampI(ya + 1, 0, an.H - 1);
    const tx = clampI(fx - xa, 0, 1), ty = clampI(fy - ya, 0, 1);
    return (m[ya * an.W + xa] * (1 - tx) + m[ya * an.W + xb] * tx) * (1 - ty) + (m[yb * an.W + xa] * (1 - tx) + m[yb * an.W + xb] * tx) * ty;
  };
  // 100% 時修掉 85% 的中頻不均（全修會顯得扁平、失去立體）；色彩不均最多修四成五（再多膚色會變灰）
  const sy = clampI(strength, 0, 1) * 0.85, sc = clampI(strength, 0, 1) * 0.45;
  const { corrY, corrCb, corrCr } = an;
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const cy = samp(corrY, i), ccb = samp(corrCb, i), ccr = samp(corrCr, i);
    if (cy === 0 && ccb === 0) { dst[o] = src[o]; dst[o + 1] = src[o + 1]; dst[o + 2] = src[o + 2]; dst[o + 3] = src[o + 3]; continue; }
    const r = src[o], g = src[o + 1], b = src[o + 2];
    const Y = 0.299 * r + 0.587 * g + 0.114 * b;
    const ratio = Math.exp(-cy * sy);
    const Y2 = (Y + 2) * ratio - 2;
    const cb = (b - Y) * 0.564 * ratio - ccb * sc, cr = (r - Y) * 0.713 * ratio - ccr * sc;
    dst[o] = Y2 + 1.402 * cr;
    dst[o + 1] = Y2 - 0.344136 * cb - 0.714136 * cr;
    dst[o + 2] = Y2 + 1.772 * cb;
    dst[o + 3] = src[o + 3];
  }
}

/* ── 手動筆刷 ── */

/** 一筆的累積場（對數亮度的加減量），同一筆裡越刷越多 */
export class DBStroke {
  acc: Float32Array;
  constructor(public W: number, public H: number) { this.acc = new Float32Array(W * H); }
  /** 蓋一下：sign＝+1 提亮、−1 壓暗；flow＝每一下的量（0～1）。回傳改到的範圍 */
  dab(dst: Uint8ClampedArray, src: Uint8ClampedArray, cx: number, cy: number, R: number, flow: number, sign: number): Rect | null {
    const W = this.W, H = this.H;
    const x0 = Math.max(0, Math.floor(cx - R)), y0 = Math.max(0, Math.floor(cy - R));
    const x1 = Math.min(W - 1, Math.ceil(cx + R)), y1 = Math.min(H - 1, Math.ceil(cy + R));
    if (x1 < x0 || y1 < y0) return null;
    const inv = 1 / (R * R), a = flow * 0.06 * sign, acc = this.acc;
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, t = (dx * dx + dy * dy) * inv;
        if (t >= 1) continue;
        const f = (1 - t) * (1 - t);                    // 柔邊
        const i = y * W + x;
        const v = clampI(acc[i] + a * f, -0.9, 0.9);   // 最多約 ±2.5 倍亮度
        acc[i] = v;
        const o = i * 4, r = src[o], g = src[o + 1], b = src[o + 2];
        const Y = 0.299 * r + 0.587 * g + 0.114 * b;
        // 只改亮度、不改色相：亮度乘上比例，色度跟著等比（跟柔光中性灰的效果一樣）
        const ratio = Math.exp(v), Y2 = (Y + 2) * ratio - 2;
        const cb = (b - Y) * 0.564 * ratio, cr = (r - Y) * 0.713 * ratio;
        dst[o] = Y2 + 1.402 * cr; dst[o + 1] = Y2 - 0.344136 * cb - 0.714136 * cr; dst[o + 2] = Y2 + 1.772 * cb;
      }
    }
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
}

/** 觀察層：黑白 ＋ 大幅拉高中間調對比，明暗不均一眼就看得到（修圖師開著它刷，看的是這一層） */
export function observeView(src: Uint8ClampedArray, out: Uint8ClampedArray, n: number, mid: number) {
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const Y = (0.299 * src[o] + 0.587 * src[o + 1] + 0.114 * src[o + 2]) / 255;
    // 以臉上皮膚的中間亮度為中心拉 2.6 倍，再用 S 曲線收邊，不會整片死白死黑
    const t = clampI(0.5 + (Y - mid) * 2.6, 0, 1), v = t * t * (3 - 2 * t) * 255;
    out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = 255;
  }
}

/** 觀察層的中心亮度：皮膚（膚色像素）亮度的中位數 */
export function skinMidLuma(src: Uint8ClampedArray, W: number, H: number, faces: number[][] = []) {
  const hist = new Uint32Array(256); let cnt = 0;
  // 有臉的話只看臉的範圍（不然紅色窗簾、木頭家具這些「像膚色」的東西會把中心拉走）
  let x0 = 0, y0 = 0, x1 = W, y1 = H;
  if (faces.length) {
    x0 = W; y0 = H; x1 = 0; y1 = 0;
    for (const f of faces) for (let i = 0; i < f.length; i += 2) { x0 = Math.min(x0, f[i] * W); x1 = Math.max(x1, f[i] * W); y0 = Math.min(y0, f[i + 1] * H); y1 = Math.max(y1, f[i + 1] * H); }
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
  }
  const step = Math.max(1, Math.floor(Math.sqrt((x1 - x0) * (y1 - y0) / 200000)));
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
    const o = (y * W + x) * 4, r = src[o], g = src[o + 1], b = src[o + 2];
    if (skinLikelihood(r, g, b) < 0.5) continue;
    hist[Math.round(0.299 * r + 0.587 * g + 0.114 * b)]++; cnt++;
  }
  if (cnt < 50) return 0.5;
  let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= cnt / 2) return v / 255; }
  return 0.5;
}
