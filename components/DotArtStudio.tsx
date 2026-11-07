/* 點陣文字：照片轉成可以複製貼上的點字圖案（演算法見 utils/dotArt）
   版面跟美顏同一套：上面成品（黑底白點、即時更新、可以用手指畫點／擦點），
   預覽下緣懸空放換照片、線稿／陰影、反轉；下面一塊滑桿和一排工具；右上角複製、儲存成圖片。 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Copy, Check, Plus } from 'lucide-react';
import { Icon } from './Icon';
import { Glyph } from './Glyph';
import { SaveButton } from './SaveButton';
import { BusySpinner } from './BusySpinner';
import { ExportActionLift } from './ExportActionLift';
import { SLIDER_RELEASE_EVENT, sliderHeld } from '../utils/sliderTouch';
import { useStandaloneToolViewport, standaloneToolViewportCSS } from '../utils/useStandaloneToolViewport';
import { DOT_ART_DEFAULTS, DOT_ART_SHADE_THRESHOLD, DotArtSession, prepareDotArtImage, warmLineArtModel, type DotArtFrame, type DotArtSettings, curveT, CURVE_N } from '../utils/dotArt';

type Kind = 'line' | 'shade';
type ToolId = 'width' | 'threshold' | 'lines' | 'spacing' | 'glow' | 'draw' | 'erase';
interface ToolDef { id: ToolId; label: string; glyph: React.ReactNode; min: number; max: number }
/* 數量＝橫向幾個字（越多點越多、越細）；輪廓＝照片裡的輪廓線描出多少；間距＝點幾個一組排。
   圖示沿用其他功能的同名工具：數量＝特效的「數量」、間距＝多格拼圖描邊的「間距」、明暗＝調節的亮度、
   筆刷＝人像修容、擦除＝遮色片的擦除；輪廓用空心星星；發光＝一顆亮點加兩圈光暈 */
const TOOLS: ToolDef[] = [
  { id: 'width', label: '數量', glyph: <Icon name="apps" className="text-xl" />, min: 0, max: 100 },
  { id: 'threshold', label: '明暗', glyph: <Icon name="light_mode" className="text-xl" />, min: 0, max: 100 },
  { id: 'lines', label: '輪廓', glyph: <Icon name="star_outline" className="text-xl" />, min: 0, max: 20 },
  { id: 'spacing', label: '間距', glyph: <Glyph k="gap" size={20} />, min: 1, max: 8 },
  { id: 'glow', label: '發光', glyph: <Icon name="dot_glow" className="text-xl" />, min: 0, max: 100 },
  { id: 'draw', label: '筆刷', glyph: <Icon name="brush" className="text-xl" />, min: 1, max: 8 },
  { id: 'erase', label: '擦除', glyph: <Glyph k="erase" size={20} />, min: 1, max: 8 },
];
/** 數量滑桿看起來是 0～100，實際是 40～100 個字（0 → 40 字、100 → 100 字；40 字＝以前滑桿的 25） */
const WIDTH_MIN = 40, WIDTH_MAX = 100;
const widthOf = (v: number) => Math.round(WIDTH_MIN + (WIDTH_MAX - WIDTH_MIN) * Math.round(v) / 100);
const sliderOfWidth = (w: number) => (w - WIDTH_MIN) / (WIDTH_MAX - WIDTH_MIN) * 100;
/** 滑桿是連續的（拖起來不會一格一格），算圖時才取到該有的刻度 */
const snap = (id: ToolId, v: number) => (id === 'threshold' ? Math.round(v * 1000) / 1000 : Math.round(v));

/* 明暗滑桿：算法照網站（門檻值 0.01～0.99），但滑桿位置改成「點亮的點有多少」平均分布。
   照網站原本的刻度，偏暗或偏亮的照片有一大段滑桿完全沒變化（點全滿／全空），看起來像沒反應；
   現在依這張照片算出的對照表換算，滑桿每一段都會改變點的多寡。預設值還是網站的 0.80（結果一模一樣）。 */
/** 對照表 → 滑桿刻度：每一段的寬度＝一半看點的多寡變了多少、一半平均分給「有變化的範圍」；
    頭尾整段都是全滿或全空（怎麼調都一樣）的部分寬度是 0。回傳每個取樣點在滑桿上的位置（0～1） */
const scaleOf = (c: Float32Array): Float64Array | null => {
  const N = c.length, first = c[0], last = c[N - 1];
  if (Math.abs(first - last) < 1e-4) return null;
  let a = 0, b = N - 1;
  while (a < N - 1 && Math.abs(c[a + 1] - first) < 1e-6) a++;   // 開頭不會變的那一段
  while (b > 0 && Math.abs(c[b - 1] - last) < 1e-6) b--;         // 結尾不會變的那一段
  const total = Math.abs(last - first), segs = Math.max(1, b - a), w = new Float64Array(N);
  for (let k = 1; k < N; k++) {
    const active = k > a && k <= b;
    w[k] = w[k - 1] + (active ? 0.5 * Math.abs(c[k] - c[k - 1]) / total + 0.5 / segs : 0);
  }
  const end = w[N - 1] || 1;
  for (let k = 0; k < N; k++) w[k] /= end;
  return w;
};
/** 明暗值 → 滑桿位置（0～100） */
const posOfT = (c: Float32Array | null, t: number) => {
  const w = c && scaleOf(c);
  if (!w) return (t - 0.01) / 0.98 * 100;
  const x = Math.max(0, Math.min(CURVE_N - 1, (t - 0.01) / 0.98 * (CURVE_N - 1))), i = Math.min(CURVE_N - 2, Math.floor(x)), f = x - i;
  return (w[i] * (1 - f) + w[i + 1] * f) * 100;
};
/** 滑桿位置（0～100）→ 明暗值 */
const tOfPos = (c: Float32Array | null, p: number) => {
  const w = c && scaleOf(c), q = p / 100;
  if (!w) return 0.01 + 0.98 * q;
  for (let k = 1; k < CURVE_N; k++) if (w[k] >= q && w[k] > w[k - 1]) {
    const f = (q - w[k - 1]) / (w[k] - w[k - 1]);
    return curveT(k - 1) + (curveT(k) - curveT(k - 1)) * Math.max(0, Math.min(1, f));
  }
  return q <= 0 ? 0.01 : 0.99;
};

/* 點字 ⇄ 點陣：每格 8 個位元對應的位置 [欄, 列] */
const POS = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [0, 3], [1, 3]];
const BIT_AT = [[0, 3], [1, 4], [2, 5], [6, 7]];   // [列][欄] → 位元

/* 點的排法照參考網站實際顯示的樣子量出來：一個字寬 1、高 1.532；點是方的，邊長 0.19 個字寬。
   點會「幾個一組」排：組內靠近、組與組之間空多一點（網站是橫向 2 個一組、直向 4 個一組）。
   組數可以調；組內：組間的距離比固定（橫向 9.5:14、直向 8:12，都是從網站量的），平均點距不變，
   所以整張大小、比例不會因為調間距而改變。 */
const CH = 1.532, DOT = 0.19;
/** 預覽下緣懸空那一排（換照片／線稿陰影／反轉）佔的高度：點陣畫在它上面，手指畫點時不會被按鈕擋到 */
const BOTTOM_ROW = 68;
const RX = 9.5 / 14, RY = 8 / 12;
/** 平均點距（字寬）：橫向一個字 2 點、直向一個字高 4 點；筆刷半徑以兩者的幾何平均當一格 */
const PITCH_X = 0.5, PITCH_Y = CH / 4, PITCH = Math.sqrt(PITCH_X * PITCH_Y);
/** 筆刷半徑（點距）：跟著滑桿連續變（不取整數），調大小時中間的圈平滑地變大變小 */
const brushRad = (v: number) => Math.max(0.5, v - 0.5);
/** 一個方向上每個點的中心位置（以字寬／字高為單位）。n＝點數、cells＝格數、per＝每格幾點、g＝幾點一組、phase＝分組起點 */
const axis = (n: number, cells: number, per: number, g: number, r: number, phase: number) => {
  const p = 1 / per, sIn = g * p / (g - 1 + 1 / r), extra = sIn / r - sIn, pos = new Float64Array(n);
  for (let i = 0; i < n; i++) pos[i] = i * sIn + Math.floor((i + phase) / g) * extra - Math.floor(phase / g) * extra;
  const off = (cells - (n > 1 ? pos[n - 1] : 0)) / 2;
  for (let i = 0; i < n; i++) pos[i] += off;
  return { pos, minStep: g > 1 ? sIn : p };
};
/* 橫向的組以「字和字的交界」為中心（網站 2 個一組時是相鄰兩個字的欄靠在一起）；直向的組對齊每個字 */
const layoutFor = (W: number, H: number, gx: number, gy: number) => ({
  x: axis(W, W / 2, 2, gx, RX, Math.floor(gx / 2)),
  y: axis(H, H / 4, 4, gy, RY, 0),
});
type Layout = ReturnType<typeof layoutFor>;
/** 手指位置（字寬／字高為單位）→ 連續的點座標（點中心在 i＋0.5），點距不平均也對得準 */
const toAxis = (u: number, pos: Float64Array) => {
  const n = pos.length; if (n < 2) return 0.5;
  let lo = 0, hi = n - 1;
  if (u <= pos[0]) return 0.5 + (u - pos[0]) / (pos[1] - pos[0]);
  if (u >= pos[n - 1]) return n - 0.5 + (u - pos[n - 1]) / (pos[n - 1] - pos[n - 2]);
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pos[m] <= u) lo = m; else hi = m; }
  return lo + 0.5 + (u - pos[lo]) / (pos[hi] - pos[lo]);
};

/** 整張照片的點陣（W＝字數×2、H＝列數×4），1＝有點 */
interface Bits { W: number; H: number; d: Uint8Array }
const textToBits = (f: DotArtFrame, invert: boolean): Bits => {
  const W = f.cols * 2, H = f.rows * 4, d = new Uint8Array(W * H);
  const lines = f.text.split('\n'), cols = Math.max(0, ...lines.map(l => l.length));
  for (let y = 0; y < lines.length; y++) {
    const l = lines[y];
    for (let x = 0; x < cols; x++) {
      let code = x < l.length ? l.charCodeAt(x) - 0x2800 : 0;
      if (code < 0 || code > 0xff) code = 0;
      if (invert) code ^= 0xff;   // 反轉只翻成品的範圍（跟網站一樣，四周收掉的空白不翻）
      if (!code) continue;
      for (let k = 0; k < 8; k++) if (code & (1 << k)) d[((f.top + y) * 4 + POS[k][1]) * W + (f.left + x) * 2 + POS[k][0]] = 1;
    }
  }
  return { W, H, d };
};
/** 點陣 → 點字文字（收掉四周空白）；全空白回傳 null */
const bitsToText = (b: Bits): { text: string; x0: number; y0: number; cols: number; rows: number } | null => {
  const C = b.W / 2, R = b.H / 4, codes = new Uint8Array(C * R);
  let x0 = C, x1 = -1, y0 = R, y1 = -1;
  for (let y = 0; y < b.H; y++) for (let x = 0; x < b.W; x++) if (b.d[y * b.W + x]) {
    const cx = x >> 1, cy = y >> 2;
    codes[cy * C + cx] |= 1 << BIT_AT[y & 3][x & 1];
    if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
  }
  if (x1 < 0) return null;
  const rows: string[] = [];
  for (let y = y0; y <= y1; y++) {
    let s = '';
    for (let x = x0; x <= x1; x++) s += String.fromCharCode(0x2800 + codes[y * C + x]);
    rows.push(s);
  }
  return { text: rows.join('\n'), x0, y0, cols: x1 - x0 + 1, rows: y1 - y0 + 1 };
};
/** 把點陣畫上去（ox, oy 是畫布上原點的位置、cw/ch 是一個字的寬高） */
const drawDots = (g: CanvasRenderingContext2D, b: Bits, L: Layout, cw: number, ch: number, ox: number, oy: number, x0 = 0, y0 = 0, x1 = b.W, y1 = b.H) => {
  const sz = Math.max(0.6, cw * DOT), h = sz / 2, px = L.x.pos, py = L.y.pos;
  for (let y = y0; y < y1; y++) {
    const row = y * b.W, cy = oy + py[y] * ch - h;
    for (let x = x0; x < x1; x++) if (b.d[row + x]) g.rect(ox + px[x] * cw - h, cy, sz, sz);
  }
};

/* ── 發光：直接從「哪些點亮著」算出光暈，不去縮放畫好的圖 ──
   以前是把畫好的點一層層縮小再放大（很快，但放大時是一格一格的直線內插，近看光暈邊緣有一圈圈斷層）。
   現在：
     1. 每個亮點的面積分到一張細格子上（每格 1/4 個字寬，用小數精確分配到相鄰四格）；
     2. 用三種大小的高斯模糊（0.3、0.6、1.2 個字寬）疊成光暈：近的亮、遠的淡，跟真的光一樣一路漸淡；
     3. 亮度用「1 − e^(−x)」平滑收頂（密的地方不會硬切成一片白）；
     4. 轉成 8 位元時加一點點雜訊（dither），最暗那一段不會出現一階一階的色帶。
   全部是小格子上的加減（幾十萬格），手機上幾毫秒；光暈大小跟著字寬走，預覽與存出來的圖看起來一樣。
   滑桿只改這一層的透明度，不用重算。最大值＝最早版本的 72%（滑桿照樣是 0～100）。 */
const GLOW_CELL = 0.25;          // 格子大小（字寬）
const GLOW_PAD = 4;              // 四周多留幾個字寬（光暈最外圈約 3 個標準差，不會被切掉）
const GLOW_SIGMAS = [0.3, 0.6, 1.2]; // 三層光暈的大小（字寬）
const GLOW_WEIGHTS = [0.5, 0.3, 0.2];
const GLOW_GAIN = 12;            // 點很細，平均下來很淡，先放大再平滑收頂
const GLOW_MAX = 0.72;      // 滑桿拉滿＝最早版本的 72（滑桿照樣顯示 0～100）
/** 三次方塊模糊 ≈ 高斯：每次的半徑 */
const boxRadii = (sigma: number) => {
  const n = 3, wIdeal = Math.sqrt(12 * sigma * sigma / n + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const wu = wl + 2, m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return [0, 1, 2].map(i => ((i < m ? wl : wu) - 1) / 2);
};
/** 橫向方塊模糊（滑動總和，界外當 0） */
const boxH = (src: Float32Array, dst: Float32Array, W: number, H: number, r: number) => {
  const inv = 1 / (2 * r + 1);
  for (let y = 0, o = 0; y < H; y++, o += W) {
    let acc = 0;
    for (let i = 0; i <= r && i < W; i++) acc += src[o + i];
    for (let i = 0; i < W; i++) {
      dst[o + i] = acc * inv;
      if (i + r + 1 < W) acc += src[o + i + r + 1];
      if (i - r >= 0) acc -= src[o + i - r];
    }
  }
};
/** 縱向方塊模糊：一整列一整列加減（記憶體連續，比一行一行跳著讀快很多） */
const boxV = (src: Float32Array, dst: Float32Array, W: number, H: number, r: number, acc: Float32Array) => {
  const inv = 1 / (2 * r + 1);
  acc.fill(0, 0, W);
  for (let y = 0; y <= r && y < H; y++) { const o = y * W; for (let x = 0; x < W; x++) acc[x] += src[o + x]; }
  for (let y = 0; y < H; y++) {
    const o = y * W;
    for (let x = 0; x < W; x++) dst[o + x] = acc[x] * inv;
    if (y + r + 1 < H) { const q = (y + r + 1) * W; for (let x = 0; x < W; x++) acc[x] += src[q + x]; }
    if (y - r >= 0) { const q = (y - r) * W; for (let x = 0; x < W; x++) acc[x] -= src[q + x]; }
  }
};
const gaussInPlace = (a: Float32Array, tmp: Float32Array, W: number, H: number, sigma: number, acc: Float32Array) => {
  for (const r of boxRadii(sigma)) { if (r <= 0) continue; boxH(a, tmp, W, H, r); boxV(tmp, a, W, H, r, acc); }
};
/** 縮成一半（2×2 平均，總光量不變） */
const half = (src: Float32Array, W: number, H: number, dst: Float32Array) => {
  const w = W >> 1, h = H >> 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = 2 * y * W + 2 * x;
    dst[y * w + x] = 0.25 * (src[i] + src[i + 1] + src[i + W] + src[i + W + 1]);
  }
  return { w, h };
};
/** 小格子的值用雙線性內插放大 f 倍，乘上 k 加進 dst（格子中心對齊） */
const addUp = (src: Float32Array, w: number, h: number, f: number, dst: Float32Array, W: number, H: number, k: number) => {
  for (let y = 0; y < H; y++) {
    const fy = Math.min(h - 1, Math.max(0, (y + 0.5) / f - 0.5)), y0 = Math.min(h - 2, Math.floor(fy)), ty = fy - y0;
    const r0 = Math.max(0, y0) * w, r1 = Math.min(h - 1, y0 + 1) * w, o = y * W;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(w - 1, Math.max(0, (x + 0.5) / f - 0.5)), x0 = Math.min(w - 2, Math.floor(fx)), tx = fx - x0;
      const a = src[r0 + x0], b = src[r0 + x0 + 1], c = src[r1 + x0], d = src[r1 + x0 + 1];
      dst[o + x] += k * ((a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty);
    }
  }
};
/** 平滑收頂 255·(1 − e^(−GAIN·x)) 先算成表（中間線性內插，誤差遠小於 1/255） */
const GLOW_LUT_N = 2048, GLOW_LUT_K = GLOW_LUT_N / (8 / GLOW_GAIN);
const GLOW_LUT = Float32Array.from({ length: GLOW_LUT_N }, (_, k) => 255 * (1 - Math.exp(-GLOW_GAIN * k / GLOW_LUT_K)));
/** 光暈用的暫存（每次大小一樣就沿用，畫點時每一格都要算一次，不用一直配新的記憶體）。
    雜訊是固定的（每次一樣，畫點時光暈不會閃） */
let glowMem: { n: number; base: Float32Array; field: Float32Array; tmp: Float32Array; m1: Float32Array; m2: Float32Array; acc: Float32Array; noise: Float32Array; img: ImageData | null } | null = null;
const glowBuf = (n: number, W: number) => {
  if (!glowMem || glowMem.n !== n || glowMem.acc.length < W) {
    const noise = new Float32Array(n); let seed = 12345;
    for (let i = 0; i < n; i++) { seed = (seed * 1103515245 + 12345) >>> 0; noise[i] = seed / 4294967296 - 0.5; }
    glowMem = { n, base: new Float32Array(n), field: new Float32Array(n), tmp: new Float32Array(n), m1: new Float32Array(n >> 2), m2: new Float32Array(n >> 4), acc: new Float32Array(W), noise, img: null };
  }
  return glowMem;
};
/** 算光暈：回傳一張小畫布（白色、透明度＝光的強度）和它對應的位置（以字寬為單位，含四周 GLOW_PAD） */
const glowField = (b: Bits, L: Layout, out?: HTMLCanvasElement) => {
  const C = b.W / 2, R = b.H / 4, g = GLOW_CELL;
  const W = Math.ceil((C + 2 * GLOW_PAD) / g), H = Math.ceil((R * CH + 2 * GLOW_PAD) / g), n = W * H;
  const buf = glowBuf(n, W), base = buf.base, field = buf.field, tmp = buf.tmp, acc = buf.acc;
  base.fill(0); field.fill(0);
  const area = DOT * DOT / (g * g), px = L.x.pos, py = L.y.pos;
  for (let y = 0; y < b.H; y++) {
    const fy = (py[y] * CH + GLOW_PAD) / g - 0.5, y0 = Math.floor(fy), ty = fy - y0, row = y * b.W;
    if (y0 < 0 || y0 + 1 >= H) continue;
    for (let x = 0; x < b.W; x++) {
      if (!b.d[row + x]) continue;
      const fx = (px[x] + GLOW_PAD) / g - 0.5, x0 = Math.floor(fx), tx = fx - x0;
      if (x0 < 0 || x0 + 1 >= W) continue;
      const i = y0 * W + x0;
      base[i] += area * (1 - tx) * (1 - ty); base[i + 1] += area * tx * (1 - ty);
      base[i + W] += area * (1 - tx) * ty; base[i + W + 1] += area * tx * ty;
    }
  }
  /* 三層光暈：小的兩層在細格子上接著模糊（中的從小的再模糊上去）；最大那層先縮成 1/2 的格子再模糊
     （大的光暈本來就很柔，放在粗一點的格子上算結果幾乎一樣，但快很多），最後雙線性放大加回細格子 */
  const [s0, s1, s2] = GLOW_SIGMAS.map(x => x / g), [w0, w1, w2] = GLOW_WEIGHTS;
  const A = half(base, W, H, buf.m1);                 // 1/2 格子（模糊前先留一份原始的）
  gaussInPlace(buf.m1, tmp, A.w, A.h, Math.sqrt(Math.max(0, (s2 / 2) ** 2 - 0.25)), acc);
  gaussInPlace(base, tmp, W, H, s0, acc);
  for (let i = 0; i < n; i++) field[i] = w0 * base[i];
  gaussInPlace(base, tmp, W, H, Math.sqrt(s1 * s1 - s0 * s0), acc);
  for (let i = 0; i < n; i++) field[i] += w1 * base[i];
  addUp(buf.m1, A.w, A.h, 2, field, W, H, w2);
  const c = out || document.createElement('canvas');
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const gc = c.getContext('2d')!;
  if (!buf.img || buf.img.width !== W || buf.img.height !== H) { buf.img = gc.createImageData(W, H); buf.img.data.fill(255); }
  const d = buf.img.data, noise = buf.noise;
  for (let i = 0, j = 3; i < n; i++, j += 4) {
    const v = field[i] * GLOW_LUT_K, k = v | 0;
    const a = (k >= GLOW_LUT_N - 1 ? 255 : GLOW_LUT[k] + (GLOW_LUT[k + 1] - GLOW_LUT[k]) * (v - k)) + noise[i];
    d[j] = a <= 0 ? 0 : a >= 255 ? 255 : (a + 0.5) | 0;
  }
  gc.putImageData(buf.img, 0, 0);
  return { c, cell: g, pad: GLOW_PAD };
};

/** 一筆畫改到哪些點：位置、改之前、改之後（復原／重做只記差異，不用每筆存一整張） */
interface Step { key: string; idx: number[]; before: number[]; after: number[]; set?: undefined }
/** 滑桿的一步：調之前、調之後的所有滑桿值（數量、明暗、輪廓、間距、發光），連在哪一種（線稿／陰影）調的也記著 */
interface Snap { kind: Kind; raw: Record<Kind, DotArtSettings>; gap: { x: number; y: number }; glow: number }
interface SetStep { set: true; before: Snap; after: Snap }
type HistStep = Step | SetStep;
const sameSnap = (a: Snap, b: Snap) => a.glow === b.glow && a.gap.x === b.gap.x && a.gap.y === b.gap.y &&
  (['line', 'shade'] as const).every(k => a.raw[k].width === b.raw[k].width && a.raw[k].threshold === b.raw[k].threshold && a.raw[k].lines === b.raw[k].lines);

export function DotArtStudio({ onClose, initialFiles }: { onClose: () => void; initialFiles: File[] }) {
  const viewport = useStandaloneToolViewport();
  const [kind, setKind] = useState<Kind>('line');
  /* 兩種各記各的明暗：線稿 0.80、陰影 0.65（陰影要亮一點才看得出層次） */
  const [raw, setRaw] = useState<Record<Kind, DotArtSettings>>({
    line: { ...DOT_ART_DEFAULTS, width: sliderOfWidth(DOT_ART_DEFAULTS.width) },
    shade: { ...DOT_ART_DEFAULTS, width: sliderOfWidth(DOT_ART_DEFAULTS.width), threshold: DOT_ART_SHADE_THRESHOLD },
  });
  /* 間距：橫向、直向各幾個點一組（只改點的排法，不改點字內容） */
  const [gap, setGap] = useState({ x: 2, y: 4 });
  const gx = Math.round(gap.x), gy = Math.round(gap.y);
  const [brush, setBrush] = useState(2);
  /* 調筆刷大小時，預覽正中間顯示一個空心圓＝實際筆刷大小（跟美顏的修容筆一樣） */
  const [sizingBrush, setSizingBrush] = useState(false);
  useEffect(() => { const off = () => setSizingBrush(false); window.addEventListener(SLIDER_RELEASE_EVENT, off); return () => window.removeEventListener(SLIDER_RELEASE_EVENT, off); }, []);
  /* 發光：0＝不發光（預設），只影響畫面與存成的圖片，複製的點字文字不受影響 */
  const [glow, setGlow] = useState(0);
  const glowOn = glow > 0.5;
  const glowOnRef = useRef(glowOn); glowOnRef.current = glowOn;
  const [tool, setTool] = useState<ToolId>('width');
  const [frame, setFrame] = useState<DotArtFrame | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [modelReady, setModelReady] = useState(false);
  const [rendered, setRendered] = useState(false);   // 完整的點陣算出第一張了沒
  const [photo, setPhoto] = useState<string>('');
  /* 網站是白底黑點（點＝暗的地方）。這裡是黑底白點，要看起來一樣就要反轉（點＝亮的地方、暗的地方是空的） */
  const [inverted, setInverted] = useState(true);
  const [copied, setCopied] = useState(false);
  const session = useRef<DotArtSession | null>(null);
  const input = useRef<HTMLInputElement>(null);

  /* ── 手畫的點：跟著「線稿／陰影＋數量」存（同一個點陣大小），調明暗、輪廓時畫過的點都還在 ── */
  const edits = useRef(new Map<string, Uint8Array>());   // 每個點：1＝點亮、2＝擦掉、0＝照算出來的
  const undoStack = useRef<HistStep[]>([]);
  const redoStack = useRef<HistStep[]>([]);
  const [histTick, setHistTick] = useState(0);

  const busy = useRef(false), shown = useRef('');
  const open = useCallback(async (file: File) => {
    setStatus('loading'); setFrame(null); setModelReady(false); setRendered(false);
    edits.current.clear(); undoStack.current = []; redoStack.current = []; if (setTx.current) { clearTimeout(setTx.current.timer); setTx.current = null; } setHistTick(t => t + 1);
    curves.current.clear(); thrPos.current = null;
    try {
      const c = await prepareDotArtImage(file);
      setPhoto(c.toDataURL('image/jpeg', 0.8));
      const s = new DotArtSession(c);
      s.onCurve = (key, curve) => { if (session.current === s) { curves.current.set(key, curve); setCurveTick(t => t + 1); } };
      session.current = s; shown.current = '';
      setStatus('ready');   // 先出「不疊線」的版本，線稿模型在背景跑
      // 線稿模型跑完才開始出點陣（不先出暫時的版本）；模型失敗就直接出「不疊線」的版本，不會一直轉圈
      s.prepare().then(() => { if (session.current === s) { shown.current = ''; setModelReady(true); } })
        .catch(e => { console.error('dot art model', e); if (session.current === s) setModelReady(true); });
    } catch (e) { console.error('dot art', e); setStatus('error'); }
  }, []);
  useEffect(() => { warmLineArtModel(); if (initialFiles[0]) open(initialFiles[0]); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  /* 即時重算：同一時間只算一張，拖動中來的新值等這張算完直接算最新的（中間的跳過） */
  const settings: DotArtSettings = {
    width: widthOf(raw[kind].width), threshold: snap('threshold', raw[kind].threshold),
    lines: snap('lines', raw[kind].lines), thicken: DOT_ART_DEFAULTS.thicken,
  };
  const want = `${kind}|${settings.width}|${settings.threshold}|${settings.lines}|${modelReady}`;
  const otherKind: Kind = kind === 'line' ? 'shade' : 'line';
  const otherSettings: DotArtSettings = {
    width: widthOf(raw[otherKind].width), threshold: snap('threshold', raw[otherKind].threshold),
    lines: snap('lines', raw[otherKind].lines), thicken: DOT_ART_DEFAULTS.thicken,
  };
  const wantRef = useRef({ key: want, kind, settings, otherKind, otherSettings });
  wantRef.current = { key: want, kind, settings, otherKind, otherSettings };
  const [editKey, setEditKey] = useState('');
  /** 明暗對照表：每個「線稿／陰影＋輪廓」一份（換照片時清掉） */
  const curves = useRef(new Map<string, Float32Array>());
  const [, setCurveTick] = useState(0);
  /** 拖明暗時滑桿停在手指的位置（不從換算回來的值反推，免得滑桿抖） */
  const thrPos = useRef<{ key: string; t: number; p: number } | null>(null);
  const pump = useCallback(async () => {
    const s = session.current;
    if (!s || busy.current) return;
    busy.current = true;
    try {
      while (shown.current !== wantRef.current.key) {
        const job = wantRef.current;
        const r = await s.renderWithCurve(job.kind, job.settings);
        if (session.current !== s) return;
        shown.current = job.key;
        setFrame(r.frame); setEditKey(`${job.kind}|${job.settings.width}`); setRendered(true);
        await new Promise(r => requestAnimationFrame(() => r(null)));
      }
    } finally { busy.current = false; }
    /* 停下來 0.4 秒後，先把另一種（線稿／陰影）照它目前的設定算好：切過去時直接拿現成的 */
    clearTimeout(prewarmTimer.current);
    prewarmTimer.current = window.setTimeout(async () => {
      const s2 = session.current, j = wantRef.current;
      if (!s2 || s2 !== s || busy.current || shown.current !== j.key) return;
      busy.current = true;
      try { await s2.renderWithCurve(j.otherKind, j.otherSettings, true); } catch { /* 只是預先算，失敗就等真的切過去再算 */ }
      finally { busy.current = false; }
      if (session.current === s2 && shown.current !== wantRef.current.key) pumpRef.current();
    }, 400);
  }, []);
  const prewarmTimer = useRef(0);
  const pumpRef = useRef(pump); pumpRef.current = pump;
  useEffect(() => () => clearTimeout(prewarmTimer.current), []);
  /* 切線稿／陰影：先讓按鈕亮起來（畫面先更新一次），再開始算，按下去不會頓一下 */
  const lastKind = useRef(kind);
  useEffect(() => {
    if (!(status === 'ready' && modelReady)) return;
    if (lastKind.current === kind) { pump(); return; }
    lastKind.current = kind;
    let t = 0;
    const r = requestAnimationFrame(() => { t = window.setTimeout(pump, 0); });
    return () => { cancelAnimationFrame(r); clearTimeout(t); };
  }, [want, status, modelReady, pump]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* 算出來的點陣（含反轉）＋手畫的點＝畫面上的點陣 */
  const baseBits = useMemo(() => (frame ? textToBits(frame, inverted) : null), [frame, inverted]);
  const bits = useMemo(() => {
    if (!baseBits) return null;
    const m = edits.current.get(editKey);
    if (!m || m.length !== baseBits.d.length) return { ...baseBits, d: baseBits.d.slice() };
    const d = baseBits.d.slice();
    for (let i = 0; i < d.length; i++) if (m[i]) d[i] = m[i] === 1 ? 1 : 0;
    return { W: baseBits.W, H: baseBits.H, d };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseBits, editKey, histTick]);
  const bitsRef = useRef(bits); bitsRef.current = bits;
  const out = useMemo(() => (bits ? bitsToText(bits) : null), [bits]);
  const finalText = out?.text ?? null;

  /* 成品直接畫點（不靠字型），任何裝置看起來都一樣。
     框固定是「整張照片的點陣」那麼大，拖滑桿時畫面不會跳、不會變比例 */
  const box = useRef<HTMLDivElement>(null), cvs = useRef<HTMLCanvasElement>(null);
  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const b = box.current; if (!b) return;
    const upd = () => setBoxSize({ w: b.clientWidth, h: b.clientHeight });
    upd(); const ro = new ResizeObserver(upd); ro.observe(b); return () => ro.disconnect();
  }, []);
  const layout = useMemo(() => (bits ? layoutFor(bits.W, bits.H, gx, gy) : null), [bits?.W, bits?.H, gx, gy]);   // eslint-disable-line react-hooks/exhaustive-deps
  const layoutRef = useRef(layout); layoutRef.current = layout;
  const geom = useRef({ cw: 1, ch: CH, C: 0, R: 0, dpr: 1 });
  /* 發光那一層：放在點的後面，大小比點陣多出一圈（光暈會超出最外面的點） */
  const glowCvs = useRef<HTMLCanvasElement>(null);
  const paintGlow = useCallback(() => {
    const c = cvs.current, o = glowCvs.current, b = bitsRef.current, L = layoutRef.current;
    if (!c || !o) return;
    if (!glowOnRef.current || !b || !L || !c.width || !c.height) { if (o.width) { o.width = o.height = 0; } return; }
    const { cw } = geom.current, G = glowField(b, L, o);
    o.style.left = `${-G.pad * cw}px`; o.style.top = `${-G.pad * cw}px`;
    o.style.width = `${o.width * G.cell * cw}px`; o.style.height = `${o.height * G.cell * cw}px`;
  }, []);
  const paint = useCallback((b: Bits | null, L: Layout | null) => {
    const c = cvs.current; if (!c) return;
    if (!b || !L || !boxSize.w || !boxSize.h) { c.width = c.height = 0; return; }
    const C = b.W / 2, R = b.H / 4;
    const cw = Math.min((boxSize.w - 32) / C, (boxSize.h - 16 - BOTTOM_ROW) / (R * CH)), ch = cw * CH;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    geom.current = { cw, ch, C, R, dpr };
    const W = C * cw, H = R * ch;
    c.style.width = `${W}px`; c.style.height = `${H}px`;
    const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
    if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
    const g = c.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    g.fillStyle = '#fff'; g.beginPath();
    drawDots(g, b, L, cw, ch, 0, 0);
    g.fill();
    paintGlow();
  }, [boxSize, paintGlow]);
  useLayoutEffect(() => { paint(bits, layout); }, [bits, layout, paint]);
  /* 發光從 0 拉起來時才建那一層（之後拖滑桿只改透明度）；拉回 0 就放掉 */
  useLayoutEffect(() => { paintGlow(); }, [glowOn, paintGlow]);

  /* ── 畫筆：只改點陣、只重畫改到的格子（每一下都重排整張字、重畫整張，在手機上會卡到分頁被關掉） ── */
  const drawing = tool === 'draw' || tool === 'erase';
  const stroke = useRef<{ last: [number, number] | null; changed: Map<number, number>; dirty: Set<number>; raf: number } | null>(null);
  const flush = () => {
    const s = stroke.current, c = cvs.current, b = bitsRef.current, L = layoutRef.current;
    if (!s || !c || !b || !L) return;
    s.raf = 0;
    const { cw, ch, dpr } = geom.current;
    /* 只擦、只畫改到的點：擦的範圍比點大一點（含反鋸齒的邊），但碰不到隔壁的點 */
    const sz = Math.max(0.6, cw * DOT), room = Math.min(L.x.minStep * cw, L.y.minStep * ch) - sz;
    const h = sz / 2 + Math.max(0, Math.min(1.5 / dpr + 0.5, room * 0.45));
    const g = c.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#fff'; g.beginPath();
    s.dirty.forEach(i => {
      const x = i % b.W, y = (i - x) / b.W, cx = L.x.pos[x] * cw, cy = L.y.pos[y] * ch;
      g.clearRect(cx - h, cy - h, 2 * h, 2 * h);
      if (b.d[i]) g.rect(cx - sz / 2, cy - sz / 2, sz, sz);
    });
    g.fill(); s.dirty.clear();
    glowSoon();
  };
  /* 畫點時光暈不用每一格都重算：點先畫上去，光暈最多每 60ms 跟上一次，放開手指時一定補上最後一次 */
  const glowTimer = useRef(0), glowAt = useRef(0);
  const glowSoon = () => {
    if (!glowOnRef.current || glowTimer.current) return;
    const wait = Math.max(0, 60 - (performance.now() - glowAt.current));
    glowTimer.current = window.setTimeout(() => { glowTimer.current = 0; glowAt.current = performance.now(); paintGlow(); }, wait);
  };
  useEffect(() => () => clearTimeout(glowTimer.current), []);
  const dab = (px: number, py: number) => {
    const s = stroke.current, b = bitsRef.current;
    if (!s || !b) return;
    let m = edits.current.get(editKey);
    if (!m || m.length !== b.d.length) { m = new Uint8Array(b.d.length); edits.current.set(editKey, m); }
    /* 筆刷在畫面上是正圓（橫向點距 0.5 字寬、直向 0.383 字寬不一樣，換算成畫面距離再比），
       跟調大小時中間那個圈一樣大 */
    const rad = brushRad(brush), v = tool === 'draw' ? 1 : 2;
    const kx = PITCH_X / PITCH, ky = PITCH_Y / PITCH, rx = rad / kx, ry = rad / ky;
    for (let y = Math.floor(py - ry); y <= Math.ceil(py + ry); y++) for (let x = Math.floor(px - rx); x <= Math.ceil(px + rx); x++) {
      if (x < 0 || y < 0 || x >= b.W || y >= b.H) continue;
      if (Math.hypot((x + 0.5 - px) * kx, (y + 0.5 - py) * ky) > rad) continue;
      const i = y * b.W + x;
      if (m[i] === v) continue;
      if (!s.changed.has(i)) s.changed.set(i, m[i]);
      m[i] = v; b.d[i] = v === 1 ? 1 : 0;
      s.dirty.add(i);
    }
  };
  const toDot = (ev: React.PointerEvent): [number, number] => {
    const r = cvs.current!.getBoundingClientRect(), gm = geom.current, L = layoutRef.current;
    if (!L) return [NaN, NaN];
    return [toAxis((ev.clientX - r.left) / gm.cw, L.x.pos), toAxis((ev.clientY - r.top) / gm.ch, L.y.pos)];
  };
  const onMove = (ev: React.PointerEvent) => {
    const s = stroke.current; if (!s) return;
    const [x, y] = toDot(ev);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (s.last) {   // 兩次事件之間補點，快速劃過也是連續的線
      const [lx, ly] = s.last, n = Math.min(400, Math.max(1, Math.ceil(Math.hypot(x - lx, y - ly) / 0.5)));
      for (let i = 1; i <= n; i++) dab(lx + (x - lx) * i / n, ly + (y - ly) * i / n);
    } else dab(x, y);
    s.last = [x, y];
    if (s.dirty.size && !s.raf) s.raf = requestAnimationFrame(flush);
  };
  const onDown = (ev: React.PointerEvent) => {
    if (!drawing || !bits || stroke.current) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    stroke.current = { last: null, changed: new Map(), dirty: new Set(), raf: 0 };
    onMove(ev);
  };
  const onUp = () => {
    const s = stroke.current; if (!s) return;
    commitSet();
    if (s.raf) cancelAnimationFrame(s.raf);
    flush(); stroke.current = null;
    clearTimeout(glowTimer.current); glowTimer.current = 0; paintGlow();
    if (s.changed.size) {
      const m = edits.current.get(editKey)!, idx = [...s.changed.keys()];
      undoStack.current.push({ key: editKey, idx, before: idx.map(i => s.changed.get(i)!), after: idx.map(i => m[i]) });
      if (undoStack.current.length > 300) undoStack.current.shift();
      redoStack.current = [];
    }
    setHistTick(t => t + 1);
  };
  /* ── 滑桿也進復原／重做：按下去（或第一次動）先記下原本的值，放開手（或停 0.4 秒）才記成一步 ── */
  const snapRef = useRef<Snap>({ kind, raw, gap, glow });
  snapRef.current = { kind, raw, gap, glow };
  const setTx = useRef<{ before: Snap; timer: number } | null>(null);
  const commitSet = () => {
    const tx = setTx.current; if (!tx) return;
    clearTimeout(tx.timer); setTx.current = null;
    const after = snapRef.current;
    if (sameSnap(tx.before, after)) return;
    undoStack.current.push({ set: true, before: tx.before, after: { ...after, kind: tx.before.kind } });
    if (undoStack.current.length > 300) undoStack.current.shift();
    redoStack.current = [];
    setHistTick(t => t + 1);
  };
  const commitSoon = () => {
    const tx = setTx.current; if (!tx) return;
    clearTimeout(tx.timer);
    tx.timer = window.setTimeout(function wait() {
      if (sliderHeld()) { if (setTx.current) setTx.current.timer = window.setTimeout(wait, 200); return; }
      commitSet();
    }, 400);
  };
  /** 每次滑桿要改值之前叫這個 */
  const beginSet = () => {
    if (!setTx.current) setTx.current = { before: snapRef.current, timer: 0 };
    commitSoon();
  };
  useEffect(() => {
    const onRelease = () => { if (setTx.current) window.setTimeout(commitSet, 0); };
    window.addEventListener(SLIDER_RELEASE_EVENT, onRelease);
    return () => { window.removeEventListener(SLIDER_RELEASE_EVENT, onRelease); if (setTx.current) clearTimeout(setTx.current.timer); };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const applySnap = (v: Snap) => {
    thrPos.current = null;
    setRaw(v.raw); setGap(v.gap); setGlow(v.glow); setKind(v.kind);
  };
  const travel = (from: typeof undoStack, to: typeof undoStack, redo: boolean) => {
    commitSet();
    const step = from.current.pop(); if (!step) return;
    if (step.set) applySnap(redo ? step.after : step.before);
    else {
      const m = edits.current.get(step.key);
      if (m) step.idx.forEach((i, j) => { m[i] = redo ? step.after[j] : step.before[j]; });
    }
    to.current.push(step);
    setHistTick(t => t + 1);
  };

  const copy = async () => {
    if (!finalText) return;
    try { await navigator.clipboard.writeText(finalText); }
    catch {
      const t = document.createElement('textarea'); t.value = finalText; t.style.position = 'fixed'; t.style.top = '0';
      document.body.appendChild(t); t.focus(); t.select(); try { document.execCommand('copy'); } catch { /* 無法複製 */ } t.remove();
    }
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  /* ── 儲存成圖片：同樣的點、同樣的排法，畫成高解析 PNG（無損） ── */
  const [exportUrl, setExportUrl] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => () => { if (exportUrl) URL.revokeObjectURL(exportUrl); }, [exportUrl]);
  const save = async () => {
    const b = bits, o = out, L = layout;
    if (!b || !o || !L || saving) return;
    setSaving(true);
    try {
      /* 存成去背的 PNG：背景完全透明，只有白點（不透明）和光暈（白色、透明度＝光的強度），
         放到任何顏色的背景上都跟這裡看到的一樣自然，邊緣不會有黑邊或白邊。
         只存有點的範圍（跟複製的文字同一塊），四周各留一個字寬（有發光時留三個字寬，光暈才不會被切掉） */
      const x0 = o.x0 * 2, x1 = (o.x0 + o.cols) * 2, y0 = o.y0 * 4, y1 = (o.y0 + o.rows) * 4;
      const spanX = L.x.pos[x1 - 1] - L.x.pos[x0], spanY = L.y.pos[y1 - 1] - L.y.pos[y0];
      const M = glowOn ? 3 : 1;
      const cw = Math.max(4, Math.min(32, 4096 / (spanX + 2 * M), 4096 / (spanY * CH + 2 * M))), ch = cw * CH;
      const c = document.createElement('canvas');
      c.width = Math.round(spanX * cw + 2 * M * cw); c.height = Math.round(spanY * ch + 2 * M * cw);
      /* 光暈在下、點在上，疊在透明的畫布上 */
      const dots = document.createElement('canvas'); dots.width = c.width; dots.height = c.height;
      const gd = dots.getContext('2d')!;
      gd.fillStyle = '#fff'; gd.beginPath();
      drawDots(gd, b, L, cw, ch, M * cw - L.x.pos[x0] * cw, M * cw - L.y.pos[y0] * ch, x0, y0, x1, y1);
      gd.fill();
      const g = c.getContext('2d')!;
      if (glowOn) {
        const G = glowField(b, L), ox = M * cw - L.x.pos[x0] * cw, oy = M * cw - L.y.pos[y0] * ch;
        g.globalAlpha = GLOW_MAX * Math.min(1, glow / 100); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
        g.drawImage(G.c, ox - G.pad * cw, oy - G.pad * cw, G.c.width * G.cell * cw, G.c.height * G.cell * cw);
        g.globalAlpha = 1;
        G.c.width = G.c.height = 0;
      }
      g.drawImage(dots, 0, 0); dots.width = dots.height = 0;
      const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/png'));
      c.width = c.height = 0;
      if (blob) setExportUrl(URL.createObjectURL(blob));
    } finally { setSaving(false); }
  };

  const cur = TOOLS.find(t => t.id === tool) || TOOLS[0];
  const isBrush = cur.id === 'draw' || cur.id === 'erase';
  const curveKey = `${kind}|${settings.lines}|${settings.width}`, curve = curves.current.get(curveKey) ?? null;
  const thrNow = raw[kind].threshold;
  const thrSlider = thrPos.current && thrPos.current.key === curveKey && thrPos.current.t === thrNow ? thrPos.current.p : posOfT(curve, thrNow);
  const value = isBrush ? brush : cur.id === 'spacing' ? 0 : cur.id === 'glow' ? glow : cur.id === 'threshold' ? thrSlider : raw[kind][cur.id as keyof DotArtSettings];
  const setValue = (v: number) => {
    if (isBrush) { setBrush(v); return; }   // 筆刷大小是工具設定，不算一步
    beginSet();
    if (cur.id === 'glow') setGlow(v);
    else if (cur.id === 'threshold') {
      const t = Math.max(0.01, Math.min(0.99, snap('threshold', tOfPos(curve, v))));
      thrPos.current = { key: curveKey, t, p: v };
      setRaw(r => ({ ...r, [kind]: { ...r[kind], threshold: t } }));
    }
    else setRaw(r => ({ ...r, [kind]: { ...r[kind], [cur.id]: v } }));
  };
  /* 一列滑桿：名稱｜滑桿｜數值（跟美顏同一款） */
  const sliderRow = (label: string, min: number, max: number, v: number, shown: string, set: (v: number) => void, sizing = false) => (
    <div className="flex items-center gap-3 h-6" key={label}>
      <span className="text-[10px] font-bold tracking-[0.15em] text-white/40 w-12 shrink-0">{label}</span>
      <div className="slider-wrap flex-1" style={{ height: 16 }}>
        <input type="range" aria-label={label} min={min} max={max} step="any" value={v}
          onChange={e => set(Number(e.target.value))} className="premium-slider w-full"
          onPointerDown={sizing ? () => setSizingBrush(true) : undefined}
          onPointerUp={sizing ? () => setSizingBrush(false) : undefined}
          onPointerCancel={sizing ? () => setSizingBrush(false) : undefined}
          onBlur={sizing ? () => setSizingBrush(false) : undefined} />
      </div>
      <span className="text-[11px] font-mono tabular-nums text-white/80 w-8 text-right shrink-0">{shown}</span>
    </div>
  );

  return (
    <div ref={viewport.ref} data-dot-art-studio
      className={`safe-top relative w-full h-[100dvh] bg-[#080808] z-[60] flex flex-col font-sans text-white overflow-hidden select-none ${viewport.standalone ? 'standalone-tool-viewport' : ''}`}>
      <style>{standaloneToolViewportCSS}</style>
      <header className="h-14 relative flex items-center justify-between px-4 shrink-0 bg-black/40 backdrop-blur-xl z-20">
        <div className="w-28">
          <button aria-label="返回" onClick={onClose} className="p-2 -ml-2 text-[#aaa] hover:text-white transition-colors active:scale-90"><ChevronLeft size={22} /></button>
        </div>
        <div className="flex items-center gap-4" data-hist={histTick}>
          <button aria-label="復原" title="復原" onClick={() => travel(undoStack, redoStack, false)} disabled={!undoStack.current.length}
            className={`p-2 transition-all ${undoStack.current.length ? 'opacity-100 active:scale-90' : 'opacity-20 pointer-events-none'}`}><Icon name="undo" className="text-xl" /></button>
          <button aria-label="重做" title="重做" onClick={() => travel(redoStack, undoStack, true)} disabled={!redoStack.current.length}
            className={`p-2 transition-all ${redoStack.current.length ? 'opacity-100 active:scale-90' : 'opacity-20 pointer-events-none'}`}><Icon name="redo" className="text-xl" /></button>
        </div>
        <div className="w-28 flex items-center justify-end gap-1 shrink-0">
          {/* 複製文字：只有圖示，按下後換成打勾 */}
          <button aria-label={copied ? '已複製' : '複製'} onClick={copy} disabled={!finalText}
            className="p-2 text-white active:scale-90 transition-transform disabled:opacity-30">
            {copied ? <Check size={19} strokeWidth={2.4} /> : <Copy size={19} strokeWidth={2} />}
          </button>
          <button onClick={save} disabled={!finalText}
            className="bg-white text-black px-4 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider shadow-lg active:scale-95 transition-transform whitespace-nowrap disabled:opacity-30">
            儲存
          </button>
        </div>
      </header>
      <input ref={input} hidden type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) open(f); }} />

      {/* 成品：黑底白點；筆刷／擦除時手指直接在上面畫 */}
      <div ref={box} className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden bg-black" style={{ paddingBottom: BOTTOM_ROW - 16 }}>
        {status === 'error' && <p className="absolute text-[12px] text-white/60">無法處理這張照片</p>}
        <div className={`relative ${status === 'ready' && rendered && bits ? '' : 'hidden'}`}>
          <canvas ref={glowCvs} data-dot-art-glow aria-hidden className="absolute pointer-events-none"
            style={{ opacity: GLOW_MAX * Math.min(1, glow / 100), display: glowOn ? 'block' : 'none' }} />
          <canvas ref={cvs} data-dot-art-canvas className="relative block"
            style={{ touchAction: drawing ? 'none' : 'auto' }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
        </div>
        {rendered && finalText && <pre data-dot-art-text hidden>{finalText}</pre>}
        {/* 筆刷大小的空心圓：固定在點陣正中間，大小＝實際筆刷（用 DOM 畫，邊緣平滑） */}
        {sizingBrush && isBrush && bits && (() => {
          const bx = box.current?.getBoundingClientRect(), cr = cvs.current?.getBoundingClientRect();
          if (!bx || !cr || !cr.width) return null;
          /* 圈再小也至少 8px（框線 2px，太小時框線會把圈撐大、看起來偏到右下）；用中心點定位，大小怎麼變都在正中間 */
          const D = Math.max(8, 2 * brushRad(brush) * PITCH * geom.current.cw);
          const cx = cr.left - bx.left + cr.width / 2, cy = cr.top - bx.top + cr.height / 2;
          return <div data-dot-brush-ring className="absolute pointer-events-none z-20 rounded-full border-2 border-white"
            style={{ left: cx, top: cy, width: D, height: D, transform: 'translate(-50%, -50%)' }} />;
        })()}
        {status === 'ready' && rendered && !frame && <p className="absolute text-[12px] text-white/50">畫面全空白，調一下明暗</p>}
        {/* 生成中：只有正中間一個轉圈（跟仿色同一款），完整的點陣出來之前不顯示任何點 */}
        {(status === 'loading' || (status === 'ready' && !rendered)) && (
          <div data-dot-art-refining className="absolute inset-0 flex items-center justify-center pointer-events-none" role="status" aria-label="生成中">
            {/* 偵測輪廓（第一次要跑模型，比較久）時一句一句換，停在最後一句；生成點陣很快，只有一句 */}
            {status === 'ready' && modelReady
              ? <React.Fragment key="gen"><BusySpinner text="正在生成點陣圖" /></React.Fragment>
              : <React.Fragment key="detect"><BusySpinner text="正在偵測輪廓" texts={['正在偵測輪廓', '分析明暗層次', '描繪線條細節', '整理點陣排列']} hold /></React.Fragment>}
          </div>
        )}
        {/* 左下：目前的照片，點一下換一張；右下：反轉 */}
        <button aria-label="換一張照片" onClick={() => input.current?.click()}
          className="absolute left-4 bottom-3 w-11 h-11 rounded-xl overflow-hidden bg-white/10 active:scale-95">
          {photo && <img src={photo} alt="" className="w-full h-full object-cover" />}
          <span className="absolute right-0.5 bottom-0.5 w-4 h-4 rounded-full bg-white text-black flex items-center justify-center"><Plus size={11} strokeWidth={3} /></span>
        </button>
        {/* 反轉：跟創意拼圖的隨機圖案鍵同一款，只有圖示 */}
        <button aria-label="反轉" aria-pressed={inverted} onClick={() => setInverted(v => !v)}
          className="absolute right-2 bottom-1 p-3 bg-transparent border-0 text-white active:scale-90 transition-transform flex items-center justify-center select-none"
          style={{ filter: 'drop-shadow(0 1px 0.5px rgba(0,0,0,.5))' }}>
          <Glyph k="invert" size={24} />
        </button>
        {/* 線稿／陰影：懸空在預覽下緣中間，跟左下的照片同一排 */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 h-11 flex items-center gap-2">
          {(['line', 'shade'] as const).map(k => (
            <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k}
              className={`px-3.5 py-1 rounded-full text-[11px] shrink-0 border transition-all active:scale-95 ${kind === k ? 'bg-white text-black border-white font-bold' : 'bg-black/40 text-white/60 border-white/15 backdrop-blur-md'}`}>
              {k === 'line' ? '線稿' : '陰影'}
            </button>
          ))}
        </div>
      </div>

      {/* 滑桿區：只放滑桿（間距有橫向、直向兩根），高度固定，切工具時圖片不會跳 */}
      <div className="h-[84px] shrink-0 border-t border-white/[0.06] px-5 flex flex-col justify-center gap-3" data-dot-art-controls>
        {cur.id === 'spacing' ? (<>
          {sliderRow('橫向', 1, 8, gap.x, String(gx), v => { beginSet(); setGap(g => ({ ...g, x: v })); })}
          {sliderRow('直向', 1, 8, gap.y, String(gy), v => { beginSet(); setGap(g => ({ ...g, y: v })); })}
        </>) : sliderRow(isBrush ? '筆刷' : cur.label, cur.min, cur.max, value,
          String(Math.round(value)), setValue, isBrush)}
      </div>

      {/* 工具列：跟美顏同一款（64px 按鈕列＋12px 底部距離） */}
      <div className="border-t border-white/10 bg-black shrink-0" data-dot-art-toolbar>
        <div className="flex h-16 pb-3 box-content">
          {TOOLS.map(t => (
            <button key={t.id} onClick={() => setTool(t.id)}
              className={`flex-1 flex flex-col items-center justify-center gap-1 transition-colors ${cur.id === t.id ? 'text-white' : 'text-white/20'}`}>
              <span className="h-5 flex items-center justify-center">{t.glyph}</span>
              <span className="text-[9px] font-black uppercase tracking-[0.15em]">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 儲存預覽：跟藝術效果同一套（存到相簿／繼續編輯） */}
      {exportUrl && (
        <div data-export-screen className="absolute inset-0 z-[110] bg-black flex flex-col" role="dialog" aria-modal="true" aria-label="儲存預覽">
          <ExportActionLift />
          <header className="h-14 shrink-0 px-5 flex items-center bg-black/40 backdrop-blur-xl">
            <button aria-label="返回" onClick={() => setExportUrl('')} className="p-2 -ml-2 text-[#888]"><ChevronLeft size={22} /></button>
          </header>
          <div data-export-media className="flex-1 min-h-0 flex items-center justify-center p-6">
            <img className="allow-callout max-w-[80vw] max-h-[60vh] object-contain rounded" style={{ boxShadow: '0 0 0 1px #ffffff1a' }} src={exportUrl} alt="匯出預覽" />
          </div>
          <footer data-export-actions className="flex flex-col gap-3 px-6 pt-2 pb-6">
            <SaveButton urls={[exportUrl]} />
            <div className="flex gap-4">
              <button onClick={() => setExportUrl('')} className="flex-1 h-14 rounded-full border border-white/20 bg-white/5 text-sm font-bold">繼續編輯</button>
              <button onClick={() => { setExportUrl(''); input.current?.click(); }} className="flex-1 h-14 rounded-full border border-white/20 bg-white/5 text-sm font-bold">換一張照片</button>
            </div>
          </footer>
        </div>
      )}
    </div>
  );
}
