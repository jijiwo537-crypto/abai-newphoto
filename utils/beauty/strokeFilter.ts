/* 去皺、磨皮共用的「整筆」引擎。
 *
 * 以前去皺是每一個筆刷點都把周圍整塊重新模糊一次、再寫回去：
 *   ・筆刷越大，每一點要算的面積是半徑平方倍 —— 大筆刷拖快一點就卡；
 *   ・同一個地方被好幾個點蓋到，就被模糊好幾次，效果一直疊上去，很難控制。
 * 專業修圖軟體的筆刷不是這樣做的：先決定「這一筆要變成什麼樣子」（目標層），
 * 筆刷只負責畫一張「覆蓋程度」的遮罩（同一筆裡取最大值、不累加），
 * 畫面＝原圖 +（目標 − 原圖）× 遮罩。
 * 這樣每一個筆刷點只是一個簡單的混合，跟筆刷大小幾乎無關；目標層用到哪裡才算到哪裡（64px 一塊）。
 *
 * 目標層：
 *   去皺 —— 低頻（大範圍平均）＋ 壓低的高頻：暗的細紋重壓、亮部質感留著（跟以前同一個公式）。
 *           平均的半徑很大時改在縮小的圖上算（金字塔），一次就好、只要幾毫秒。
 *   磨皮 —— 自我引導濾波（guided filter）：變化小的地方（毛孔、粉刺、細紋）被抹平，
 *           變化大的地方（眼睛、眉毛、髮絲、輪廓）完全保留，不會糊成一片；
 *           再把一小部分原本的紋理疊回去，皮膚才不會像塑膠。 */

export type Rect = { x: number; y: number; w: number; h: number };
export type StrokeKind = 'wrinkle' | 'smooth';

const T = 64;               // 一塊的邊長
const SH = 6;               // log2(T)

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
const scratch = new Map<string, Float32Array>();
function fbuf(key: string, n: number) {
  let b = scratch.get(key);
  if (!b || b.length < n) { b = new Float32Array(n); scratch.set(key, b); }
  return b;
}
function box(s: Float32Array, d: Float32Array, w: number, h: number, r: number) {
  const t = fbuf('box-t', w * h);
  boxH(s, t, w, h, r); boxV(t, d, w, h, r);
}

/** 去皺的平均半徑（跟以前一樣是筆刷半徑的 0.55 倍） */
export const wrinkleBlurRadius = (R: number) => Math.max(2, Math.round(R * 0.55));
/** 磨皮的濾波半徑：跟照片尺寸走（毛孔的大小只跟照片有關，跟筆刷無關），存檔放大時自動等比例 */
export const smoothRadius = (W: number, H: number) => clampI(Math.round(Math.min(W, H) * 0.0075), 3, 48);
/** 磨皮保留多少原本的紋理 */
const SMOOTH_TEXTURE = 0.2;
/** 磨皮的邊緣門檻（變異數）：比它小的起伏算皮膚紋理會被抹平，大的算輪廓會留下來 */
const SMOOTH_EPS = 22 * 22;

export class StrokeLayer {
  private tw: number;
  private snaps = new Map<number, Uint8ClampedArray>();
  private targets: Map<number, Uint8ClampedArray>;
  private alphas = new Map<number, Float32Array>();
  /* 去皺、平均半徑大的時候：整張縮小後算好的低頻 */
  private low: { d: Float32Array; w: number; h: number; f: number } | null = null;
  private br = 0;
  private gr = 0;

  /**
   * dst：要被畫上去的像素（會直接改）。
   * full：這一筆開始前的完整像素；有的話直接拿來讀原圖（互動時本來就留了一份）。
   *       沒有的話（存檔重播）就在每一塊第一次被改之前，先把那一塊存起來。
   */
  constructor(private dst: Uint8ClampedArray, private W: number, private H: number,
    private kind: StrokeKind, R: number, private full: Uint8ClampedArray | null = null,
    targets?: Map<number, Uint8ClampedArray>) {
    this.tw = (W + T - 1) >> SH;
    /* 磨皮的目標層只跟照片有關（跟筆刷大小無關），所以可以跨筆共用：呼叫端傳一份進來，
       每一筆畫完只把被改到的那幾塊作廢（見 smoothInvalidate） */
    this.targets = targets || new Map();
    if (kind === 'wrinkle') {
      this.br = wrinkleBlurRadius(R);
      if (this.br > 16) this.buildLow();
    } else {
      this.gr = smoothRadius(W, H);
    }
  }

  /** 讀「這一筆開始前」的像素到三個通道（區域外的部分由呼叫端自己夾住，不會越界） */
  private readRegion(x0: number, y0: number, w: number, h: number, R: Float32Array, G: Float32Array, B: Float32Array) {
    const W = this.W;
    for (let y = 0; y < h; y++) {
      const gy = y0 + y, ty = gy >> SH;
      let x = 0;
      while (x < w) {
        const gx = x0 + x, tx = gx >> SH;
        const segEnd = Math.min(w, ((tx + 1) << SH) - x0);
        const snap = this.full ? null : this.snaps.get(ty * this.tw + tx);
        let si: number, src: Uint8ClampedArray;
        if (this.full) { src = this.full; si = (gy * W + gx) * 4; }
        else if (snap) { src = snap; si = (((gy & (T - 1)) << SH) + (gx & (T - 1))) * 4; }
        else { src = this.dst; si = (gy * W + gx) * 4; }
        for (let di = y * w + x, de = y * w + segEnd; di < de; di++, si += 4) {
          R[di] = src[si]; G[di] = src[si + 1]; B[di] = src[si + 2];
        }
        x = segEnd;
      }
    }
  }

  private buildLow() {
    const f = Math.max(2, Math.floor(this.br / 4));
    const W = this.W, H = this.H;
    const lw = Math.ceil(W / f), lh = Math.ceil(H / f);
    const d = new Float32Array(lw * lh * 3);
    const src = this.full || this.dst;   // 建構的當下還沒被改過
    for (let ly = 0; ly < lh; ly++) {
      const ys = ly * f, ye = Math.min(H, ys + f);
      for (let lx = 0; lx < lw; lx++) {
        const xs = lx * f, xe = Math.min(W, xs + f);
        let r = 0, g = 0, b = 0;
        for (let y = ys; y < ye; y++) {
          let o = (y * W + xs) * 4;
          for (let x = xs; x < xe; x++, o += 4) { r += src[o]; g += src[o + 1]; b += src[o + 2]; }
        }
        const n = 1 / ((ye - ys) * (xe - xs)), o = (ly * lw + lx) * 3;
        d[o] = r * n; d[o + 1] = g * n; d[o + 2] = b * n;
      }
    }
    const rb = Math.max(1, Math.round(this.br / f));
    const ch = fbuf('low-c', lw * lh), out = fbuf('low-o', lw * lh);
    for (let c = 0; c < 3; c++) {
      for (let i = 0; i < lw * lh; i++) ch[i] = d[i * 3 + c];
      box(ch, out, lw, lh, rb);
      for (let i = 0; i < lw * lh; i++) d[i * 3 + c] = out[i];
    }
    this.low = { d, w: lw, h: lh, f };
  }

  private computeTile(tx: number, ty: number) {
    const x0 = tx << SH, y0 = ty << SH;
    const tw = Math.min(T, this.W - x0), th = Math.min(T, this.H - y0);
    const out = new Uint8ClampedArray(T * T * 4);
    if (this.kind === 'wrinkle') this.wrinkleTile(x0, y0, tw, th, out);
    else this.smoothTile(x0, y0, tw, th, out);
    this.targets.set(ty * this.tw + tx, out);
  }

  private wrinkleTile(x0: number, y0: number, tw: number, th: number, out: Uint8ClampedArray) {
    const n = tw * th;
    const R = fbuf('w-r', n), G = fbuf('w-g', n), B = fbuf('w-b', n);
    this.readRegion(x0, y0, tw, th, R, G, B);
    const lo = [fbuf('w-lr', n), fbuf('w-lg', n), fbuf('w-lb', n)];
    if (this.low) {
      const { d, w: lw, h: lh, f } = this.low;
      for (let y = 0; y < th; y++) {
        const fy = (y0 + y + 0.5) / f - 0.5;
        const ya = clampI(Math.floor(fy), 0, lh - 1), yb = clampI(ya + 1, 0, lh - 1), ty = clampI(fy - ya, 0, 1);
        for (let x = 0; x < tw; x++) {
          const fx = (x0 + x + 0.5) / f - 0.5;
          const xa = clampI(Math.floor(fx), 0, lw - 1), xb = clampI(xa + 1, 0, lw - 1), txx = clampI(fx - xa, 0, 1);
          const i00 = (ya * lw + xa) * 3, i10 = (ya * lw + xb) * 3, i01 = (yb * lw + xa) * 3, i11 = (yb * lw + xb) * 3;
          const w00 = (1 - txx) * (1 - ty), w10 = txx * (1 - ty), w01 = (1 - txx) * ty, w11 = txx * ty;
          const i = y * tw + x;
          for (let c = 0; c < 3; c++) lo[c][i] = d[i00 + c] * w00 + d[i10 + c] * w10 + d[i01 + c] * w01 + d[i11 + c] * w11;
        }
      }
    } else {
      // 半徑小：直接在這一塊（外加半徑那麼寬的邊）上平均
      const br = this.br;
      const rx0 = Math.max(0, x0 - br), ry0 = Math.max(0, y0 - br);
      const rx1 = Math.min(this.W, x0 + tw + br), ry1 = Math.min(this.H, y0 + th + br);
      const pw = rx1 - rx0, ph = ry1 - ry0, pn = pw * ph;
      const PR = fbuf('w-pr', pn), PG = fbuf('w-pg', pn), PB = fbuf('w-pb', pn), O = fbuf('w-po', pn);
      this.readRegion(rx0, ry0, pw, ph, PR, PG, PB);
      const chans = [PR, PG, PB];
      for (let c = 0; c < 3; c++) {
        box(chans[c], O, pw, ph, br);
        for (let y = 0; y < th; y++) {
          const so = (y0 + y - ry0) * pw + (x0 - rx0);
          for (let x = 0; x < tw; x++) lo[c][y * tw + x] = O[so + x];
        }
      }
    }
    const S = [R, G, B];
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const i = y * tw + x, o = ((y << SH) + x) * 4;
        for (let c = 0; c < 3; c++) {
          const s = S[c][i], hi = s - lo[c][i];
          out[o + c] = s - hi * (hi < 0 ? 1 : 0.35);   // 暗的細紋重壓，亮部質感保留
        }
        out[o + 3] = 255;
      }
    }
  }

  /* 快速引導濾波（He & Sun 2015）：係數 a、b 在半解析度上算，放大回來再套在原解析度的像素上 ——
     邊緣一樣銳利（套的是原圖），成本大約只有四分之一。 */
  private smoothTile(x0: number, y0: number, tw: number, th: number, out: Uint8ClampedArray) {
    const r = this.gr, pad = r * 2 + 4;
    const rx0 = Math.max(0, x0 - pad), ry0 = Math.max(0, y0 - pad);
    const rx1 = Math.min(this.W, x0 + tw + pad), ry1 = Math.min(this.H, y0 + th + pad);
    const pw = rx1 - rx0, ph = ry1 - ry0, pn = pw * ph;
    const PR = fbuf('s-r', pn), PG = fbuf('s-g', pn), PB = fbuf('s-b', pn);
    this.readRegion(rx0, ry0, pw, ph, PR, PG, PB);
    const lw = (pw + 1) >> 1, lh = (ph + 1) >> 1, ln = lw * lh, rr = Math.max(1, Math.round(r / 2));
    const L = fbuf('s-l', ln), L2 = fbuf('s-l2', ln), mI = fbuf('s-mi', ln), mII = fbuf('s-mii', ln), A = fbuf('s-a', ln), Bb = fbuf('s-bb', ln);
    const chans = [PR, PG, PB];
    for (let c = 0; c < 3; c++) {
      const I = chans[c];
      for (let ly = 0; ly < lh; ly++) {
        const y = ly << 1, y2 = Math.min(ph - 1, y + 1);
        for (let lx = 0; lx < lw; lx++) {
          const x = lx << 1, x2 = Math.min(pw - 1, x + 1);
          const v = (I[y * pw + x] + I[y * pw + x2] + I[y2 * pw + x] + I[y2 * pw + x2]) * 0.25;
          L[ly * lw + lx] = v; L2[ly * lw + lx] = v * v;
        }
      }
      box(L, mI, lw, lh, rr);
      box(L2, mII, lw, lh, rr);
      for (let i = 0; i < ln; i++) {
        const m = mI[i], v = Math.max(0, mII[i] - m * m);
        const a = v / (v + SMOOTH_EPS);
        A[i] = a; Bb[i] = m - a * m;
      }
      box(A, mI, lw, lh, rr);      // mI 拿來放 mean(a)
      box(Bb, mII, lw, lh, rr);    // mII 拿來放 mean(b)
      for (let y = 0; y < th; y++) {
        const py = y0 + y - ry0;
        const fy = (py + 0.5) / 2 - 0.5;
        const ya = clampI(Math.floor(fy), 0, lh - 1), yb = Math.min(lh - 1, ya + 1), wy = clampI(fy - ya, 0, 1);
        for (let x = 0; x < tw; x++) {
          const px = x0 + x - rx0;
          const fx = (px + 0.5) / 2 - 0.5;
          const xa = clampI(Math.floor(fx), 0, lw - 1), xb = Math.min(lw - 1, xa + 1), wx = clampI(fx - xa, 0, 1);
          const i00 = ya * lw + xa, i10 = ya * lw + xb, i01 = yb * lw + xa, i11 = yb * lw + xb;
          const w00 = (1 - wx) * (1 - wy), w10 = wx * (1 - wy), w01 = (1 - wx) * wy, w11 = wx * wy;
          const a = mI[i00] * w00 + mI[i10] * w10 + mI[i01] * w01 + mI[i11] * w11;
          const b = mII[i00] * w00 + mII[i10] * w10 + mII[i01] * w01 + mII[i11] * w11;
          const sv = I[py * pw + px];
          const q = a * sv + b;
          out[((y << SH) + x) * 4 + c] = q + (sv - q) * SMOOTH_TEXTURE;
        }
      }
    }
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) out[((y << SH) + x) * 4 + 3] = 255;
  }

  /** 先把某一塊的目標層算好（閒置時預熱用） */
  warmTile(tx: number, ty: number): boolean {
    const idx = ty * this.tw + tx;
    if (this.targets.has(idx)) return false;
    this.computeTile(tx, ty);
    return true;
  }
  get tilesX() { return this.tw; }
  get tilesY() { return (this.H + T - 1) >> SH; }

  /**
   * 蓋一個筆刷點。inner 以內是實心，往外用 smoothstep 柔到 0；strength 是這一筆的上限。
   * 回傳改過的範圍（呼叫端拿去重畫）。
   */
  stamp(cx: number, cy: number, Rb: number, strength: number, inner: number): Rect | null {
    const W = this.W, H = this.H;
    const xa = Math.max(0, Math.floor(cx - Rb)), xb = Math.min(W, Math.ceil(cx + Rb + 1));
    const ya = Math.max(0, Math.floor(cy - Rb)), yb = Math.min(H, Math.ceil(cy + Rb + 1));
    if (xb - xa < 1 || yb - ya < 1 || strength <= 0) return null;
    const invR = 1 / Rb, inn = clampI(inner, 0, 0.97), invSpan = 1 / (1 - inn);
    const dst = this.dst, full = this.full;
    for (let ty = ya >> SH; ty <= (yb - 1) >> SH; ty++) {
      for (let tx = xa >> SH; tx <= (xb - 1) >> SH; tx++) {
        const idx = ty * this.tw + tx;
        const bx0 = Math.max(xa, tx << SH), bx1 = Math.min(xb, (tx + 1) << SH);
        const by0 = Math.max(ya, ty << SH), by1 = Math.min(yb, (ty + 1) << SH);
        // 這一塊有沒有被筆刷圈到（四個角都在圈外、圓心也不在裡面就跳過）
        const nx = clampI(cx, bx0, bx1 - 1), ny = clampI(cy, by0, by1 - 1);
        if ((nx - cx) * (nx - cx) + (ny - cy) * (ny - cy) >= Rb * Rb) continue;
        if (!this.targets.has(idx)) this.computeTile(tx, ty);
        if (!full && !this.snaps.has(idx)) {
          const snap = new Uint8ClampedArray(T * T * 4);
          const tx0 = tx << SH, ty0 = ty << SH, tw = Math.min(T, W - tx0), th = Math.min(T, H - ty0);
          for (let y = 0; y < th; y++) snap.set(dst.subarray(((ty0 + y) * W + tx0) * 4, ((ty0 + y) * W + tx0 + tw) * 4), (y << SH) * 4);
          this.snaps.set(idx, snap);
        }
        let al = this.alphas.get(idx);
        if (!al) { al = new Float32Array(T * T); this.alphas.set(idx, al); }
        const tg = this.targets.get(idx)!;
        const snap = full ? null : this.snaps.get(idx)!;
        for (let y = by0; y < by1; y++) {
          const dy = (y - cy) * invR, dy2 = dy * dy;
          for (let x = bx0; x < bx1; x++) {
            const dx = (x - cx) * invR, t2 = dx * dx + dy2;
            if (t2 >= 1) continue;
            const t = Math.sqrt(t2);
            let w: number;
            if (t <= inn) w = 1;
            else { const u = (t - inn) * invSpan; w = 1 - u * u * (3 - 2 * u); }
            const a = w * strength;
            const li = ((y & (T - 1)) << SH) + (x & (T - 1));
            if (a <= al[li]) continue;
            al[li] = a;
            const o = (y * W + x) * 4, lo = li * 4;
            const sr = full ? full[o] : snap![lo], sg = full ? full[o + 1] : snap![lo + 1], sb = full ? full[o + 2] : snap![lo + 2];
            dst[o] = sr + (tg[lo] - sr) * a;
            dst[o + 1] = sg + (tg[lo + 1] - sg) * a;
            dst[o + 2] = sb + (tg[lo + 2] - sb) * a;
          }
        }
      }
    }
    return { x: xa, y: ya, w: xb - xa, h: yb - ya };
  }
}

/** 去皺「力度」(10~100) → 這一筆的覆蓋上限。
    以前每一點都疊一次（大約 4～5 層），換成不累加的遮罩後用同一條曲線換算，手感跟以前接近。 */
export const wrinkleStrength = (force: number) => 1 - Math.pow(1 - 0.55 * clampI(force / 100, 0, 1), 4.5);
/** 磨皮「力度」(0~100) → 覆蓋上限 */
export const smoothStrength = (force: number) => clampI(force / 100, 0, 1);
/** 兩種筆刷的邊緣：去皺整圈都柔、磨皮中間有一塊實心 */
export const STROKE_INNER: Record<StrokeKind, number> = { wrinkle: 0, smooth: 0.35 };

/** 磨皮共用的目標層裡，被改過像素的範圍（外加濾波看得到的距離）作廢 */
export function smoothInvalidate(targets: Map<number, Uint8ClampedArray>, W: number, H: number, r: Rect) {
  const pad = smoothRadius(W, H) * 2 + 6;
  const tw = (W + T - 1) >> SH;
  const x0 = Math.max(0, r.x - pad) >> SH, x1 = Math.min(W - 1, r.x + r.w + pad) >> SH;
  const y0 = Math.max(0, r.y - pad) >> SH, y1 = Math.min(H - 1, r.y + r.h + pad) >> SH;
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) targets.delete(ty * tw + tx);
}
