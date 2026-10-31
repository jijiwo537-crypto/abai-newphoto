/* 原尺寸存檔（超過手機畫布上限的大照片，例如 48MP）
 *
 * iPhone 的 Safari 單張畫布最多約 1677 萬像素，48MP 照片（約 4900 萬）放不進任何一張畫布，
 * 以前一存檔就畫布空白、記憶體爆掉閃退。這裡的做法跟 Google HDR+ 等專業管線處理大圖的方式一樣
 * （導向上採樣，guided upsampling）：
 *
 *   1. 整條效果管線照原本的方式，在手機能處理的最大尺寸（1600 萬像素）上算一次 —— 效果邏輯完全不動。
 *   2. 每一小塊區域學一個「原圖 → 成品」的局部線性關係（成品 ≈ a × 原圖 ＋ b，每個色彩通道各一組，
 *      就是導向濾波 guided filter 的公式），再加上這個關係解釋不了的殘差（顆粒、雜訊這類加上去的紋理）。
 *   3. 一條一條（每條幾十列）讀出「真正的原尺寸原圖」，套上那個局部關係＋殘差：
 *      原圖本身的細節完全是原尺寸的，效果（調色、濾鏡、光暈、暗角…）跟縮小算的一致。
 *   4. 一條一條直接送進背景執行緒的編碼器（JPEG 品質 100、色彩不降取樣，或無損 PNG），
 *      整張圖從頭到尾都不需要放進一張畫布，所以不會閃退。 */

export interface StripSource {
  /** 原尺寸成品的寬高 */
  W: number; H: number;
  /** 把原尺寸原圖第 y0 列起的 h 列畫進 ctx（ctx 大小是 W×h） */
  drawStrip(ctx: CanvasRenderingContext2D, y0: number, h: number): void;
}

const clampI = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

function boxMean(src: Float32Array, w: number, h: number, r: number, tmp: Float32Array, out: Float32Array) {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const o = y * w; let s = 0;
    for (let i = -r; i <= r; i++) s += src[o + clampI(i, 0, w - 1)];
    for (let x = 0; x < w; x++) { tmp[o + x] = s * inv; s += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)]; }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += tmp[clampI(i, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = s * inv; s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; }
  }
}

/** 局部關係：每個通道的 a、b（在 1/2 尺寸的格子上，平滑的）＋ 殘差（成品尺寸，Int8） */
interface Transfer { gw: number; gh: number; a: Float32Array[]; b: Float32Array[]; res: Int8Array; pw: number; ph: number; }

/** P＝成品（縮小尺寸算出來的），D＝同尺寸的原圖；兩者都是 RGBA */
export function buildTransfer(P: Uint8ClampedArray, D: Uint8ClampedArray, pw: number, ph: number): Transfer {
  const gw = Math.max(1, Math.ceil(pw / 2)), gh = Math.max(1, Math.ceil(ph / 2)), gn = gw * gh;
  const r = 2, eps = 16;   // 5×5 鄰域；eps 讓平坦的地方不會亂學出很大的增益
  const a: Float32Array[] = [], b: Float32Array[] = [];
  const Dg = new Float32Array(gn), Pg = new Float32Array(gn), DD = new Float32Array(gn), DP = new Float32Array(gn);
  const mD = new Float32Array(gn), mP = new Float32Array(gn), mDD = new Float32Array(gn), mDP = new Float32Array(gn), tmp = new Float32Array(gn);
  for (let c = 0; c < 3; c++) {
    // 2×2 平均到格子上
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      let sd = 0, sp = 0, n = 0;
      for (let yy = gy * 2; yy < Math.min(ph, gy * 2 + 2); yy++) for (let xx = gx * 2; xx < Math.min(pw, gx * 2 + 2); xx++) {
        const o = (yy * pw + xx) * 4 + c; sd += D[o]; sp += P[o]; n++;
      }
      const i = gy * gw + gx; Dg[i] = sd / n; Pg[i] = sp / n; DD[i] = Dg[i] * Dg[i]; DP[i] = Dg[i] * Pg[i];
    }
    boxMean(Dg, gw, gh, r, tmp, mD); boxMean(Pg, gw, gh, r, tmp, mP); boxMean(DD, gw, gh, r, tmp, mDD); boxMean(DP, gw, gh, r, tmp, mDP);
    const A = new Float32Array(gn), B = new Float32Array(gn);
    for (let i = 0; i < gn; i++) {
      const v = mDD[i] - mD[i] * mD[i], cv = mDP[i] - mD[i] * mP[i];
      const ai = clampI(cv / (v + eps), 0, 4);
      A[i] = ai; B[i] = mP[i] - ai * mD[i];
    }
    // 導向濾波的第二步：a、b 再平均一次，關係在空間上平滑
    boxMean(A, gw, gh, r, tmp, mD); boxMean(B, gw, gh, r, tmp, mP);
    a.push(new Float32Array(mD)); b.push(new Float32Array(mP));
  }
  // 殘差：成品 −（a×原圖＋b），在成品尺寸上
  const res = new Int8Array(pw * ph * 3);
  for (let y = 0; y < ph; y++) {
    const fy = (y + 0.5) / 2 - 0.5, ya = clampI(Math.floor(fy), 0, gh - 1), yb = clampI(ya + 1, 0, gh - 1), ty = clampI(fy - ya, 0, 1);
    for (let x = 0; x < pw; x++) {
      const fx = (x + 0.5) / 2 - 0.5, xa = clampI(Math.floor(fx), 0, gw - 1), xb = clampI(xa + 1, 0, gw - 1), tx = clampI(fx - xa, 0, 1);
      const i00 = ya * gw + xa, i10 = ya * gw + xb, i01 = yb * gw + xa, i11 = yb * gw + xb;
      const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
      const o = (y * pw + x) * 4;
      for (let c = 0; c < 3; c++) {
        const A = a[c], B = b[c];
        const av = A[i00] * w00 + A[i10] * w10 + A[i01] * w01 + A[i11] * w11, bv = B[i00] * w00 + B[i10] * w10 + B[i01] * w01 + B[i11] * w11;
        res[(y * pw + x) * 3 + c] = clampI(Math.round(P[o + c] - (av * D[o + c] + bv)), -127, 127);
      }
    }
  }
  return { gw, gh, a, b, res, pw, ph };
}

/** 把局部關係套到原尺寸的一條（rows 列，從 y0 開始），就地改寫 RGBA */
function applyStrip(T: Transfer, O: Uint8ClampedArray, W: number, H: number, y0: number, rows: number) {
  const { gw, gh, a, b, res, pw, ph } = T;
  const kx = pw / W, ky = ph / H;
  for (let yy = 0; yy < rows; yy++) {
    const y = y0 + yy;
    const py = (y + 0.5) * ky - 0.5, pya = clampI(Math.floor(py), 0, ph - 1), pyb = clampI(pya + 1, 0, ph - 1), pty = clampI(py - pya, 0, 1);
    const gyf = (py + 0.5) / 2 - 0.5, gya = clampI(Math.floor(gyf), 0, gh - 1), gyb = clampI(gya + 1, 0, gh - 1), gty = clampI(gyf - gya, 0, 1);
    for (let x = 0; x < W; x++) {
      const px = (x + 0.5) * kx - 0.5, pxa = clampI(Math.floor(px), 0, pw - 1), pxb = clampI(pxa + 1, 0, pw - 1), ptx = clampI(px - pxa, 0, 1);
      const gxf = (px + 0.5) / 2 - 0.5, gxa = clampI(Math.floor(gxf), 0, gw - 1), gxb = clampI(gxa + 1, 0, gw - 1), gtx = clampI(gxf - gxa, 0, 1);
      const g00 = gya * gw + gxa, g10 = gya * gw + gxb, g01 = gyb * gw + gxa, g11 = gyb * gw + gxb;
      const v00 = (1 - gtx) * (1 - gty), v10 = gtx * (1 - gty), v01 = (1 - gtx) * gty, v11 = gtx * gty;
      const r00 = (pya * pw + pxa) * 3, r10 = (pya * pw + pxb) * 3, r01 = (pyb * pw + pxa) * 3, r11 = (pyb * pw + pxb) * 3;
      const u00 = (1 - ptx) * (1 - pty), u10 = ptx * (1 - pty), u01 = (1 - ptx) * pty, u11 = ptx * pty;
      const o = (yy * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const A = a[c], B = b[c];
        const av = A[g00] * v00 + A[g10] * v10 + A[g01] * v01 + A[g11] * v11;
        const bv = B[g00] * v00 + B[g10] * v10 + B[g01] * v01 + B[g11] * v11;
        const rv = res[r00 + c] * u00 + res[r10 + c] * u10 + res[r01 + c] * u01 + res[r11 + c] * u11;
        O[o + c] = av * O[o + c] + bv + rv;
      }
      O[o + 3] = 255;
    }
  }
}

/** 一條一條讀原圖、套關係、送去編碼，回傳成品的 blob 網址 */
export async function exportFullRes(src: StripSource, T: Transfer, type: 'image/jpeg' | 'image/png'): Promise<string | null> {
  const { W, H } = src;
  const worker = new Worker(new URL('./stripEncoder.worker.ts', import.meta.url), { type: 'module' });
  try {
    const done = new Promise<Blob>((res, rej) => {
      worker.onmessage = e => { if (e.data?.type === 'done') res(e.data.blob); else if (e.data?.type === 'error') rej(new Error(e.data.error)); };
      worker.onerror = e => rej(e);
    });
    worker.postMessage({ type: 'start', fmt: type === 'image/png' ? 'png' : 'jpeg', w: W, h: H, quality: 100 });
    const STRIP = Math.max(8, Math.min(256, Math.floor(2_000_000 / W) & ~7));   // 每條約 200 萬像素以內
    const c = document.createElement('canvas'); c.width = W; c.height = STRIP;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.imageSmoothingQuality = 'high';
    for (let y0 = 0; y0 < H; y0 += STRIP) {
      const rows = Math.min(STRIP, H - y0);
      g.clearRect(0, 0, W, STRIP);
      src.drawStrip(g, y0, rows);
      const d = g.getImageData(0, 0, W, rows).data;
      applyStrip(T, d, W, H, y0, rows);
      worker.postMessage({ type: 'rows', data: d.buffer, rows }, [d.buffer]);
      // 讓出主執行緒：轉圈動畫、介面不會整個凍住
      await new Promise(r => setTimeout(r, 0));
    }
    c.width = c.height = 0;
    worker.postMessage({ type: 'end' });
    const blob = await done;
    return URL.createObjectURL(blob);
  } catch (e) {
    console.error('full-res export failed', e);
    return null;
  } finally { worker.terminate(); }
}

/** 從一張「縮小尺寸算好的成品畫布」＋同尺寸原圖，做出原尺寸成品（工具共用） */
export async function fullResFromProcessed(img: CanvasImageSource & { width: number; height: number }, P: Uint8ClampedArray, D: Uint8ClampedArray,
  pw: number, ph: number, type: 'image/jpeg' | 'image/png' = 'image/png'): Promise<string | null> {
  const W = (img as HTMLImageElement).naturalWidth || img.width, H = (img as HTMLImageElement).naturalHeight || img.height;
  const T = buildTransfer(P, D, pw, ph);
  return exportFullRes({ W, H, drawStrip: (ctx, y0, h) => ctx.drawImage(img, 0, y0, W, h, 0, 0, W, h) }, T, type);
}

/** 同尺寸的原圖像素（給 fullResFromProcessed 用） */
export function originalAt(img: CanvasImageSource, w: number, h: number): Uint8ClampedArray {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!; g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data; c.width = c.height = 0;
  return d;
}
