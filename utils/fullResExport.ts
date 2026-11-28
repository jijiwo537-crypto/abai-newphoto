import { canvasToUrl } from './blobUrl';
/* 原尺寸存檔（超過手機畫布上限的大照片，例如 48MP）
 *
 * iPhone 的 Safari 單張畫布最多約 1677 萬像素，48MP 照片（約 4900 萬）放不進任何一張畫布，
 * 不這樣做的話一存檔就畫布空白、記憶體爆掉閃退。這裡的做法跟 Google HDR+ 等專業管線處理大圖的方式一樣
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

/** 局部關係：每個通道的 a、b（在 1/2 尺寸的格子上，平滑的）＋ 殘差（成品尺寸，Int8）。
 *  不一次算完整張：存檔是由上往下一條一條做的，用到哪一段才算哪一段（每段 BAND 列格子），
 *  用過的段就丟掉。算法、分段的位置都跟以前整張先算好完全一樣，所以成品逐位元相同；
 *  只是同時只留兩三段在記憶體裡（1600 萬像素的工作尺寸：以前 a、b、殘差整張約 150MB，現在約 10MB）。 */
export interface Transfer {
  gw: number; gh: number; pw: number; ph: number;
  /** 第 c 通道、格子第 gy 列的 a／b（長度 gw） */
  aRow(c: number, gy: number): Float32Array; bRow(c: number, gy: number): Float32Array;
  /** 成品第 py 列的殘差（長度 pw×3） */
  resRow(py: number): Int8Array;
  /** 告訴它「格子第 gy 列以前、成品第 py 列以前都不會再用到了」，那些段可以丟掉 */
  release(gy: number, py: number): void;
}
const BAND = 64;

/** P＝成品（縮小尺寸算出來的），D＝同尺寸的原圖；兩者都是 RGBA。只記下來，真正的計算在用到時才做 */
export function buildTransfer(P: Uint8ClampedArray, D: Uint8ClampedArray, pw: number, ph: number): Transfer {
  const gw = Math.max(1, Math.ceil(pw / 2)), gh = Math.max(1, Math.ceil(ph / 2));
  const r = 2, eps = 16;   // 5×5 鄰域；eps 讓平坦的地方不會亂學出很大的增益
  /* 分段算（每段 BAND 列格子，上下各多算 HALO 列）：兩次 5×5 平均，每一格最遠用到上下 4 列，
     多算 4 列就跟整張一起算是同一個結果（只差浮點累加的進位，成品偶爾 ±1）。 */
  const HALO = 2 * r;
  const cap = Math.min(gh, BAND + 2 * HALO) * gw;
  let scratch: Float32Array[] | null = null;
  const ab = new Map<number, { a: Float32Array[]; b: Float32Array[] }>();
  const resB = new Map<number, Int8Array>();
  const abBand = (k: number) => {
    let e = ab.get(k); if (e) return e;
    if (!scratch) scratch = Array.from({ length: 9 }, () => new Float32Array(cap));
    const [Dg, Pg, DD, DP, mD, mP, mDD, mDP, tmp] = scratch;
    const A = DD, B = DP;   // 算出 mDD、mDP 之後 DD、DP 就用不到了
    const g0 = k * BAND, g1 = Math.min(gh, g0 + BAND), s0 = Math.max(0, g0 - HALO), s1 = Math.min(gh, g1 + HALO), sh = s1 - s0;
    e = { a: [], b: [] };
    for (let c = 0; c < 3; c++) {
      // 2×2 平均到格子上
      for (let gy = s0; gy < s1; gy++) for (let gx = 0; gx < gw; gx++) {
        let sd = 0, sp = 0, n = 0;
        for (let yy = gy * 2; yy < Math.min(ph, gy * 2 + 2); yy++) for (let xx = gx * 2; xx < Math.min(pw, gx * 2 + 2); xx++) {
          const o = (yy * pw + xx) * 4 + c; sd += D[o]; sp += P[o]; n++;
        }
        const i = (gy - s0) * gw + gx; Dg[i] = sd / n; Pg[i] = sp / n; DD[i] = Dg[i] * Dg[i]; DP[i] = Dg[i] * Pg[i];
      }
      boxMean(Dg, gw, sh, r, tmp, mD); boxMean(Pg, gw, sh, r, tmp, mP); boxMean(DD, gw, sh, r, tmp, mDD); boxMean(DP, gw, sh, r, tmp, mDP);
      for (let i = 0; i < sh * gw; i++) {
        const v = mDD[i] - mD[i] * mD[i], cv = mDP[i] - mD[i] * mP[i];
        const ai = clampI(cv / (v + eps), 0, 4);
        A[i] = ai; B[i] = mP[i] - ai * mD[i];
      }
      // 導向濾波的第二步：a、b 再平均一次，關係在空間上平滑；只留這一段本身（不含多算的上下幾列）
      boxMean(A, gw, sh, r, tmp, mD); boxMean(B, gw, sh, r, tmp, mP);
      e.a.push(mD.slice((g0 - s0) * gw, (g1 - s0) * gw));
      e.b.push(mP.slice((g0 - s0) * gw, (g1 - s0) * gw));
    }
    ab.set(k, e); return e;
  };
  const aRow = (c: number, gy: number) => { const k = (gy / BAND) | 0, o = (gy - k * BAND) * gw; return abBand(k).a[c].subarray(o, o + gw); };
  const bRow = (c: number, gy: number) => { const k = (gy / BAND) | 0, o = (gy - k * BAND) * gw; return abBand(k).b[c].subarray(o, o + gw); };
  // 殘差：成品 −（a×原圖＋b），在成品尺寸上；一段＝成品的 2×BAND 列
  const PB = 2 * BAND;
  const resBand = (k: number) => {
    let e = resB.get(k); if (e) return e;
    const y0 = k * PB, y1 = Math.min(ph, y0 + PB);
    e = new Int8Array((y1 - y0) * pw * 3);
    for (let y = y0; y < y1; y++) {
      const fy = (y + 0.5) / 2 - 0.5, ya = clampI(Math.floor(fy), 0, gh - 1), yb = clampI(ya + 1, 0, gh - 1), ty = clampI(fy - ya, 0, 1);
      const Aa = [aRow(0, ya), aRow(1, ya), aRow(2, ya)], Ab = [aRow(0, yb), aRow(1, yb), aRow(2, yb)];
      const Ba = [bRow(0, ya), bRow(1, ya), bRow(2, ya)], Bb = [bRow(0, yb), bRow(1, yb), bRow(2, yb)];
      for (let x = 0; x < pw; x++) {
        const fx = (x + 0.5) / 2 - 0.5, xa = clampI(Math.floor(fx), 0, gw - 1), xb = clampI(xa + 1, 0, gw - 1), tx = clampI(fx - xa, 0, 1);
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        const o = (y * pw + x) * 4;
        for (let c = 0; c < 3; c++) {
          const av = Aa[c][xa] * w00 + Aa[c][xb] * w10 + Ab[c][xa] * w01 + Ab[c][xb] * w11, bv = Ba[c][xa] * w00 + Ba[c][xb] * w10 + Bb[c][xa] * w01 + Bb[c][xb] * w11;
          e[((y - y0) * pw + x) * 3 + c] = clampI(Math.round(P[o + c] - (av * D[o + c] + bv)), -127, 127);
        }
      }
    }
    resB.set(k, e); return e;
  };
  const resRow = (py: number) => { const k = (py / PB) | 0, o = (py - k * PB) * pw * 3; return resBand(k).subarray(o, o + pw * 3); };
  const release = (gy: number, py: number) => {
    for (const k of [...ab.keys()]) if ((k + 1) * BAND <= gy) ab.delete(k);
    for (const k of [...resB.keys()]) if ((k + 1) * PB <= py) resB.delete(k);
  };
  return { gw, gh, pw, ph, aRow, bRow, resRow, release };
}

/** 把局部關係套到原尺寸的一條（rows 列，從 y0 開始），就地改寫 RGBA */
function applyStrip(T: Transfer, O: Uint8ClampedArray, W: number, H: number, y0: number, rows: number) {
  const { gw, gh, pw, ph } = T;
  const kx = pw / W, ky = ph / H;
  let minG = Infinity, minP = Infinity;
  for (let yy = 0; yy < rows; yy++) {
    const y = y0 + yy;
    const py = (y + 0.5) * ky - 0.5, pya = clampI(Math.floor(py), 0, ph - 1), pyb = clampI(pya + 1, 0, ph - 1), pty = clampI(py - pya, 0, 1);
    const gyf = (py + 0.5) / 2 - 0.5, gya = clampI(Math.floor(gyf), 0, gh - 1), gyb = clampI(gya + 1, 0, gh - 1), gty = clampI(gyf - gya, 0, 1);
    if (gya < minG) minG = gya; if (pya < minP) minP = pya;
    const Aa = [T.aRow(0, gya), T.aRow(1, gya), T.aRow(2, gya)], Ab = [T.aRow(0, gyb), T.aRow(1, gyb), T.aRow(2, gyb)];
    const Ba = [T.bRow(0, gya), T.bRow(1, gya), T.bRow(2, gya)], Bb = [T.bRow(0, gyb), T.bRow(1, gyb), T.bRow(2, gyb)];
    const Ra = T.resRow(pya), Rb = T.resRow(pyb);
    for (let x = 0; x < W; x++) {
      const px = (x + 0.5) * kx - 0.5, pxa = clampI(Math.floor(px), 0, pw - 1), pxb = clampI(pxa + 1, 0, pw - 1), ptx = clampI(px - pxa, 0, 1);
      const gxf = (px + 0.5) / 2 - 0.5, gxa = clampI(Math.floor(gxf), 0, gw - 1), gxb = clampI(gxa + 1, 0, gw - 1), gtx = clampI(gxf - gxa, 0, 1);
      const v00 = (1 - gtx) * (1 - gty), v10 = gtx * (1 - gty), v01 = (1 - gtx) * gty, v11 = gtx * gty;
      const r0 = pxa * 3, r1 = pxb * 3;
      const u00 = (1 - ptx) * (1 - pty), u10 = ptx * (1 - pty), u01 = (1 - ptx) * pty, u11 = ptx * pty;
      const o = (yy * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const av = Aa[c][gxa] * v00 + Aa[c][gxb] * v10 + Ab[c][gxa] * v01 + Ab[c][gxb] * v11;
        const bv = Ba[c][gxa] * v00 + Ba[c][gxb] * v10 + Bb[c][gxa] * v01 + Bb[c][gxb] * v11;
        const rv = Ra[r0 + c] * u00 + Ra[r1 + c] * u10 + Rb[r0 + c] * u01 + Rb[r1 + c] * u11;
        O[o + c] = av * O[o + c] + bv + rv;
      }
      O[o + 3] = 255;
    }
  }
  // 由上往下做：這一條最上面用到的段以前的，之後都不會再用
  T.release(minG, minP);
}

/** 一條一條讀原圖、套關係、送去編碼，回傳成品的 blob 網址 */
/** 背景壓縮程式多久沒有任何進度就判定卡住（被系統關掉又沒回報錯誤時，以前會永遠停在「儲存中」） */
const STALL_MS = 20000;
export async function exportFullRes(src: StripSource, T: Transfer, type: 'image/jpeg' | 'image/png'): Promise<string | null> {
  /* 卡住或失敗：換一個新的背景程式從頭再做一次（使用者只會看到轉久一點，成品一模一樣） */
  for (let attempt = 0; attempt < 2; attempt++) {
    const url = await exportFullResOnce(src, T, type);
    if (url) return url;
  }
  return null;
}
async function exportFullResOnce(src: StripSource, T: Transfer, type: 'image/jpeg' | 'image/png'): Promise<string | null> {
  const { W, H } = src;
  const worker = new Worker(new URL('./stripEncoder.worker.ts', import.meta.url), { type: 'module' });
  const c = document.createElement('canvas');
  /* 流量控制：每送一條，背景執行緒消化完才回 ack；在途中最多 MAX_INFLIGHT 條（每條約 8MB），
     編碼比讀圖慢的時候主執行緒會等，像素不會在訊息佇列裡無限堆積 */
  const MAX_INFLIGHT = 2;
  let inflight = 0, wake: (() => void) | null = null, failed: unknown = null;
  let stall = 0;
  const fail = (e: unknown, rej?: (e: unknown) => void) => { if (failed) return; failed = e; rej?.(e); const w = wake; wake = null; w?.(); };
  try {
    const done = new Promise<Blob>((res, rej) => {
      const arm = () => { clearTimeout(stall); stall = window.setTimeout(() => fail(new Error('encoder stalled'), rej), STALL_MS); };
      arm();
      worker.onmessage = e => {
        const t = e.data?.type;
        arm();
        if (t === 'ack') { inflight--; const w = wake; wake = null; w?.(); }
        else if (t === 'done') { clearTimeout(stall); res(e.data.blob); }
        else if (t === 'error') fail(new Error(e.data.error), rej);
      };
      worker.onerror = e => fail(e, rej);
    });
    done.catch(() => {});
    worker.postMessage({ type: 'start', fmt: type === 'image/png' ? 'png' : 'jpeg', w: W, h: H, quality: 100 });
    const STRIP = Math.max(8, Math.min(256, Math.floor(2_000_000 / W) & ~7));   // 每條約 200 萬像素以內
    c.width = W; c.height = STRIP;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.imageSmoothingQuality = 'high';
    for (let y0 = 0; y0 < H; y0 += STRIP) {
      while (inflight >= MAX_INFLIGHT && !failed) await new Promise<void>(r => { wake = r; });
      if (failed) throw failed;
      const rows = Math.min(STRIP, H - y0);
      g.clearRect(0, 0, W, STRIP);
      src.drawStrip(g, y0, rows);
      const d = g.getImageData(0, 0, W, rows).data;
      applyStrip(T, d, W, H, y0, rows);
      inflight++;
      worker.postMessage({ type: 'rows', data: d.buffer, rows }, [d.buffer]);
      // 讓出主執行緒：轉圈動畫、介面不會整個凍住
      await new Promise(r => setTimeout(r, 0));
    }
    worker.postMessage({ type: 'end' });
    const blob = await done;
    return URL.createObjectURL(blob);
  } catch (e) {
    console.error('full-res export failed', e);
    return null;
  } finally {
    // 成功或失敗都收乾淨：計時器、暫存畫布、背景執行緒
    clearTimeout(stall);
    c.width = c.height = 0;
    worker.terminate();
  }
}

/** 原尺寸做不出來（重試也失敗）時的最後退路：存手機上算好的那張（工作解析度），畫面正確、一定存得出來 */
export function workingResUrl(P: Uint8ClampedArray, pw: number, ph: number, type: 'image/jpeg' | 'image/png'): Promise<string> {
  const c = document.createElement('canvas'); c.width = pw; c.height = ph;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(P), pw, ph), 0, 0);
  return canvasToUrl(c, type, 1).finally(() => { c.width = c.height = 0; });
}

/** 從一張「縮小尺寸算好的成品畫布」＋同尺寸原圖，做出原尺寸成品（工具共用） */
export async function fullResFromProcessed(img: CanvasImageSource & { width: number; height: number }, P: Uint8ClampedArray, D: Uint8ClampedArray,
  pw: number, ph: number, type: 'image/jpeg' | 'image/png' = 'image/png'): Promise<string | null> {
  const W = (img as HTMLImageElement).naturalWidth || img.width, H = (img as HTMLImageElement).naturalHeight || img.height;
  const T = buildTransfer(P, D, pw, ph);
  const url = await exportFullRes({ W, H, drawStrip: (ctx, y0, h) => ctx.drawImage(img, 0, y0, W, h, 0, 0, W, h) }, T, type);
  return url || workingResUrl(P, pw, ph, type);
}

/** 同尺寸的原圖像素（給 fullResFromProcessed 用） */
export function originalAt(img: CanvasImageSource, w: number, h: number): Uint8ClampedArray {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!; g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data; c.width = c.height = 0;
  return d;
}
