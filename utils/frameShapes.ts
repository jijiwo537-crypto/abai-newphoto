/* 圖形分類「邊框」：全部都是「一整張照片的框」，一放進來就跟底圖一樣大。
   霧白邊框是一張平滑的遮罩（見 mistFrame.ts）；其他五種是向量畫的：
     集中線：動漫那種很有張力的框 —— 一大圈大小、長短都不一樣的尖刺，從框邊往中間刺進去；
     底片：上下兩條片邊，一格一格的齒孔；
     拍立得：四邊等寬，下面特別厚；
     蕾絲花邊：一圈邊框，內緣是一顆一顆的半圓花邊，中間再鏤空一排小圓點；
     筆刷邊框：像用粗筆刷隨手刷出來的邊，內緣不規則。
   共用的旋鈕只有「範圍」（框有多厚／尖刺刺多深）；顏色跟著圖形顏色，紋理只疊在框上。
   形狀用固定的亂數種子算，所以每一格、每一次打開都長得一樣。 */
import { MIST_FRAME_KIND, paintMistFrame, MIST_RANGE_DEFAULT, type MistParams } from './mistFrame';

export const FRAME_SPEED = 'frame-speed';
export const FRAME_FILM = 'frame-film';
export const FRAME_POLAROID = 'frame-polaroid';
export const FRAME_LACE = 'frame-lace';
export const FRAME_BRUSH = 'frame-brush';

/** 邊框分類裡的全部（圖形選單上的順序） */
export const FRAME_ITEMS = [
  { id: MIST_FRAME_KIND, kind: MIST_FRAME_KIND, filled: true, label: '霧白邊框' },
  { id: FRAME_SPEED, kind: FRAME_SPEED, filled: true, label: '集中線' },
  { id: FRAME_FILM, kind: FRAME_FILM, filled: true, label: '底片' },
  { id: FRAME_POLAROID, kind: FRAME_POLAROID, filled: true, label: '拍立得' },
  { id: FRAME_LACE, kind: FRAME_LACE, filled: true, label: '蕾絲花邊' },
  { id: FRAME_BRUSH, kind: FRAME_BRUSH, filled: true, label: '筆刷邊框' },
];
const FRAME_KIND_SET = new Set(FRAME_ITEMS.map(i => i.kind));
/** 是不是邊框分類的圖形（霧白邊框也算） */
export const isFrameShape = (kind?: string) => !!kind && FRAME_KIND_SET.has(kind);

/** 「範圍」的預設：霧白邊框 0（全白只在框邊），其他 50 */
export const frameRangeDefault = (kind?: string) => kind === MIST_FRAME_KIND ? MIST_RANGE_DEFAULT : 50;

const r01 = (range: number | undefined, kind: string) =>
  Math.max(0, Math.min(1, (range ?? frameRangeDefault(kind)) / 100));

/** 固定種子的亂數（mulberry32） */
const rng = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** 沿著框的周長走：t 0～1 → 框邊上的點 */
const perimeterPoint = (w: number, h: number, t: number) => {
  const P = 2 * (w + h);
  let d = ((t % 1) + 1) % 1 * P;
  if (d < w) return [d, 0];
  d -= w; if (d < h) return [w, d];
  d -= h; if (d < w) return [w - d, h];
  d -= w; return [0, h - d];
};

/** 集中線：尖刺一根一根的三角形（只有尖刺，所以照片大部分都看得到） */
const speedPath = (w: number, h: number, r: number) => {
  const p = new Path2D();
  const rand = rng(20251016);
  const N = 150, cx = w / 2, cy = h / 2, P = 2 * (w + h);
  for (let i = 0; i < N; i++) {
    const t = (i + (rand() - .5) * .8) / N;
    const [x, y] = perimeterPoint(w, h, t);
    const dx = cx - x, dy = cy - y, dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist, uy = dy / dist;
    // 長短：大部分短、少數特別長，才有「爆」的張力
    const k = rand();
    const len = dist * (.08 + r * .5) * (.25 + .75 * k * k + (k > .9 ? .35 : 0));
    const half = (P / N) * (.18 + rand() * .7);
    // 底邊往框外多推一點，邊上不會露出縫
    const bx = x - ux * half, by = y - uy * half;
    p.moveTo(bx - uy * half, by + ux * half);
    p.lineTo(x + ux * len, y + uy * len);
    p.lineTo(bx + uy * half, by - ux * half);
    p.closePath();
  }
  return p;
};

const rectPath = (p: Path2D, x: number, y: number, w: number, h: number, rad = 0) => {
  if (rad > 0 && (p as any).roundRect) (p as any).roundRect(x, y, w, h, rad);
  else p.rect(x, y, w, h);
};

/** 底片：上下兩條片邊，片邊上一格一格的齒孔（evenodd 挖空） */
const filmPath = (w: number, h: number, r: number) => {
  const p = new Path2D();
  const band = Math.min(h * .3, Math.min(w, h) * (.05 + r * .13));
  p.rect(0, 0, w, band); p.rect(0, h - band, w, band);
  const hh = band * .42, hw = hh * 1.25, gap = hw * 1.15;
  const n = Math.max(1, Math.floor((w - gap) / (hw + gap)));
  const start = (w - (n * hw + (n - 1) * gap)) / 2;
  for (let i = 0; i < n; i++) {
    const x = start + i * (hw + gap);
    rectPath(p, x, (band - hh) / 2, hw, hh, hh * .18);
    rectPath(p, x, h - band + (band - hh) / 2, hw, hh, hh * .18);
  }
  return p;
};

/** 拍立得：四邊等寬，下緣三倍厚 */
const polaroidPath = (w: number, h: number, r: number) => {
  const p = new Path2D();
  const t = Math.min(w, h) * (.025 + r * .09);
  const bottom = Math.min(h * .45, t * 3.2);
  p.rect(0, 0, w, h);
  p.rect(t, t, Math.max(1, w - 2 * t), Math.max(1, h - t - bottom));
  return p;
};

type Fill = [Path2D, CanvasFillRule];

/** 蕾絲花邊：一圈框（中間挖一排小圓點），框的內緣再接一顆一顆往內鼓的半圓 */
const lacePath = (w: number, h: number, r: number): Fill[] => {
  const t = Math.min(w, h) * (.03 + r * .08);
  const dot = t * .12, mid = t * .3;
  // 花邊：圓心在內框邊上，所以每顆都往內鼓出半個圓
  const bumps = new Path2D();
  const step = t * 1.1;
  const side = (ax: number, ay: number, bx: number, by: number) => {
    const L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(L / step)), rad = L / n / 2;
    for (let i = 0; i < n; i++) {
      const x = ax + (bx - ax) * (i + .5) / n, y = ay + (by - ay) * (i + .5) / n;
      bumps.moveTo(x + rad, y); bumps.arc(x, y, rad, 0, Math.PI * 2);
    }
  };
  side(t, t, w - t, t); side(w - t, t, w - t, h - t); side(w - t, h - t, t, h - t); side(t, h - t, t, t);
  // 框本身＋靠外側一排鏤空小圓點（跟花邊的半圓錯開，才不會被蓋住）
  const ring2 = new Path2D();
  ring2.rect(0, 0, w, h);
  ring2.rect(t, t, Math.max(1, w - 2 * t), Math.max(1, h - 2 * t));
  const dline = (ax: number, ay: number, bx: number, by: number) => {
    const L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(L / step));
    for (let i = 0; i < n; i++) {
      const x = ax + (bx - ax) * (i + .5) / n, y = ay + (by - ay) * (i + .5) / n;
      ring2.moveTo(x + dot, y); ring2.arc(x, y, dot, 0, Math.PI * 2);
    }
  };
  dline(mid, mid, w - mid, mid); dline(w - mid, mid, w - mid, h - mid);
  dline(w - mid, h - mid, mid, h - mid); dline(mid, h - mid, mid, mid);
  return [[ring2, 'evenodd'], [bumps, 'nonzero']];
};

/** 筆刷邊框：內緣是不規則的刷痕（幾個不同頻率的正弦疊起來，種子固定）。
    每一點都沿著「它那一邊」往內推，角落才不會被拉成尖角。 */
const brushPath = (w: number, h: number, r: number): Fill[] => {
  const p = new Path2D();
  const t = Math.min(w, h) * (.04 + r * .12);
  p.rect(0, 0, w, h);
  const rand = rng(77031);
  const waves = Array.from({ length: 5 }, (_, i) => ({ f: 3 + i * 4.3 + rand() * 3, ph: rand() * Math.PI * 2, a: .5 / (i + 1) }));
  const jag = (u: number) => waves.reduce((sum, wv) => sum + Math.sin(u * wv.f * Math.PI * 2 + wv.ph) * wv.a, 0);
  // 內框（往內縮 t）一圈，沿著各邊的法線方向加上刷痕起伏
  const iw = Math.max(1, w - 2 * t), ih = Math.max(1, h - 2 * t), P = 2 * (iw + ih), N = 420;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    let d = u * P, x: number, y: number, nx: number, ny: number;
    if (d < iw) { x = t + d; y = t; nx = 0; ny = -1; }
    else if ((d -= iw) < ih) { x = w - t; y = t + d; nx = 1; ny = 0; }
    else if ((d -= ih) < iw) { x = w - t - d; y = h - t; nx = 0; ny = 1; }
    else { d -= iw; x = t; y = h - t - d; nx = -1; ny = 0; }
    // 正值往框外（刷痕變細）、負值往框內（刷痕變粗）
    const off = t * (.55 * jag(u) + .1 * Math.sin(u * 211 + 1.7));
    x += nx * off; y += ny * off;
    if (i) p.lineTo(x, y); else p.moveTo(x, y);
  }
  p.closePath();
  return [[p, 'evenodd']];
};

const one = (f: (w: number, h: number, r: number) => Path2D) => (w: number, h: number, r: number): Fill[] => [[f(w, h, r), 'evenodd']];
const PATHS: Record<string, (w: number, h: number, r: number) => Fill[]> = {
  [FRAME_SPEED]: one(speedPath), [FRAME_FILM]: one(filmPath), [FRAME_POLAROID]: one(polaroidPath),
  [FRAME_LACE]: lacePath, [FRAME_BRUSH]: brushPath,
};
/** 路徑快取：同一個比例、同一個範圍就不用再算（拖動、縮放時每一格都用得到） */
const pathCache = new Map<string, Fill[]>();
const framePath = (kind: string, w: number, h: number, r: number) => {
  const key = `${kind}|${Math.round(w)}|${Math.round(h)}|${r.toFixed(3)}`;
  let path = pathCache.get(key);
  if (!path) {
    path = PATHS[kind](w, h, r);
    pathCache.set(key, path);
    if (pathCache.size > 40) pathCache.delete(pathCache.keys().next().value as string);
  }
  return path;
};

let texSurface: HTMLCanvasElement | null = null;
/**
 * 在 (0,0)～(w,h) 這個框裡畫一種邊框。
 * texture：要疊紋理時傳進來（收到的是暫存畫布、跟框一樣大的路徑），紋理只會出現在框上。
 */
export const paintFrameShape = (
  ctx: CanvasRenderingContext2D, kind: string, w: number, h: number, color = '#FFFFFF',
  params: MistParams = {}, texture?: (tc: CanvasRenderingContext2D, bodyPath: Path2D) => void,
) => {
  if (!(w > 0) || !(h > 0)) return;
  if (kind === MIST_FRAME_KIND || !PATHS[kind]) { paintMistFrame(ctx, w, h, color, params, texture); return; }
  const path = framePath(kind, w, h, r01(params.range, kind));
  const draw = (g: CanvasRenderingContext2D) => {
    g.save();
    g.beginPath(); g.rect(0, 0, w, h); g.clip();
    g.fillStyle = color;
    for (const [pp, rule] of path) g.fill(pp, rule);
    g.restore();
  };
  if (!texture) { draw(ctx); return; }
  // 有紋理：先在暫存畫布上畫框，再用 source-atop 把紋理疊上去，最後整張貼回來
  const m = ctx.getTransform();
  const k = Math.max(.25, Math.min(4, Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d))));
  const W = Math.max(1, Math.min(4096, Math.ceil(w * k))), H = Math.max(1, Math.min(4096, Math.ceil(h * k)));
  const cv = texSurface ??= document.createElement('canvas');
  if (cv.width !== W) cv.width = W;
  if (cv.height !== H) cv.height = H;
  const g = cv.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, W, H);
  g.setTransform(W / w, 0, 0, H / h, 0, 0);
  draw(g);
  g.globalCompositeOperation = 'source-atop';
  const body = new Path2D(); body.rect(0, 0, w, h);
  texture(g, body);
  g.globalCompositeOperation = 'source-over';
  g.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(cv, 0, 0, W, H, 0, 0, w, h);
};

/** 選單上的小圖（白色，拿來當遮罩用）：直的 3:4 小框，畫一次就快取 */
const iconCache = new Map<string, string>();
export const frameIconURL = (kind: string) => {
  const hit = iconCache.get(kind);
  if (hit !== undefined) return hit;
  if (typeof document === 'undefined') return '';
  const W = 60, H = 80;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  paintFrameShape(g, kind, W, H, '#FFFFFF', {});
  g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1.2; g.strokeRect(.6, .6, W - 1.2, H - 1.2);
  const url = cv.toDataURL('image/png');
  iconCache.set(kind, url);
  return url;
};
