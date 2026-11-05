/* 點陣文字的演算法本體（不碰模型、不碰畫面）：主畫面和背景執行緒共用同一份，
   兩邊算出來逐像素相同。說明見 dotArt.ts。 */

export const BLANK = '⠀';

export type Cvs = HTMLCanvasElement | OffscreenCanvas;
/* 主畫面用一般畫布；背景執行緒（沒有 document）用 OffscreenCanvas —— 兩邊同一段程式、同樣的畫法 */
const make = (w: number, h: number): Cvs => (typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(w, h));
export const canvas = (w: number, h: number): Cvs => {
  const c = make(w, h);
  c.width = Math.max(1, Math.floor(w)); c.height = Math.max(1, Math.floor(h));
  return c;
};
export const ctx2d = (c: Cvs) => c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
/* 暫用畫布重複使用：拖滑桿時每一格都開新畫布的話，iPhone 有「所有畫布加起來」的上限，
   還沒被回收的舊畫布會把額度吃光 —— 之後新畫布畫不出東西，點陣區就整個黑掉。
   重新指定寬高會把內容與狀態清空，跟新開一張一樣。 */
const scratch = new Map<string, Cvs>();
export const scratchCanvas = (name: string, w: number, h: number): Cvs => {
  let c = scratch.get(name);
  if (!c) { c = make(1, 1); scratch.set(name, c); }
  c.width = Math.max(1, Math.floor(w)); c.height = Math.max(1, Math.floor(h));
  return c;
};

/* ── 2. 依明暗分布拉對比 ── */
export function stretchContrast(src: Cvs): Cvs {
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

/** 疊線：對比拉開的照片（base）乘上線稿（la）lines 次（色彩增值）。base 不會被改動 */
export function overlayLines(base: Cvs, la: Cvs | null, lines: number): Cvs {
  const c = canvas(base.width, base.height), g = ctx2d(c);
  g.drawImage(base, 0, 0);
  if (lines <= 0 || !la) return c;
  g.globalCompositeOperation = 'multiply';
  for (let i = 0; i < lines; i++) g.drawImage(la, 0, 0, base.width, base.height);
  g.globalCompositeOperation = 'source-over';
  return c;
}

export const LUMA = [0.2126, 0.7152, 0.0722];
export interface Eroded { L: Float32Array; W: number; H: number; srcW: number; srcH: number }
export function erodedLuma(src: Cvs, steps: number): Eroded {
  // 在 1000px 寬上做（線條粗細才跟照片原本多大無關），做完縮回原尺寸
  const work = scratchCanvas('erode', 1000, src.height / src.width * 1000), g = ctx2d(work);
  g.drawImage(src, 0, 0, work.width, work.height);
  const d = g.getImageData(0, 0, work.width, work.height).data, W = work.width, H = work.height, n = W * H;
  const cur = new Float32Array(n);
  const r0 = LUMA[0], g0 = LUMA[1], b0 = LUMA[2];
  for (let p = 0, i = 0; p < n; p++, i += 4) cur[p] = r0 * d[i] + g0 * d[i + 1] + b0 * d[i + 2];
  if (steps <= 0) return { L: cur, W, H, srcW: src.width, srcH: src.height };
  /* 黑色擴張：3×3 取最暗做 steps 次，等於一次取 (2·steps+1)×(2·steps+1) 範圍內最暗（邊緣一樣只看圖內），
     而且可分離：先橫向、再縱向。結果逐像素相同，只是少掃好幾遍 */
  const R = steps, tmp = new Float32Array(n);
  // 橫向：每一列內，前後各 R 點取最小
  for (let y = 0; y < H; y++) {
    const o = y * W;
    for (let x = 0; x < W; x++) {
      const a = x - R < 0 ? 0 : x - R, b = x + R >= W ? W - 1 : x + R;
      let m = cur[o + a];
      for (let k = o + a + 1; k <= o + b; k++) { const v = cur[k]; if (v < m) m = v; }
      tmp[o + x] = m;
    }
  }
  // 縱向：一整列一整列比（記憶體連續），上下各 R 列取最小
  for (let y = 0; y < H; y++) {
    const a = y - R < 0 ? 0 : y - R, b = y + R >= H ? H - 1 : y + R, o = y * W;
    cur.set(tmp.subarray(a * W, a * W + W), o);
    for (let r = a + 1; r <= b; r++) {
      const q = r * W;
      for (let x = 0; x < W; x++) { const v = tmp[q + x]; if (v < cur[o + x]) cur[o + x] = v; }
    }
  }
  return { L: cur, W, H, srcW: src.width, srcH: src.height };
}
export function thresholdEroded(e: Eroded, level: number): Cvs {
  const work = scratchCanvas('threshold', e.W, e.H), g = ctx2d(work), img = g.createImageData(e.W, e.H), d = img.data, off = 255 * level;
  for (let p = 0, i = 0; p < e.L.length; p++, i += 4) {
    const v = Math.max(0, Math.min(255, 256 * e.L[p] - off)) | 0;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const out = canvas(e.srcW, e.srcH);
  ctx2d(out).drawImage(work, 0, 0, out.width, out.height);
  return out;
}
export function thresholdAndThicken(src: Cvs, level: number, steps: number): Cvs { return thresholdEroded(erodedLuma(src, steps), level); }

/* ── 4b. 陰影版：亮度調整 → Atkinson 抖動（線性光空間） ── */
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.95 : Math.pow((v + 0.055) / 1.055, 2.4));
const toSrgb = (v: number) => (v <= 0.0031308 ? 12.95 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
export function ditherAt(src: Cvs, chars: number, brightness: number): Cvs {
  const c = scratchCanvas('dither', 2 * chars, Math.round(2 * chars * (src.height / src.width))), g = ctx2d(c);
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
export function toBraille(src: Cvs, level: number, chars: number): string[] {
  const rows = Math.ceil(2 * chars * (src.height / src.width) / 4);
  const c = scratchCanvas('braille', 2 * chars, 4 * rows), g = ctx2d(c);
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
export function trimAt(lines: string[]): { lines: string[]; left: number; top: number } | null {
  const lead = Math.min(...lines.map(l => l.length - l.replace(/^\u2800+/, '').length));
  const tail = Math.min(...lines.map(l => l.length - l.replace(/\u2800+$/, '').length));
  let out = lines.map(l => l.slice(lead, tail ? l.length - tail : l.length));
  if (!out.join('').replaceAll(BLANK, '').trim()) return null;
  let top = 0;
  while (!out[0].replaceAll(BLANK, '')) { out = out.slice(1); top++; }
  while (!out[out.length - 1].replaceAll(BLANK, '')) out = out.slice(0, -1);
  return { lines: out, left: lead, top };
}
export const trim = (lines: string[]) => trimAt(lines)?.lines ?? null;
