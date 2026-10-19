/* ── 遮色片（多個、五種）─────────────────────────────────────────────────────
   照 Lightroom 的邏輯：
   · 一張照片可以有好幾個遮色片，各自有自己的一組調整（亮度、曝光、對比、高光、陰影、
     色溫、色調、飽和度、自然飽和度），由上到下依序套用。
   · 每個遮色片可以反轉（調的是選取範圍以外）。
   · 五種選取方式：
       線性漸層 —— 起始線 100% 到結束線 0%（原本那一種）
       放射漸層 —— 橢圓，可旋轉；羽化控制邊緣從多內側開始淡出（LR 的 Feather）
       筆刷     —— 塗上去／擦掉；大小、羽化（硬度的反面）、流量（每一筆疊多少）
       顏色範圍 —— 在照片上點選顏色（可以點好幾個），範圍（LR 的 Refine）決定多相近才算
       明度範圍 —— 選一段亮度（L*），兩端用平滑度淡出（LR 的 Luminance Range + Smoothness）
   · 顏色／明度範圍是看「套遮色片之前」那一刻的畫面算的（跟 LR 一樣看影像本身）。

   資料：編輯器原本那組 mask* 欄位＝「目前選中的那一個」的工作複本，
   masks 存全部（選中的那一格在切換時才回寫），maskActive 是選中的是第幾個。
   所有欄位都以 mask 開頭，批量編輯時「遮色片是這張照片自己的」那條規則自動涵蓋。 */

export type MaskType = 'linear' | 'radial' | 'brush' | 'color' | 'luma';
export type MaskStroke = { x: number; y: number; r: number; e?: 1 };
export type ColorSample = { r: number; g: number; b: number; x: number; y: number };

/** 一個遮色片的全部欄位（跟編輯器 params 裡的 mask* 同名） */
export type MaskSnap = {
  /** 每個遮色片自己的編號（筆刷等快取認它，刪掉前面的遮色片也不會認錯） */
  maskId: string;
  maskType: MaskType;
  maskCreated: boolean;
  maskInvert: boolean;
  maskExposure: number; maskBrightness: number; maskContrast: number; maskHighlights: number; maskShadows: number;
  maskTemp: number; maskTint: number; maskSat: number; maskVib: number;
  /* 線性／放射共用中心與角度；線性的半寬是 maskD（佔寬度的比例） */
  maskCx: number; maskCy: number; maskAngle: number; maskD: number;
  /* 放射：兩個半徑（佔寬度的比例）、羽化 0～100 */
  maskRx: number; maskRy: number; maskFeather: number;
  /* 筆刷 */
  maskStrokes: MaskStroke[]; maskBrushSize: number; maskBrushFeather: number; maskBrushFlow: number; maskBrushErase: boolean;
  /* 顏色範圍 */
  maskColors: ColorSample[]; maskColorRange: number;
  /* 明度範圍（0～100 的 L*） */
  maskLumLo: number; maskLumHi: number; maskLumSmooth: number;
};

export const MASK_ADJ_KEYS = ['maskBrightness', 'maskExposure', 'maskContrast', 'maskHighlights', 'maskShadows', 'maskTemp', 'maskTint', 'maskSat', 'maskVib'] as const;

export const newMaskId = () => Math.random().toString(36).slice(2, 10);
export const freshMask = (type: MaskType = 'linear', id = 'm0'): MaskSnap => ({
  maskId: id,
  maskType: type, maskCreated: type === 'luma', maskInvert: false,
  maskExposure: 0, maskBrightness: 0, maskContrast: 0, maskHighlights: 0, maskShadows: 0,
  maskTemp: 0, maskTint: 0, maskSat: 0, maskVib: 0,
  maskCx: 0.5, maskCy: 0.5, maskAngle: 0, maskD: 0.25,
  maskRx: 0.25, maskRy: 0.25, maskFeather: 50,
  maskStrokes: [], maskBrushSize: 40, maskBrushFeather: 50, maskBrushFlow: 100, maskBrushErase: false,
  maskColors: [], maskColorRange: 50,
  maskLumLo: 60, maskLumHi: 100, maskLumSmooth: 50,
});
export const MASK_SNAP_KEYS = Object.keys(freshMask()) as (keyof MaskSnap)[];

/** 從 params 取出「目前選中的那一個」 */
export const snapOf = (p: any): MaskSnap => {
  const f = freshMask(), out: any = {};
  for (const k of MASK_SNAP_KEYS) out[k] = p[k] !== undefined ? p[k] : (f as any)[k];
  return out;
};
export const hasMaskAdj = (m: MaskSnap) => MASK_ADJ_KEYS.some(k => (m as any)[k] !== 0);

/** 全部遮色片（選中的那一個用 params 上即時的那份）。舊專案沒有 masks：只有原本那一個線性 */
export const maskList = (p: any): { list: MaskSnap[]; active: number } => {
  const masks: MaskSnap[] | undefined = p.masks;
  if (!masks || !masks.length) return { list: p.maskCreated ? [snapOf(p)] : [], active: 0 };
  const active = Math.max(0, Math.min(masks.length - 1, p.maskActive || 0));
  return { list: masks.map((m, i) => (i === active ? snapOf(p) : { ...freshMask(m.maskType), ...m })), active };
};
export const anyMask = (p: any) => !!p.maskCreated || !!(p.masks && p.masks.some((m: MaskSnap) => m.maskCreated));

/* ── 選取範圍（alpha）────────────────────────────────────────────────────── */

const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / ((b - a) || 1e-6))); return t * t * (3 - 2 * t); };
const toLin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const LIN = new Float32Array(256); for (let i = 0; i < 256; i++) LIN[i] = toLin(i);
const fLab = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
/** sRGB 0～255 → CIE L*a*b*（D65） */
export const rgbToLab = (r: number, g: number, b: number): [number, number, number] => {
  const R = LIN[r | 0], G = LIN[g | 0], B = LIN[b | 0];
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, y = 0.2126 * R + 0.7152 * G + 0.0722 * B, z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const fx = fLab(x), fy = fLab(y), fz = fLab(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};
/** L*（0～100）的查表：明度範圍每個像素只要查一次 */
const LSTAR = new Float32Array(256 * 3);   // 依序 r、g、b 對 Y 的貢獻
for (let i = 0; i < 256; i++) { LSTAR[i] = 0.2126 * LIN[i]; LSTAR[256 + i] = 0.7152 * LIN[i]; LSTAR[512 + i] = 0.0722 * LIN[i]; }
const lstarOfY = (y: number) => 116 * fLab(y) - 16;

const newCanvas = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

/** 線性：起始線（100%）到結束線（0%） */
const paintLinear = (g: CanvasRenderingContext2D, m: MaskSnap, w: number, h: number) => {
  const cos = Math.cos(m.maskAngle), sin = Math.sin(m.maskAngle);
  const cx = m.maskCx * w, cy = m.maskCy * h, d = m.maskD * w;
  const grad = g.createLinearGradient(cx - d * cos, cy - d * sin, cx + d * cos, cy + d * sin);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
};
/** 放射：橢圓內 100%，從 (1 - 羽化) 的半徑開始淡到邊緣 0%（跟 LR 一樣，羽化往內吃） */
const paintRadial = (g: CanvasRenderingContext2D, m: MaskSnap, w: number, h: number) => {
  const rx = Math.max(1, m.maskRx * w), ry = Math.max(1, m.maskRy * w);
  const inner = Math.max(0, Math.min(0.999, 1 - m.maskFeather / 100));
  g.save();
  g.translate(m.maskCx * w, m.maskCy * h);
  g.rotate(m.maskAngle);
  g.scale(1, ry / rx);
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(inner, 'rgba(255,255,255,1)');
  // 中間多放幾個點，讓淡出是平滑曲線（smoothstep）而不是直線，邊緣才不會看到一圈
  for (let k = 1; k < 6; k++) { const t = k / 6; grad.addColorStop(inner + (1 - inner) * t, `rgba(255,255,255,${1 - t * t * (3 - 2 * t)})`); }
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath(); g.arc(0, 0, rx, 0, Math.PI * 2); g.fill();
  g.restore();
};

/* 筆刷：每一點是一顆柔邊圓；羽化越大邊越軟，流量是每一點疊上去的濃度。擦除就是挖掉。
   筆觸可以很多，所以畫好的那張留著，下一次只補新的點（前面都一樣的話）。 */
type BrushCache = { c: HTMLCanvasElement; w: number; h: number; n: number; sig: string };
const brushCaches = new Map<string, BrushCache>();
const trimBrush = () => { if (brushCaches.size > 8) brushCaches.delete(brushCaches.keys().next().value!); };
export const dabAlpha = (feather: number, flow: number) => ({ hard: Math.max(0, Math.min(0.98, 1 - feather / 100)), a: Math.max(0.02, flow / 100) });
const paintDab = (g: CanvasRenderingContext2D, s: MaskStroke, w: number, hard: number, a: number) => {
  const x = s.x * w, y = s.y * (g.canvas.height), r = Math.max(0.5, s.r * w);
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, `rgba(255,255,255,${a})`);
  grad.addColorStop(hard, `rgba(255,255,255,${a})`);
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.globalCompositeOperation = s.e ? 'destination-out' : 'source-over';
  g.fillStyle = grad;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
};
export const brushCanvas = (id: string, m: MaskSnap, w: number, h: number) => {
  const sig = `${w}x${h}|${m.maskBrushFeather}|${m.maskBrushFlow}`;
  // 即時疊層用縮小的、正式畫面用原尺寸：兩種尺寸各留一份，來回切換不用整筆重畫
  id = `${id}@${w}x${h}`;
  let bc = brushCaches.get(id);
  const strokes = m.maskStrokes || [];
  if (!bc || bc.sig !== sig || bc.w !== w || bc.h !== h || bc.n > strokes.length) {
    bc = { c: bc && bc.w === w && bc.h === h ? bc.c : newCanvas(w, h), w, h, n: 0, sig };
    bc.c.getContext('2d')!.clearRect(0, 0, w, h);
    brushCaches.set(id, bc); trimBrush();
  }
  const g = bc.c.getContext('2d')!;
  const { hard, a } = dabAlpha(m.maskBrushFeather, m.maskBrushFlow);
  for (let i = bc.n; i < strokes.length; i++) paintDab(g, strokes[i], w, hard, a);
  g.globalCompositeOperation = 'source-over';
  bc.n = strokes.length;
  return bc.c;
};

/** 顏色範圍：跟任何一個取樣色的 ΔE（亮度權重 0.6，著重色相與彩度）夠近就算，邊緣再留一段平滑淡出 */
const colorAlpha = (data: Uint8ClampedArray, out: Uint8ClampedArray, m: MaskSnap) => {
  const labs = m.maskColors.map(c => rgbToLab(c.r, c.g, c.b));
  // 範圍 50（預設）＝ΔE 約 20 以內全選、再往外 14 慢慢淡掉：跟 LR 點一下的感覺差不多，只吃相近的顏色
  const tol = 3 + m.maskColorRange * 0.34, soft = 6 + tol * 0.4;
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const [L, A, B] = rgbToLab(data[i], data[i + 1], data[i + 2]);
    let best = 1e9;
    for (const q of labs) { const dL = (L - q[0]) * 0.6, dA = A - q[1], dB = B - q[2]; const d = dL * dL + dA * dA + dB * dB; if (d < best) best = d; }
    out[j] = Math.round(255 * (1 - sstep(tol, tol + soft, Math.sqrt(best))));
  }
};
/** 明度範圍：L* 落在 [下限, 上限] 之間的全選，外側照平滑度淡出 */
const lumaAlpha = (data: Uint8ClampedArray, out: Uint8ClampedArray, m: MaskSnap) => {
  const lo = Math.min(m.maskLumLo, m.maskLumHi), hi = Math.max(m.maskLumLo, m.maskLumHi);
  const fw = Math.max(0.5, m.maskLumSmooth * 0.3);
  // 256 階的 Y 太粗：L* 直接用 1024 階查表
  const tab = new Uint8ClampedArray(1025);
  for (let k = 0; k <= 1024; k++) { const L = lstarOfY(k / 1024); tab[k] = Math.round(255 * sstep(lo - fw, lo, L) * (1 - sstep(hi, hi + fw, L))); }
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const y = LSTAR[data[i]] + LSTAR[256 + data[i + 1]] + LSTAR[512 + data[i + 2]];
    out[j] = tab[Math.min(1024, Math.round(y * 1024))];
  }
};

/* 範圍類的選取要看像素，一次全解析度算要幾十毫秒。拖滑桿時改用縮小的那張算（再放大貼回去，
   選取範圍本來就是平滑的），放手才用原尺寸。結果按參數與畫面留著，不變就不重算。 */
type RangeCache = { key: string; c: HTMLCanvasElement };
const rangeCaches = new Map<string, RangeCache>();
const rangeCanvas = (id: string, m: MaskSnap, src: CanvasImageSource, w: number, h: number, baseKey: string, fast: boolean) => {
  const k = fast ? Math.min(1, 480 / Math.max(w, h)) : 1;
  const sw = Math.max(1, Math.round(w * k)), sh = Math.max(1, Math.round(h * k));
  const key = `${baseKey}|${sw}x${sh}|${m.maskType}|${m.maskType === 'color' ? JSON.stringify(m.maskColors) + m.maskColorRange : `${m.maskLumLo},${m.maskLumHi},${m.maskLumSmooth}`}`;
  const hit = rangeCaches.get(id);
  if (hit && hit.key === key) return hit.c;
  const tmp = newCanvas(sw, sh);
  const tg = tmp.getContext('2d', { willReadFrequently: true })!;
  tg.drawImage(src, 0, 0, sw, sh);
  const img = tg.getImageData(0, 0, sw, sh);
  const a = new Uint8ClampedArray(sw * sh);
  if (m.maskType === 'color') colorAlpha(img.data, a, m); else lumaAlpha(img.data, a, m);
  for (let i = 0, j = 0; j < a.length; i += 4, j++) { img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = a[j]; }
  tg.putImageData(img, 0, 0);
  rangeCaches.set(id, { key, c: tmp });
  return tmp;
};

/**
 * 把第 id 個遮色片的選取範圍畫成一張 w×h 的 alpha 圖（白色、alpha＝選取多少，已處理反轉）。
 * src：顏色／明度範圍要看的那張畫面；baseKey：那張畫面的識別（變了才重算）。
 */
export function maskAlpha(out: HTMLCanvasElement, id: string, m: MaskSnap, w: number, h: number,
  src: CanvasImageSource | null, baseKey: string, fast = false): HTMLCanvasElement {
  if (out.width !== w || out.height !== h) { out.width = w; out.height = h; }
  const g = out.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'copy';
  g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
  if (m.maskType === 'radial') paintRadial(g, m, w, h);
  else if (m.maskType === 'brush') g.drawImage(brushCanvas(id, m, w, h), 0, 0);
  else if ((m.maskType === 'color' && m.maskColors.length) || m.maskType === 'luma') {
    if (src) { g.imageSmoothingQuality = 'high'; g.drawImage(rangeCanvas(id, m, src, w, h, baseKey, fast), 0, 0, w, h); }
  } else if (m.maskType === 'linear') paintLinear(g, m, w, h);
  if (m.maskInvert) {
    // 反轉：整片白，再把原本的選取挖掉
    const inv = scratchInv(w, h);
    const ig = inv.getContext('2d')!;
    ig.globalCompositeOperation = 'copy'; ig.drawImage(out, 0, 0);
    g.globalCompositeOperation = 'copy'; g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-out'; g.drawImage(inv, 0, 0);
    g.globalCompositeOperation = 'source-over';
  }
  return out;
}
let invC: HTMLCanvasElement | null = null;
const scratchInv = (w: number, h: number) => { if (!invC) invC = newCanvas(w, h); if (invC.width !== w || invC.height !== h) { invC.width = w; invC.height = h; } return invC; };

/** 換照片／換尺寸時把快取清掉（id 是遮色片在清單裡的位置＋類型） */
export const clearMaskCaches = () => { brushCaches.clear(); rangeCaches.clear(); };
export const maskCacheId = (m: MaskSnap) => `${m.maskId}:${m.maskType}`;
