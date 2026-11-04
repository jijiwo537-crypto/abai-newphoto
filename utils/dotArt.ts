/* 圖片轉點陣文字（點字 Braille U+2800～U+28FF）
 *
 * 一格點字是 2×4 個點：照片縮成「字數×2」寬、「行數×4」高，每一格 8 個像素各自決定點亮或不亮。
 * 前處理（「自動」模式）：
 *   1. 依照片自己的明暗分布拉開對比（只看最暗、最亮那一小撮之外的範圍）。
 *   2. 用線稿模型畫出輪廓線，把輪廓線以「色彩增值」疊在拉好對比的照片上（疊越多次線越重）。
 *   3a. 線稿版：用一個明暗門檻轉成純黑白，再把黑色擴張幾次讓線變粗。
 *   3b. 陰影版：用 Atkinson 誤差擴散（在線性光空間）抖動成黑白點，保留灰階層次。
 *   4. 每一版各出三種大小（設定值的 0.6 倍、1 倍、1.3 倍）。
 * 全部是自己寫的實作；線稿模型是 Informative Drawings（Caroline Chan, MIT License）。 */

export interface DotArtSettings {
  /** 字數（寬度），1～200 */
  width: number;
  /** 明暗（0.01～0.99）：越大越亮 */
  threshold: number;
  /** 線條多寡：輪廓線疊幾次（0～20） */
  lines: number;
  /** 線條粗細：黑色擴張幾次（0～10） */
  thicken: number;
}
export const DOT_ART_DEFAULTS: DotArtSettings = { width: 50, threshold: 0.8, lines: 9, thicken: 2 };
/** 開啟陰影時明暗的預設值（粗細不適用） */
export const DOT_ART_SHADE_THRESHOLD = 0.65;

export interface DotArtResult { kind: 'line' | 'shade'; width: number; text: string; chars: number }

const BLANK = '⠀';
const MAX_INPUT_W = 768;

type Cvs = HTMLCanvasElement;
const canvas = (w: number, h: number): Cvs => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.floor(w)); c.height = Math.max(1, Math.floor(h));
  return c;
};
const ctx2d = (c: Cvs) => c.getContext('2d', { willReadFrequently: true })!;

/* ── 1. 讀圖：寬度最多 768，寬高裁成 4 的倍數（一格點字 4 列高） ── */
export async function prepareDotArtImage(file: Blob): Promise<Cvs> {
  let bmp = await createImageBitmap(file);
  if (bmp.width > MAX_INPUT_W) { const big = bmp; bmp = await createImageBitmap(file, { resizeWidth: MAX_INPUT_W }); big.close(); }
  let w = bmp.width, h = bmp.height;
  if (w > 20) { w -= w % 4; h -= h % 4; }
  const c = canvas(w, h);
  ctx2d(c).drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}

/* ── 2. 依明暗分布拉對比 ── */
function stretchContrast(src: Cvs): Cvs {
  const c = canvas(src.width, src.height), g = ctx2d(c);
  g.fillStyle = 'white'; g.fillRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data, n = c.width * c.height;
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < d.length; i += 4) hist[Math.round((d[i] + d[i + 1] + d[i + 2]) / 3)]++;
  // 每一階佔全圖的萬分之幾
  for (let i = 0; i < 256; i++) hist[i] = Math.round(hist[i] * 10000 / n);
  // 暗端：累積到萬分之 30，或單一階超過萬分之 2，就是起點
  let lo = 255;
  for (let i = 0, acc = 0; i < 256; i++) { acc += hist[i]; if (acc >= 30 || hist[i] > 2) { lo = i; break; } }
  // 亮端：從最亮往下找第一個超過萬分之 2 的階
  let hi = 0;
  for (let i = 255; i >= 0; i--) { if (hist[i] > 2) { hi = i; break; } }
  const map = (v: number) => (v <= lo ? 0 : v >= hi ? hi : (v - lo) / (hi - lo));
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 * map(d[i]); d[i + 1] = 255 * map(d[i + 1]); d[i + 2] = 255 * map(d[i + 2]); d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/* ── 3. 線稿模型（背景執行緒） ── */
let worker: Worker | null = null, seq = 0, mode: 'gpu' | 'cpu' | null = null;
const pending = new Map<number, { msg: any; transfer: Transferable[]; res: (v: any) => void; rej: (e: any) => void }>();
const modelUrl = () => new URL(`${(import.meta as any).env?.BASE_URL || '/'}models/line-art.onnx`, location.href).href;
const gpuLikely = () => { try { return !!(navigator as any).gpu && !(globalThis as any).__dotArtCpu; } catch { return false; } };
let gpuTimer = 0, gpuLoaded = false;
const armGpuTimer = () => { clearTimeout(gpuTimer); gpuTimer = window.setTimeout(() => { if (mode === 'gpu') toCpu('timeout'); }, 25000); };
/** GPU 那支換成 CPU 那支，沒完成的工作原樣重送 */
function toCpu(why: string) {
  console.warn('line art: falling back to CPU', why);
  clearTimeout(gpuTimer); worker?.terminate(); spawn('cpu');
  for (const [id, q] of pending) worker!.postMessage({ ...q.msg, id, modelUrl: modelUrl() });
}
function spawn(m: 'gpu' | 'cpu') {
  mode = m; gpuLoaded = false;
  worker = m === 'gpu'
    ? new Worker(new URL('./lineArtGpu.worker.ts', import.meta.url), { type: 'module' })
    : new Worker(new URL('./lineArt.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = e => {
    const p = pending.get(e.data.id); if (!p) return;
    if (!e.data.ok && mode === 'gpu') { toCpu(e.data.error); return; }   // GPU 那支不能用（資料送出前已經複製一份）
    if (mode === 'gpu' && e.data.data) clearTimeout(gpuTimer);   // GPU 真的交出結果了
    if (mode === 'gpu' && e.data.loadMs !== undefined && !gpuLoaded) {   // 模型載好（含自我檢查）才開始計推論時間
      gpuLoaded = true;
      if ([...pending.values()].some(q => q.msg.type === 'run')) armGpuTimer();
    }
    pending.delete(e.data.id); e.data.ok ? p.res(e.data) : p.rej(new Error(e.data.error));
  };
  worker.onerror = e => {
    if (mode === 'gpu') { toCpu('worker error'); return; }
    for (const p of pending.values()) p.rej(e); pending.clear(); worker?.terminate(); worker = null; mode = null;
  };
}
const call = (msg: any) => new Promise<any>((res, rej) => {
  if (!worker) { spawn(gpuLikely() ? 'gpu' : 'cpu'); if (mode === 'gpu' && msg.type !== 'warm') call({ type: 'warm' }).catch(() => {}); }
  const id = ++seq;
  // 保留一份原始資料：GPU 失敗改走 CPU 時要重送（轉移所有權後原本那份就不能用了）
  const keep = msg.data ? { ...msg, data: (msg.data as Float32Array).slice() } : msg;
  pending.set(id, { msg: keep, transfer: [], res, rej });
  /* GPU 卡住或比 CPU 還慢（少數裝置的 GPU 驅動）：推論 25 秒還沒交出結果就改用 CPU。
     只算推論本身（下載模型的時間不算，網路慢不會誤判） */
  if (mode === 'gpu' && msg.type === 'run' && gpuLoaded) armGpuTimer();
  worker!.postMessage({ ...msg, id, modelUrl: modelUrl() }, msg.data ? [(msg.data as Float32Array).buffer] : []);
});
/** 先把模型載好（打開工具就開始下載，按「產生」時就不用等） */
export const warmLineArtModel = () => call({ type: 'warm' }).catch(() => {});
/** 目前用的是 GPU 還是 CPU（測試用） */
export const lineArtMode = () => mode;

const lineArtCache = new WeakMap<Cvs, Cvs>();
async function lineArt(src: Cvs): Promise<Cvs> {
  const hit = lineArtCache.get(src); if (hit) return hit;
  const w = src.width, h = src.height, px = ctx2d(src).getImageData(0, 0, w, h).data, plane = w * h;
  const input = new Float32Array(plane * 3);
  for (let i = 0, p = 0; p < plane; i += 4, p++) { input[p] = px[i] / 255; input[plane + p] = px[i + 1] / 255; input[2 * plane + p] = px[i + 2] / 255; }
  const out = await call({ type: 'run', data: input, width: w, height: h });
  (globalThis as any).__dotArtTiming = { wait: out.waitMs, run: out.runMs, ep: out.ep, w, h };
  const ow = out.width, oh = out.height, v = out.data as Float32Array;
  const c = canvas(ow, oh), g = ctx2d(c), img = g.createImageData(ow, oh), d = img.data;
  for (let p = 0, i = 0; p < v.length; p++, i += 4) { const x = 255 * v[p]; d[i] = x; d[i + 1] = x; d[i + 2] = x; d[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  lineArtCache.set(src, c);
  return c;
}

/** 拉好對比的照片 × 輪廓線（色彩增值疊 lines 次） */
async function preprocess(src: Cvs, lines: number): Promise<Cvs> {
  const base = stretchContrast(src);
  if (lines <= 0) return base;   // 不疊線：用不到線稿模型
  const la = await lineArt(src);
  const c = canvas(base.width, base.height), g = ctx2d(c);
  g.drawImage(base, 0, 0);
  g.globalCompositeOperation = 'multiply';
  for (let i = 0; i < lines; i++) g.drawImage(la, 0, 0, base.width, base.height);
  g.globalCompositeOperation = 'source-over';
  return c;
}

/* ── 4a. 線稿版：明暗門檻 → 黑色擴張 ── */
const LUMA = [0.2126, 0.7152, 0.0722];
function thresholdAndThicken(src: Cvs, level: number, steps: number): Cvs {
  // 在 1000px 寬上做（線條粗細才跟照片原本多大無關），做完縮回原尺寸
  const work = canvas(1000, src.height / src.width * 1000), g = ctx2d(work);
  g.drawImage(src, 0, 0, work.width, work.height);
  const img = g.getImageData(0, 0, work.width, work.height), d = img.data, W = work.width, H = work.height;
  // 亮度（Rec.709）× 256 − 255 × level：亮度高於 level 一點點就全白，低於就全黑
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, 256 * (LUMA[0] * d[i] + LUMA[1] * d[i + 1] + LUMA[2] * d[i + 2]) - 255 * level)) | 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  // 黑色擴張：每次取 3×3 範圍內最暗的那一點
  let cur = d, next = new Uint8ClampedArray(d.length);
  for (let s = 0; s < steps; s++) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let m = 255;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; const v = cur[(yy * W + xx) * 4]; if (v < m) m = v; } }
      const o = (y * W + x) * 4; next[o] = next[o + 1] = next[o + 2] = m; next[o + 3] = cur[o + 3];
    }
    const t = cur; cur = next; next = t as Uint8ClampedArray;
  }
  if (cur !== d) d.set(cur);
  g.putImageData(img, 0, 0);
  const out = canvas(src.width, src.height);
  ctx2d(out).drawImage(work, 0, 0, out.width, out.height);
  return out;
}

/* ── 4b. 陰影版：亮度調整 → Atkinson 抖動（線性光空間） ── */
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.95 : Math.pow((v + 0.055) / 1.055, 2.4));
const toSrgb = (v: number) => (v <= 0.0031308 ? 12.95 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
function ditherAt(src: Cvs, chars: number, brightness: number): Cvs {
  const c = canvas(2 * chars, Math.round(2 * chars * (src.height / src.width))), g = ctx2d(c);
  g.fillStyle = 'white'; g.fillRect(0, 0, c.width, c.height);
  g.filter = `brightness(${brightness})`;
  g.drawImage(src, 0, 0, c.width, c.height);
  g.filter = 'none';
  const W = c.width, H = c.height, img = g.getImageData(0, 0, W, H), d = img.data;
  const L = new Float32Array(W * H);
  for (let p = 0, i = 0; p < L.length; p++, i += 4) L[p] = 0.21 * toLinear(d[i] / 255) + 0.72 * toLinear(d[i + 1] / 255) + 0.07 * toLinear(d[i + 2] / 255);
  // Atkinson：誤差的 1/8 各給右邊兩格、下一列左中右三格、再下一列正下方（共 6/8，其餘丟掉）
  const taps: [number, number][] = [[1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x, old = L[p], q = old > 0.5 ? 1 : 0, err = old - q;
    L[p] = q;
    for (const [dx, dy] of taps) { const xx = x + dx, yy = y + dy; if (xx >= 0 && xx < W && yy < H) L[yy * W + xx] += err / 8; }
  }
  for (let p = 0, i = 0; p < L.length; p++, i += 4) { const v = 255 * toSrgb(L[p]); d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  return c;
}

/* ── 5. 轉成點字 ── */
/* 一格 2×4 的點對應 Unicode 點字的 8 個位元：左欄由上而下是 1、2、3、7 號點，右欄是 4、5、6、8 號點 */
const DOT_BITS = [[0, 3], [1, 4], [2, 5], [6, 7]];   // [列][欄] → 位元
function toBraille(src: Cvs, level: number, chars: number): string[] {
  const rows = Math.ceil(2 * chars * (src.height / src.width) / 4);
  const c = canvas(2 * chars, 4 * rows), g = ctx2d(c);
  g.drawImage(src, 0, 0, c.width, c.height);
  const W = c.width, d = g.getImageData(0, 0, W, c.height).data, lines: string[] = [];
  for (let y = 0; y < c.height; y += 4) {
    let line = '';
    for (let x = 0; x < W; x += 2) {
      let code = 0;
      for (let r = 0; r < 4; r++) for (let k = 0; k < 2; k++) {
        const i = ((y + r) * W + x + k) * 4;
        if ((d[i] + d[i + 1] + d[i + 2]) / 3 < level) code |= 1 << DOT_BITS[r][k];
      }
      line += String.fromCharCode(0x2800 + code);
    }
    lines.push(line);
  }
  return lines;
}
/** 左右共同的空白欄、上下的空白列都收掉；整張空白回 null */
function trim(lines: string[]): string[] | null {
  const lead = Math.min(...lines.map(l => l.length - l.replace(/^⠀+/, '').length));
  const tail = Math.min(...lines.map(l => l.length - l.replace(/⠀+$/, '').length));
  let out = lines.map(l => l.slice(lead, tail ? l.length - tail : l.length));
  if (!out.join('').replaceAll(BLANK, '').trim()) return null;
  while (!out[0].replaceAll(BLANK, '')) out = out.slice(1);
  while (!out[out.length - 1].replaceAll(BLANK, '')) out = out.slice(0, -1);
  return out;
}

/** 反轉：每一格的 8 個點亮暗互換 */
export const invertDotArt = (text: string) =>
  Array.from(text, ch => { const c = ch.charCodeAt(0); return c >= 0x2800 && c <= 0x28ff ? String.fromCharCode(0x2800 + (0xff ^ (c - 0x2800))) : ch; }).join('');

/** 一張圖的全部結果：陰影版在前、線稿版在後，各三種大小 */
export async function generateDotArt(src: Cvs, s: DotArtSettings, onStep?: (label: string) => void): Promise<{ preview: Cvs; results: DotArtResult[] }> {
  const pre = await preprocess(src, s.lines);
  const sizes = [Math.round(0.6 * s.width), s.width, Math.round(1.3 * s.width)];
  const groups: DotArtResult[][] = [];
  // 線稿版
  const thr = s.threshold || 0.5;
  const line = thresholdAndThicken(pre, Math.round(255 * (1 - thr)), s.thicken);
  const lineRes: DotArtResult[] = [];
  for (const w of sizes) {
    onStep?.(`線稿 ${w} 字`);
    await new Promise(r => setTimeout(r, 0));
    const t = trim(toBraille(line, 128, w));
    if (t) { const text = t.join('\n'); lineRes.push({ kind: 'line', width: w, text, chars: text.length }); }
  }
  groups.push(lineRes);
  // 陰影版
  const shadeRes: DotArtResult[] = [];
  for (const w of sizes) {
    onStep?.(`陰影 ${w} 字`);
    await new Promise(r => setTimeout(r, 0));
    const t = trim(toBraille(ditherAt(pre, w, 2 * s.threshold), 128, w));
    if (t) { const text = t.join('\n'); shadeRes.push({ kind: 'shade', width: w, text, chars: text.length }); }
  }
  groups.unshift(shadeRes);
  return { preview: pre, results: groups.flat() };
}

/* ── 即時預覽用：同一張圖的各階段各留一份，拖滑桿時只重算變了的那一段 ──
   線稿模型只跑一次；「線條多寡」變了才重疊；「明暗／粗細」變了才重做門檻；「大小」只重排點字。 */
export class DotArtSession {
  private pre = new Map<number, Cvs>();
  private line = new Map<string, Cvs>();
  /** 線稿模型跑完了沒（跑完之前先用「不疊線」的版本頂著，不用乾等） */
  modelReady = false;
  constructor(readonly src: Cvs) {}
  /** 背景跑線稿模型（第一次比較久） */
  async prepare() { await lineArt(this.src); this.modelReady = true; }
  private async preFor(lines: number) {
    let c = this.pre.get(lines);
    if (!c) { c = await preprocess(this.src, lines); if (this.pre.size > 6) this.pre.clear(); this.pre.set(lines, c); }
    return c;
  }
  /** 主要的那一張：kind＝線稿或陰影，大小用設定值 */
  async render(kind: 'line' | 'shade', s0: DotArtSettings): Promise<string | null> {
    const s = this.modelReady ? s0 : { ...s0, lines: 0 };
    const pre = await this.preFor(s.lines);
    let img: Cvs;
    if (kind === 'line') {
      const level = Math.round(255 * (1 - (s.threshold || 0.5))), key = `${s.lines}|${level}|${s.thicken}`;
      let c = this.line.get(key);
      if (!c) { c = thresholdAndThicken(pre, level, s.thicken); if (this.line.size > 12) this.line.clear(); this.line.set(key, c); }
      img = c;
    } else img = ditherAt(pre, s.width, 2 * s.threshold);
    const t = trim(toBraille(img, 128, s.width));
    return t ? t.join('\n') : null;
  }
}
