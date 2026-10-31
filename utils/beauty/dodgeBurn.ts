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

import { FACE_OVAL, LEFT_EYE, RIGHT_EYE, LEFT_BROW, RIGHT_BROW, LIPS, NOSTRILS } from '../faceSkinDraw';

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

/* ── 皮膚範圍（偵測） ──
   1. 臉部 478 點畫出三張圖：
      「取樣區」＝臉的輪廓往內縮、挖掉五官 —— 這裡一定是皮膚，用來學「這個人的膚色」；
      「範圍」＝輪廓往外擴（含髮際、耳前）＋脖子；
      「五官」＝眼睛（含睫毛一圈）、眉毛、嘴唇、鼻孔，一定不修。
   2. 膚色模型：從取樣區學這張照片、這個人的膚色（色度的平均與共變異數，兩輪去掉離群值），
      用馬氏距離判斷每個像素像不像他的皮膚 —— 不再用固定的膚色範圍，白皙、黝黑、有上妝、燈光偏色都準。
      色度用「亮度歸一的色度」，陰影裡的皮膚跟亮面的皮膚判斷一致。
   3. 導向濾波（guided filter）讓遮罩的邊緣貼齊照片真正的邊（髮際、下顎、鼻翼），不會修出界、也不會留一圈沒修到。 */
function polyFill(g: CanvasRenderingContext2D, f: number[], idx: readonly number[], W: number, H: number, sc = 1, cx = 0, cy = 0) {
  g.beginPath();
  idx.forEach((k, i) => { const x = cx + (f[k * 2] * W - cx) * sc, y = cy + (f[k * 2 + 1] * H - cy) * sc; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
  g.closePath();
}
function drawLayer(W: number, H: number, paint: (g: CanvasRenderingContext2D) => void): Float32Array {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.lineJoin = 'round';
  paint(g);
  const d = g.getImageData(0, 0, W, H).data, out = new Float32Array(W * H);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4] / 255;
  c.width = c.height = 0;
  return out;
}
/** 導向濾波：輸出跟 p 一樣平滑，但邊緣跟著 I 走 */
function guidedFilter(I: Float32Array, p: Float32Array, W: number, H: number, r: number, eps: number): Float32Array {
  const n = W * H, t = new Float32Array(n);
  const mean = (a: Float32Array) => { const o = new Float32Array(a); boxH(o, t, W, H, r); boxV(t, o, W, H, r); return o; };
  const Ip = new Float32Array(n), II = new Float32Array(n);
  for (let i = 0; i < n; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
  const mI = mean(I), mp = mean(p), mIp = mean(Ip), mII = mean(II);
  const A = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = mII[i] - mI[i] * mI[i], cov = mIp[i] - mI[i] * mp[i]; A[i] = cov / (v + eps); B[i] = mp[i] - A[i] * mI[i]; }
  const mA = mean(A), mB = mean(B);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = clampI(mA[i] * I[i] + mB[i], 0, 1);
  return q;
}
function skinWeight(src: Uint8ClampedArray, W: number, H: number, faces: number[][]): Float32Array {
  const n = W * H;
  if (!faces.length) {
    // 沒有臉：只能用通用的膚色範圍，打七折，保守
    const w = new Float32Array(n);
    for (let i = 0, o = 0; i < n; i++, o += 4) w[i] = 0.7 * skinLikelihood(src[o], src[o + 1], src[o + 2]);
    gauss(w, new Float32Array(n), W, H, Math.max(1, Math.round(Math.max(W, H) / 900)));
    return w;
  }
  const fws = faces.map(f => Math.hypot((f[234 * 2] - f[454 * 2]) * W, (f[234 * 2 + 1] - f[454 * 2 + 1]) * H) || Math.min(W, H) * 0.3);
  const fwMax = Math.max(...fws);
  const core = drawLayer(W, H, g => faces.forEach((f, j) => {
    const fw = fws[j];
    g.fillStyle = '#fff'; polyFill(g, f, FACE_OVAL, W, H); g.fill();
    g.strokeStyle = '#000'; g.lineWidth = fw * 0.16; polyFill(g, f, FACE_OVAL, W, H); g.stroke();
    g.fillStyle = '#000'; g.strokeStyle = '#000'; g.lineWidth = fw * 0.12;
    for (const idx of [LEFT_EYE, RIGHT_EYE, LEFT_BROW, RIGHT_BROW, LIPS]) { polyFill(g, f, idx, W, H); g.fill(); g.stroke(); }
  }));
  const region = drawLayer(W, H, g => faces.forEach((f, j) => {
    const fw = fws[j];
    // 臉的中心（鼻樑）往外擴 12%，再往上多擴一點包住髮際
    const cx = f[168 * 2] * W, cy = f[168 * 2 + 1] * H;
    g.fillStyle = '#fff'; polyFill(g, f, FACE_OVAL, W, H, 1.12, cx, cy - fw * 0.06); g.fill();
    // 脖子：下顎線往下延伸約 0.9 個臉寬
    const jaw = [132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361];
    g.beginPath();
    jaw.forEach((k, i) => { const x = f[k * 2] * W, y = f[k * 2 + 1] * H; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    const last = jaw[jaw.length - 1], first = jaw[0];
    g.lineTo(f[last * 2] * W - fw * 0.05, f[last * 2 + 1] * H + fw * 0.9);
    g.lineTo(f[first * 2] * W + fw * 0.05, f[first * 2 + 1] * H + fw * 0.9);
    g.closePath(); g.fill();
  }));
  const holes = drawLayer(W, H, g => faces.forEach((f, j) => {
    const fw = fws[j];
    g.fillStyle = '#fff'; g.strokeStyle = '#fff';
    for (const [idx, grow] of [[LEFT_EYE, 0.06], [RIGHT_EYE, 0.06], [LEFT_BROW, 0.03], [RIGHT_BROW, 0.03], [LIPS, 0.025]] as const) {
      g.lineWidth = fw * grow; polyFill(g, f, idx, W, H); g.fill(); g.stroke();
    }
    for (const k of NOSTRILS) { g.beginPath(); g.ellipse(f[k * 2] * W, f[k * 2 + 1] * H, fw * 0.04, fw * 0.03, 0, 0, Math.PI * 2); g.fill(); }
  }));
  const tmp = new Float32Array(n);
  gauss(region, tmp, W, H, Math.max(1, Math.round(fwMax * 0.03)));
  gauss(holes, tmp, W, H, Math.max(1, Math.round(fwMax * 0.012)));

  // 膚色模型：亮度歸一的色度 (u, v)＝(R, G)/(R+G+B)
  let su = 0, sv = 0, suu = 0, svv = 0, suv = 0, cnt = 0;
  const lum: number[] = [];
  const pass = (keep: (u: number, v: number) => boolean) => {
    su = sv = suu = svv = suv = 0; cnt = 0;
    const step = Math.max(1, Math.floor(Math.sqrt(n / 300000)));
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
      const i = y * W + x;
      if (core[i] < 0.9) continue;
      const o = i * 4, r = src[o], g = src[o + 1], b = src[o + 2], s = r + g + b + 1;
      if (s < 60) continue;   // 太暗（陰影、鬍子）不拿來學
      const u = r / s, v = g / s;
      if (!keep(u, v)) continue;
      su += u; sv += v; suu += u * u; svv += v * v; suv += u * v; cnt++;
      if (lum.length < 40000) lum.push(0.299 * r + 0.587 * g + 0.114 * b);
    }
  };
  pass(() => true);
  let mu = su / Math.max(1, cnt), mv = sv / Math.max(1, cnt);
  let cuu = suu / Math.max(1, cnt) - mu * mu, cvv = svv / Math.max(1, cnt) - mv * mv, cuv = suv / Math.max(1, cnt) - mu * mv;
  const md2 = (u: number, v: number) => {
    const a = cuu + 1e-5, d = cvv + 1e-5, b = cuv, det = a * d - b * b;
    const du = u - mu, dv = v - mv;
    return (d * du * du - 2 * b * du * dv + a * dv * dv) / det;
  };
  // 第二輪：去掉離群值（混進來的頭髮、反光、唇色）重新估
  if (cnt > 200) {
    lum.length = 0;
    pass((u, v) => md2(u, v) < 5.99);
    mu = su / Math.max(1, cnt); mv = sv / Math.max(1, cnt);
    cuu = suu / Math.max(1, cnt) - mu * mu; cvv = svv / Math.max(1, cnt) - mv * mv; cuv = suv / Math.max(1, cnt) - mu * mv;
  }
  lum.sort((a, b) => a - b);
  const medY = lum.length ? lum[lum.length >> 1] : 128;

  // 每個像素像不像這個人的皮膚（共變異數放寬 2.2 倍，容許光影造成的色度變化）× 亮度合理
  /* 判斷用「平滑過的顏色」（σ≈臉寬 2.5%）：痘印、斑、法令紋這些正是要修的地方，顏色本來就跟周圍不一樣，
     逐像素判斷會把它們剔掉（遮罩坑坑洞洞、該修的反而沒修）；平滑後看的是「這一區是不是皮膚」 */
  const like = new Float32Array(n), guide = new Float32Array(n);
  const sR = new Float32Array(n), sG = new Float32Array(n), sB = new Float32Array(n);
  for (let i = 0, o = 0; i < n; i++, o += 4) { sR[i] = src[o]; sG[i] = src[o + 1]; sB[i] = src[o + 2]; guide[i] = (0.299 * src[o] + 0.587 * src[o + 1] + 0.114 * src[o + 2]) / 255; }
  const rs = Math.max(1, Math.round(fwMax * 0.025));
  for (const ch of [sR, sG, sB]) gauss(ch, tmp, W, H, rs);
  const ss = (e0: number, e1: number, x: number) => { const t = clampI((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  for (let i = 0; i < n; i++) {
    if (region[i] < 0.002) continue;
    const r = sR[i], g = sG[i], b = sB[i], Y = 0.299 * r + 0.587 * g + 0.114 * b;
    const s = r + g + b + 1, d2 = cnt > 50 ? md2(r / s, g / s) / 2.2 : 0;
    const yr = Y / Math.max(1, medY);
    // 亮度：陰影裡的皮膚（脖子、下顎下方）也算，只排除真的很黑的（頭髮、鬍子、背景）
    like[i] = Math.exp(-0.5 * d2) * ss(0.12, 0.3, yr) * (1 - ss(1.8, 2.4, yr)) * region[i];
  }
  // 邊緣貼齊照片：導向濾波（半徑約臉寬 1.5%）
  const q = guidedFilter(guide, like, W, H, Math.max(2, Math.round(fwMax * 0.015)), 0.0025);
  for (let i = 0; i < n; i++) q[i] = clampI(q[i] * 1.15, 0, 1) * (1 - holes[i]) * (region[i] > 0.002 ? 1 : 0);
  return q;
}

/** 臉的寬度（像素）：所有臉裡最大的那張；沒有臉就用短邊的三成 */
function faceWidth(faces: number[][], W: number, H: number) {
  let fw = 0;
  for (const f of faces) fw = Math.max(fw, Math.hypot((f[234 * 2] - f[454 * 2]) * W, (f[234 * 2 + 1] - f[454 * 2 + 1]) * H));
  return fw > 8 ? fw : Math.min(W, H) * 0.3;
}

const ANALYZE_LONG = 2048;
/** 大照片縮到長邊 2048 再分析 */
function fitAnalysis(src0: Uint8ClampedArray, W0: number, H0: number): { src: Uint8ClampedArray; W: number; H: number } {
  if (Math.max(W0, H0) <= ANALYZE_LONG) return { src: src0, W: W0, H: H0 };
  const k = ANALYZE_LONG / Math.max(W0, H0);
  const W = Math.round(W0 * k), H = Math.round(H0 * k);
  const a = document.createElement('canvas'); a.width = W0; a.height = H0;
  a.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(src0.buffer, src0.byteOffset, W0 * H0 * 4), W0, H0), 0, 0);
  const b = document.createElement('canvas'); b.width = W; b.height = H;
  const g = b.getContext('2d', { willReadFrequently: true })!; g.imageSmoothingQuality = 'high'; g.drawImage(a, 0, 0, W, H);
  const src = g.getImageData(0, 0, W, H).data; a.width = a.height = 0;
  return { src, W, H };
}
/** 臉寬佔照片寬的比例（筆刷記在操作裡，重播時任何解析度尺度都一致） */
export function faceWidthFrac(faces: number[][], W: number, H: number) { return faceWidth(faces, W, H) / W; }

/** 筆刷用的中頻層（對數亮度）：不乘皮膚範圍（筆刷刷到哪裡就是哪裡），一樣有柔性上限 */
export interface DBBand { W: number; H: number; mid: Float32Array; }
export function analyzeMidBand(src0: Uint8ClampedArray, W0: number, H0: number, fwFrac: number): DBBand {
  const { src, W, H } = fitAnalysis(src0, W0, H0), n = W * H;
  const fw = fwFrac * W;
  const sS = Math.max(1, Math.round(fw * 0.006)), sL = Math.max(sS * 3, fw * 0.06);
  const lY = new Float32Array(n);
  for (let i = 0, o = 0; i < n; i++, o += 4) lY[i] = Math.log(0.299 * src[o] + 0.587 * src[o + 1] + 0.114 * src[o + 2] + 2);
  const mid = new Float32Array(lY), lo = new Float32Array(n);
  gauss(mid, new Float32Array(n), W, H, sS);
  gaussLarge(lY, lo, W, H, sL);
  /* 筆刷沒有皮膚範圍保護（刷到哪就是哪），上限收得比自動更緊：眉毛、睫毛、髮絲這些很強的明暗
     刷過去幾乎不動，只修皮膚上那種輕微的不均 */
  const tau = 0.3;
  for (let i = 0; i < n; i++) { const m = mid[i] - lo[i]; mid[i] = m / (1 + (m / tau) * (m / tau) * (m / tau) * (m / tau)); }
  return { W, H, mid };
}

export function analyzeDodgeBurn(src0: Uint8ClampedArray, W0: number, H0: number, faces: number[][]): DBAnalysis {
  const { src, W, H } = fitAnalysis(src0, W0, H0);
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

/* ── 手動筆刷：智慧加深減淡 ──
   不是把刷到的地方整片調亮／調暗（那樣只會刷出一塊補丁）。修圖師用中性灰筆時，提亮筆只點在
   「比周圍暗」的小區塊上、壓暗筆只點在「比周圍亮」的地方，把它們修回跟周圍一樣 —— 這支筆就是這樣做：
     提亮筆：只作用在中頻層是負的（比周圍暗）的像素，把它拉回周圍的亮度；
     壓暗筆：只作用在中頻層是正的（比周圍亮）的像素；
     每一下只加一點覆蓋（低流量），同一個地方越刷越接近完全修平，但絕對不會刷過頭；
     只改亮度、毛孔紋理（比中頻更細的那層）完全保留。
   覆蓋量存在分析尺寸（筆刷是平滑的，不需要原尺寸），一筆結束後把修掉的量從中頻層扣掉，
   下一筆接著刷就是對「現在的樣子」繼續修，不用重新分析整張。 */
export class DBStroke {
  acc: Float32Array;
  private kx: number; private ky: number;
  constructor(public W: number, public H: number, private band: DBBand, private sign: number) {
    this.acc = new Float32Array(band.W * band.H);
    this.kx = band.W / W; this.ky = band.H / H;
  }
  private samp(m: Float32Array, x: number, y: number) {
    const bw = this.band.W, bh = this.band.H;
    const fx = (x + 0.5) * this.kx - 0.5, fy = (y + 0.5) * this.ky - 0.5;
    const xa = clampI(Math.floor(fx), 0, bw - 1), xb = clampI(xa + 1, 0, bw - 1), ya = clampI(Math.floor(fy), 0, bh - 1), yb = clampI(ya + 1, 0, bh - 1);
    const tx = clampI(fx - xa, 0, 1), ty = clampI(fy - ya, 0, 1);
    return (m[ya * bw + xa] * (1 - tx) + m[ya * bw + xb] * tx) * (1 - ty) + (m[yb * bw + xa] * (1 - tx) + m[yb * bw + xb] * tx) * ty;
  }
  /** 這一筆要修掉的量：提亮只取比周圍暗的（負）、壓暗只取比周圍亮的（正） */
  private sel(m: number) { return this.sign > 0 ? Math.min(m, 0) : Math.max(m, 0); }
  /** 蓋一下（座標是工作尺寸）。flow＝每一下的覆蓋量（0～1）。回傳改到的範圍 */
  dab(dst: Uint8ClampedArray, src: Uint8ClampedArray, cx: number, cy: number, R: number, flow: number): Rect | null {
    const W = this.W, H = this.H, bw = this.band.W, bh = this.band.H, acc = this.acc;
    // 1. 覆蓋量（分析尺寸，柔邊筆刷，累積但最多 1）
    const bcx = cx * this.kx, bcy = cy * this.ky, bR = Math.max(1, R * this.kx), inv = 1 / (bR * bR), a = flow * 0.35;
    const bx0 = Math.max(0, Math.floor(bcx - bR)), by0 = Math.max(0, Math.floor(bcy - bR)), bx1 = Math.min(bw - 1, Math.ceil(bcx + bR)), by1 = Math.min(bh - 1, Math.ceil(bcy + bR));
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
      const dx = x - bcx, dy = y - bcy, t = (dx * dx + dy * dy) * inv;
      if (t >= 1) continue;
      const i = y * bw + x, f = (1 - t) * (1 - t);
      acc[i] = Math.min(1, acc[i] + a * f * (1 - acc[i]));   // 越接近 1 加得越少（像低流量筆一層一層疊）
    }
    // 2. 原尺寸像素：亮度乘上 exp(−覆蓋 × 要修掉的量)
    const x0 = Math.max(0, Math.floor(cx - R - 2)), y0 = Math.max(0, Math.floor(cy - R - 2));
    const x1 = Math.min(W - 1, Math.ceil(cx + R + 2)), y1 = Math.min(H - 1, Math.ceil(cy + R + 2));
    if (x1 < x0 || y1 < y0) return null;
    const mid = this.band.mid;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const c = this.samp(acc, x, y);
      if (c <= 0) continue;
      const v = this.sel(this.samp(mid, x, y));
      if (v === 0) continue;
      const o = (y * W + x) * 4, r = src[o], g = src[o + 1], b = src[o + 2];
      const Y = 0.299 * r + 0.587 * g + 0.114 * b;
      const ratio = Math.exp(-c * v), Y2 = (Y + 2) * ratio - 2;
      const cb = (b - Y) * 0.564 * ratio, cr = (r - Y) * 0.713 * ratio;
      dst[o] = Y2 + 1.402 * cr; dst[o + 1] = Y2 - 0.344136 * cb - 0.714136 * cr; dst[o + 2] = Y2 + 1.772 * cb;
    }
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  /** 一筆結束：把修掉的量從中頻層扣掉，下一筆就是對現在的樣子繼續修 */
  commit() {
    const mid = this.band.mid, acc = this.acc;
    for (let i = 0; i < acc.length; i++) if (acc[i] > 0) mid[i] -= acc[i] * this.sel(mid[i]);
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
