/* 圖形分類「邊框」：全部都是「一整張照片的框」，一放進來就跟底圖一樣大。
   霧白邊框是一張平滑的遮罩（見 mistFrame.ts）；其他五種是向量畫的：
     集中線：動漫那種很有張力的框 —— 一大圈大小、長短都不一樣的尖刺，從框邊往中間刺進去；
     底片：上下兩條片邊，一格一格的齒孔；
     拍立得：四邊等寬，下面特別厚；
     蕾絲花邊：一圈邊框，內緣是一顆一顆的半圓花邊，中間再鏤空一排小圓點；
     筆刷邊框：像用粗筆刷隨手刷出來的邊，內緣不規則。
   共用的旋鈕只有「範圍」（框有多厚／尖刺刺多深）；顏色跟著圖形顏色，紋理只疊在框上。
   形狀用固定的亂數種子算，所以每一格、每一次打開都長得一樣。 */
import { MIST_FRAME_KIND, paintMistFrame, MIST_RANGE_DEFAULT, mistRangeFromUi, type MistParams } from './mistFrame';

/** 邊框各自的旋鈕（都是 0～100）；shapeD 是散落圖形框拿來畫圖形的函式（由外面傳進來，避免循環引用） */
export type FrameParams = MistParams & { gap?: number; thick?: number; vary?: number; size?: number; sizeVar?: number; angle?: number; angleVar?: number; glow?: number; seed?: number;
  kinds?: string[]; itemFrame?: ScatterItemFrame;
  /** 完整畫出來的那幾顆可以畫到哪裡（創意拼圖：不能蓋到排版的遮罩上） */ shapeD?: (kind: string, w: number, h: number) => string };

export const FRAME_SPEED = 'frame-speed';
export const FRAME_FILM = 'frame-film';
export const FRAME_POLAROID = 'frame-polaroid';
export const FRAME_LACE = 'frame-lace';
export const FRAME_BRUSH = 'frame-brush';
export const FRAME_SCATTER = 'frame-scatter';

/** 邊框分類裡的全部（圖形選單上的順序） */
export const FRAME_ITEMS = [
  { id: MIST_FRAME_KIND, kind: MIST_FRAME_KIND, filled: true, label: '霧白邊框' },
  { id: FRAME_SPEED, kind: FRAME_SPEED, filled: true, label: '集中線' },
  { id: FRAME_FILM, kind: FRAME_FILM, filled: true, label: '底片' },
  { id: FRAME_POLAROID, kind: FRAME_POLAROID, filled: true, label: '拍立得' },
  { id: FRAME_LACE, kind: FRAME_LACE, filled: true, label: '蕾絲花邊' },
  { id: FRAME_BRUSH, kind: FRAME_BRUSH, filled: true, label: '筆刷邊框' },
  { id: FRAME_SCATTER, kind: FRAME_SCATTER, filled: true, label: '散落圖形' },
];
const FRAME_KIND_SET = new Set(FRAME_ITEMS.map(i => i.kind));
/** 是不是邊框分類的圖形（霧白邊框也算） */
export const isFrameShape = (kind?: string) => !!kind && FRAME_KIND_SET.has(kind);

/** 「範圍」的預設：霧白邊框 0（全白只在框邊），其他 50 */
export const frameRangeDefault = (kind?: string) => kind === MIST_FRAME_KIND ? MIST_RANGE_DEFAULT : kind === FRAME_SCATTER || kind === FRAME_SPEED ? 60 : 50;

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

/** 集中線（漫畫張力框）。每一根尖刺都正對著畫面正中心，而且互相不重疊：
   先沿著框邊平均（或照「變化」稍微打亂）放好每根的位置，換成「從中心看過去的角度」；
   每根只能待在自己那一片扇形裡（左右鄰居角度的中線為界），所以永遠不會壓到旁邊那根。
   三角形的尖端在中心那條射線上、底邊推到框外很遠（被框裁掉），看起來就是從框邊刺進來。
   旋鈕：範圍＝刺多深；間距＝根數；粗細＝每根在框邊上有多寬；變化＝粗細與長短的亂度（0＝全部一樣）。 */
const speedPath = (w: number, h: number, r: number, o: FrameParams = {}) => {
  const p = new Path2D();
  const rand = rng(20251016);
  const gap = (o.gap ?? 50) / 100, thick = (o.thick ?? 50) / 100, vary = (o.vary ?? 100) / 100;
  const N = Math.round(200 - gap * 160), cx = w / 2, cy = h / 2, P = 2 * (w + h), R = 3 * Math.hypot(w, h);
  const ang = (t: number) => { const [x, y] = perimeterPoint(w, h, t); return Math.atan2(y - cy, x - cx); };
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const ts = Array.from({ length: N }, (_, i) => (i + .5 + (rand() - .5) * .6 * vary) / N);
  const th = ts.map(ang);
  for (let i = 0; i < N; i++) {
    const t = ts[i], a = th[i];
    const [x, y] = perimeterPoint(w, h, t);
    const dist = Math.hypot(x - cx, y - cy) || 1;
    // 自己那片扇形的左右界（跟鄰居角度的中點），稍微留一點縫
    const lo = wrap(th[(i + N - 1) % N] - a) / 2 * .96, hi = wrap(th[(i + 1) % N] - a) / 2 * .96;
    const half = P / N / 2 * (.2 + thick * 1.7) * (1 - vary * rand() * .8);
    const da = Math.max(lo, wrap(ang(t - half / P) - a)), db = Math.min(hi, wrap(ang(t + half / P) - a));
    const len = dist * (.08 + r * .55) * (1 - vary * rand() * .75);
    const ax = cx + Math.cos(a) * (dist - len), ay = cy + Math.sin(a) * (dist - len);
    p.moveTo(ax, ay);
    p.lineTo(cx + Math.cos(a + da) * R, cy + Math.sin(a + da) * R);
    p.lineTo(cx + Math.cos(a + db) * R, cy + Math.sin(a + db) * R);
    p.closePath();
  }
  return p;
};

/** 散落圖形框：沒有遮罩，選好的幾種圖形以隨機大小、盡量平均的數量散在四周。
   範圍跟霧白邊框同一套（0～100、預設 60）：用橢圓距離量，越往中間越空。
   放法是「丟飛鏢」：隨機丟一個點，在範圍內、而且跟已經放好的都保持間距才留下；
   圖形種類照輪流的順序給，所以每一種的數量差不多。 */
export const SCATTER_KINDS_DEFAULT = ['hole-sb-cross-thin', 'hole-sb-eight', 'star-double-f', 'blur-star-rounded-f'];
/** 這種圖形本來就不能調發光（模糊類）：散落圖形裡也不發光 */
export const scatterKindNoGlow = (id: string) => id.startsWith('blur-');
export const scatterAllNoGlow = (kinds?: string[]) => (kinds?.length ? kinds : SCATTER_KINDS_DEFAULT).every(scatterKindNoGlow);
/** 畫圖形用的函式（GridLayoutTool 載入時註冊 shapePathD，避免循環引用） */
let frameShapeD: ((kind: string, w: number, h: number) => string) | null = null;
export const setFrameShapeD = (f: (kind: string, w: number, h: number) => string) => { frameShapeD = f; };
/** 選單上的圖形 id（例如 star-f／star-o）→ 形狀與實心／空心；舊資料只存形狀名的當實心 */
let frameShapeItem: ((id: string) => { kind: string; filled: boolean } | null) | null = null;
export const setFrameShapeItem = (f: (id: string) => { kind: string; filled: boolean } | null) => { frameShapeItem = f; };
/** 集中線、散落圖形的額外滑桿（全部 0～100） */
export const FRAME_SLIDERS: Record<string, { key: 'gap' | 'thick' | 'vary' | 'size' | 'sizeVar' | 'angle' | 'angleVar' | 'glow'; label: string; def: number }[]> = {
  'frame-speed': [{ key: 'gap', label: '間距', def: 50 }, { key: 'thick', label: '粗細', def: 50 }, { key: 'vary', label: '變化', def: 100 }],
  'frame-scatter': [{ key: 'gap', label: '間距', def: 30 }, { key: 'size', label: '大小', def: 70 },
    { key: 'sizeVar', label: '大小變化', def: 100 }, { key: 'angle', label: '角度', def: 0 }, { key: 'angleVar', label: '角度變化', def: 20 }, { key: 'glow', label: '發光', def: 0 }],
};
/** 存在物件上的那一包（滑桿值＋散落的圖形種類） */
export type FrameOpts = { gap?: number; thick?: number; vary?: number; size?: number; sizeVar?: number; angle?: number; angleVar?: number; glow?: number; seed?: number; kinds?: string[] };
/** 散落圖形的版面：只跟比例、範圍、間距、選了哪些圖形有關 ——
   調大小、大小變化、角度、角度變化時位置都不會重排，只是每顆照自己記住的亂數改大小／角度。 */
type ScatterSpot = { x: number; y: number; ki: number; uSize: number; uRot: number; tilt: boolean };
const scatterCache = new Map<string, ScatterSpot[]>();
const scatterLayout = (w: number, h: number, o: FrameParams): ScatterSpot[] => {
  const kinds = o.kinds?.length ? o.kinds : SCATTER_KINDS_DEFAULT;
  const ui = o.range ?? 60, gap = o.gap ?? 30;
  const key = `${Math.round(w)}|${Math.round(h)}|${ui}|${gap}|${o.seed ?? 0}|${kinds.join(',')}`;
  const hit = scatterCache.get(key);
  if (hit) return hit;
  // 「隨機分佈」按鈕換的就是這個種子
  const rand = rng(77001 + (o.seed ?? 0) * 7919);
  const edge = 1 - mistRangeFromUi(ui) / 100 * .9, inner = edge - .32;
  const m = Math.min(w, h), R0 = m * .045, minD = R0 * 2 * (.9 + gap / 100 * 2.2);
  const spots: ScatterSpot[] = [], count = new Array(kinds.length).fill(0);
  for (let tries = 0; tries < 6000 && spots.length < 400; tries++) {
    const x = (rand() * 1.04 - .02) * w, y = (rand() * 1.04 - .02) * h;
    const u = (x - w / 2) / (w / 2), v = (y - h / 2) / (h / 2);
    if (Math.hypot(u, v) < inner) continue;
    if (spots.some(p => Math.hypot(p.x - x, p.y - y) < minD)) continue;
    // 附近最少出現的那一種優先（同分再看整體數量），所以每一種都平均散開
    const near = new Array(kinds.length).fill(0);
    for (const p of spots) if (Math.hypot(p.x - x, p.y - y) < minD * 2.2) near[p.ki]++;
    let ki = 0;
    for (let j = 1; j < kinds.length; j++) if (near[j] < near[ki] || (near[j] === near[ki] && count[j] < count[ki])) ki = j;
    count[ki]++;
    spots.push({ x, y, ki, uSize: rand(), uRot: rand(), tilt: false });
  }
  /* 「要不要歪」先照每一種各自排好：同一種圖形裡，照順序輪流決定，
     所以角度變化 30 的時候，每一種都大約有三成是歪的、其餘不動（不會整種一起歪）。 */
  scatterCache.set(key, spots);
  if (scatterCache.size > 24) scatterCache.delete(scatterCache.keys().next().value as string);
  return spots;
};
/** 每顆的最後位置、大小、角度（度） */
const scatterItems = (w: number, h: number, o: FrameParams) => {
  const kinds = o.kinds?.length ? o.kinds : SCATTER_KINDS_DEFAULT;
  const spots = scatterLayout(w, h, o);
  // 大小滑桿 0～100 對應舊刻度 0～60
  const m = Math.min(w, h), S = m * (.02 + ((o.size ?? 70) / 100 * .6) ** 2 * .42);
  const sv = (o.sizeVar ?? 100) / 100, av = (o.angleVar ?? 20) / 100, base = (o.angle ?? 0) / 100 * 360;
  const seen = new Array(kinds.length).fill(0);
  return spots.map(p => {
    /* 每一種圖形裡固定有大約四成不動、六成會歪（照順序輪流，所以每一種都有歪有不歪）；
       角度變化只決定歪的那些歪多少，從 0 慢慢加大到 ±45°，不會一下跳來跳去。 */
    const c = seen[p.ki]++, ph = (p.ki * .618) % 1;
    const tilt = Math.floor((c + 1) * .6 + ph) > Math.floor(c * .6 + ph);
    const rot = base + (tilt ? (p.uRot * 2 - 1) * 45 * av : 0);
    // 大小變化：大部分放大（最多 1+1.2×變化 倍），少部分稍微縮小（最少 1-0.3×變化 倍）
    const d = S * (1 + sv * (p.uSize * 1.5 - .3));
    /* 每一顆都完整留在選中框裡：靠邊的往內推到剛好整顆看得到（靜止、動畫都一樣，
       所以不會有被切一半的圖形，動起來也不會露出切口） */
    const r = d * .55;
    const x = w > 2 * r ? Math.max(r, Math.min(w - r, p.x)) : w / 2;
    const y = h > 2 * r ? Math.max(r, Math.min(h - r, p.y)) : h / 2;
    return { x, y, d, rot, id: kinds[p.ki] };
  });
};
/** 畫圖形的小圖（GridLayoutTool 註冊：用跟一般新增圖形一模一樣的畫法） */
/** w＝這張小圖代表的圖形寬（px）；ox、oy＝小圖左上角相對圖形中心的位置（px，文字類的圖形會超出框） */
export type FrameSprite = { canvas: HTMLCanvasElement; w: number; ox: number; oy: number };
let frameSprite: ((id: string, color: string, px: number, glintGlow?: number) => FrameSprite | null) | null = null;
export const setFrameSprite = (f: (id: string, color: string, px: number, glintGlow?: number) => FrameSprite | null) => { frameSprite = f; };
/* 發光：把同一張小圖放在大一點的畫布上、用跟圖形一樣顏色的 shadowBlur 畫兩層，
   結果快取起來（每一顆小圖、每一種強度只算一次），平常貼圖就好，不會每一幀做模糊。 */
const glowCache = new WeakMap<HTMLCanvasElement, Map<string, FrameSprite>>();
const glowSprite = (sp: FrameSprite, color: string, glow: number): FrameSprite => {
  const q = Math.round(glow / 5) * 5;
  let m = glowCache.get(sp.canvas);
  if (!m) { m = new Map(); glowCache.set(sp.canvas, m); }
  const key = `${q}|${color}`;
  const hit = m.get(key);
  if (hit) return hit;
  const blur = sp.w * (.04 + q / 100 * .32), extra = Math.ceil(blur * 2);
  const cv = document.createElement('canvas');
  cv.width = sp.canvas.width + extra * 2; cv.height = sp.canvas.height + extra * 2;
  const g = cv.getContext('2d')!;
  g.shadowColor = color;
  for (const b of [blur, blur * .4]) { g.shadowBlur = b; g.drawImage(sp.canvas, extra, extra); }
  g.shadowBlur = 0; g.drawImage(sp.canvas, extra, extra);
  const out = { canvas: cv, w: sp.w, ox: sp.ox - extra, oy: sp.oy - extra };
  m.set(key, out);
  return out;
};
/** 散落圖形每一顆的動畫（由工具傳進來）：rank＝從左上開始順時針繞一圈的順序，n＝總數，i＝第幾顆 */
export type ScatterItemFrame = (rank: number, n: number, i: number) => { k: number; dx: number; dy: number; rot: number; a: number; fx?: number } | null;
const paintScatter = (g: CanvasRenderingContext2D, w: number, h: number, color: string, o: FrameParams) => {
  const m = g.getTransform(), k = Math.max(.25, Math.hypot(m.a, m.b)), glow = o.glow ?? 0;
  const items = scatterItems(w, h, o);
  // 果凍II 的順序：從左上角那個方向開始，順時針（畫布 y 向下，所以角度變大就是順時針）繞一圈
  let ranks: number[] | null = null;
  if (o.itemFrame) {
    const a0 = Math.atan2(-h / 2, -w / 2), TAU = Math.PI * 2;
    const ang = items.map(it => ((Math.atan2(it.y - h / 2, it.x - w / 2) - a0) % TAU + TAU) % TAU);
    const order = items.map((_, i) => i).sort((p, q) => ang[p] - ang[q]);
    ranks = new Array(items.length);
    order.forEach((idx, r) => { ranks![idx] = r; });
  }
  g.imageSmoothingEnabled = true;
  const drawOne = (it: typeof items[number], f: ReturnType<ScatterItemFrame>) => {
    if (f && (f.k <= .002 || f.a <= .004)) return;
    /* 星芒的發光跟一般圖形不一樣：用星芒自己的「柔光範圍」（跟星芒編輯裡的發光同一個），
       不是外面再套一圈陰影光 */
    const glint = it.id.startsWith('hole-sb-');
    const raw = frameSprite?.(it.id, color, it.d * k, glint ? glow : undefined);
    const sp = raw && glow > 0 && !glint && !scatterKindNoGlow(it.id) ? glowSprite(raw, color, glow) : raw;
    g.save();
    g.translate(it.x + (f ? f.dx * it.d : 0), it.y + (f ? f.dy * it.d : 0));
    g.rotate((it.rot + (f ? f.rot : 0)) * Math.PI / 180);
    if (f && (f.k !== 1 || (f.fx ?? 1) !== 1)) g.scale(f.k * (f.fx ?? 1), f.k);
    if (f && f.a < 1) g.globalAlpha *= f.a;
    if (sp) {
      const s = it.d / sp.w;
      g.drawImage(sp.canvas, sp.ox * s, sp.oy * s, sp.canvas.width * s, sp.canvas.height * s);
    } else { g.fillStyle = color; g.beginPath(); g.arc(0, 0, it.d / 2, 0, Math.PI * 2); g.fill(); }
    g.restore();
  };
  // 全部都畫在選中框裡（果凍彈過頭那一點點也不會超出框）
  g.save();
  g.beginPath(); g.rect(0, 0, w, h); g.clip();
  items.forEach((it, i) => drawOne(it, o.itemFrame && ranks ? o.itemFrame(ranks[i], items.length, i) : null));
  g.restore();
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

/* 拍立得的相紙紋理。真的拍立得框是一層微微帶暖灰的霧面相紙，不是純白：
   近看有很細的顆粒、淡淡的纖維起伏，下緣厚的那塊稍微偏冷一點，
   照片窗口的內緣有一道很淺的壓痕。
   做法跟網路上常見的「SVG feTurbulence + feDiffuseLighting 做紙紋」同一個原理，
   只是改用 canvas 自己算：
     1. 幾層可無縫拼接的 value noise 疊成高度圖（大起伏＋細顆粒），再撒一些細短的纖維；
     2. 對高度圖求斜率、用左上方的光打 Lambert 光 → 出現霧面紙那種凹凸；
     3. 顏色＝挑的顏色 × 相紙色（白色會變成 #F3F1EC 左右的暖白）× 光影。
   紋理只算一次（256px、可拼接），之後當 pattern 鋪上去。 */
const PAPER_TONE = [.953, .945, .925];
const paperCache = new Map<string, HTMLCanvasElement>();
const hexRgb = (hex: string) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [255, 255, 255];
};
const paperTile = (color: string) => {
  const hit = paperCache.get(color);
  if (hit) return hit;
  const N = 256, hgt = new Float32Array(N * N);
  let seed = 1337;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  // 可拼接的 value noise：格點值在邊界繞回來，所以貼成 pattern 不會有接縫
  for (const [cells, amp] of [[4, 1], [8, .6], [16, .35], [32, .25], [64, .22], [128, .18]] as const) {
    const g = new Float32Array(cells * cells).map(() => rnd() * 2 - 1);
    const step = N / cells;
    for (let y = 0; y < N; y++) {
      const fy = y / step, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % cells) * cells, r1 = ((y0 + 1) % cells) * cells;
      for (let x = 0; x < N; x++) {
        const fx = x / step, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
        const c0 = x0 % cells, c1 = (x0 + 1) % cells;
        const a = g[r0 + c0] + (g[r0 + c1] - g[r0 + c0]) * sx;
        const b = g[r1 + c0] + (g[r1 + c1] - g[r1 + c0]) * sx;
        hgt[y * N + x] += (a + (b - a) * sy) * amp;
      }
    }
  }
  /* 拍立得（寶麗來／富士 instax）的框是壓紋相紙：近看是一格一格很整齊的小凸點。
     在 256px 裡排 48×48 格（整除才能無縫拼接），每格一顆柔邊的小方凸點，
     打光後就是那種隱約、規律的格紋；上面的雜訊只留一點點，讓它不會太死板。 */
  for (let i = 0; i < hgt.length; i++) hgt[i] *= .35;
  const C = 48, cell = N / C;
  for (let y = 0; y < N; y++) {
    const fy = (y + .5) / cell % 1, by = Math.sin(Math.PI * fy);
    for (let x = 0; x < N; x++) {
      const fx = (x + .5) / cell % 1, bx = Math.sin(Math.PI * fx);
      hgt[y * N + x] += Math.pow(bx * by, .6) * 2.2;
    }
  }
  // 纖維：很細的短線，稍微凸起
  for (let i = 0; i < 40; i++) {
    let x = rnd() * N, y = rnd() * N;
    const ang = rnd() * Math.PI, len = 3 + rnd() * 9, v = (rnd() < .5 ? -1 : 1) * (.25 + rnd() * .35);
    for (let k = 0; k < len; k++) {
      hgt[(((y | 0) % N + N) % N) * N + (((x | 0) % N + N) % N)] += v;
      x += Math.cos(ang); y += Math.sin(ang);
    }
  }
  const [cr, cg, cb] = hexRgb(color);
  const base = [cr * PAPER_TONE[0], cg * PAPER_TONE[1], cb * PAPER_TONE[2]];
  const cv = document.createElement('canvas'); cv.width = cv.height = N;
  const g = cv.getContext('2d')!, img = g.createImageData(N, N), d = img.data;
  const L = [-.55, -.65, .52]; // 左上方打光
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const dx = hgt[y * N + (x + 1) % N] - hgt[y * N + (x + N - 1) % N];
    const dy = hgt[((y + 1) % N) * N + x] - hgt[((y + N - 1) % N) * N + x];
    const nx = -dx * .35, ny = -dy * .35, nz = 1, nl = Math.hypot(nx, ny, nz);
    const lam = (nx * L[0] + ny * L[1] + nz * L[2]) / nl / .52; // 平的地方＝1
    const grain = (rnd() - .5) * .008;
    const k = Math.max(.95, Math.min(1.03, 1 + (lam - 1) * .14 + grain + hgt[i] * .006));
    const o = i * 4;
    d[o] = Math.min(255, base[0] * k); d[o + 1] = Math.min(255, base[1] * k); d[o + 2] = Math.min(255, base[2] * k); d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  paperCache.set(color, cv);
  if (paperCache.size > 8) paperCache.delete(paperCache.keys().next().value as string);
  return cv;
};

/** 拍立得：相紙色＋紋理、下緣微微偏冷、窗口內緣一道淺壓痕 */
const paintPolaroid = (g: CanvasRenderingContext2D, w: number, h: number, color: string, r: number) => {
  const t = Math.min(w, h) * (.025 + r * .09);
  const bottom = Math.min(h * .45, t * 3.2);
  const iw = Math.max(1, w - 2 * t), ih = Math.max(1, h - t - bottom);
  const body = new Path2D(); body.rect(0, 0, w, h); body.rect(t, t, iw, ih);
  g.save();
  g.beginPath(); g.rect(0, 0, w, h); g.clip();
  g.clip(body, 'evenodd');
  const pat = g.createPattern(paperTile(color), 'repeat')!;
  const sc = Math.max(1e-3, Math.min(w, h) * .32 / 256);
  pat.setTransform(new DOMMatrix([sc, 0, 0, sc, 0, 0]));
  g.fillStyle = pat; g.fillRect(0, 0, w, h);
  // 大範圍的明暗：上面略暖、下緣那塊略冷略亮，跟真的相紙一樣不是一整片死白
  const lg = g.createLinearGradient(0, 0, 0, h);
  lg.addColorStop(0, 'rgba(120,100,70,0.035)'); lg.addColorStop(.75, 'rgba(0,0,0,0)'); lg.addColorStop(1, 'rgba(150,170,210,0.05)');
  g.fillStyle = lg; g.fillRect(0, 0, w, h);
  const vg = g.createLinearGradient(0, 0, w, 0);
  vg.addColorStop(0, 'rgba(0,0,0,0.025)'); vg.addColorStop(.5, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.02)');
  g.fillStyle = vg; g.fillRect(0, 0, w, h);
  // 窗口內緣的壓痕：一道暗線＋外側一道亮線
  const e = Math.max(.6, t * .035);
  g.lineWidth = e; g.strokeStyle = 'rgba(0,0,0,0.10)'; g.strokeRect(t - e / 2, t - e / 2, iw + e, ih + e);
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.strokeRect(t - e * 1.5, t - e * 1.5, iw + e * 3, ih + e * 3);
  g.restore();
};

/** 第三格有值＝這一塊是空心圖形，用這個粗細描線 */
type Fill = [Path2D, CanvasFillRule, number?];

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

const one = (f: (w: number, h: number, r: number, o?: FrameParams) => Path2D) => (w: number, h: number, r: number, o?: FrameParams): Fill[] => [[f(w, h, r, o), 'evenodd']];
const PATHS: Record<string, (w: number, h: number, r: number, o?: FrameParams) => Fill[]> = {
  [FRAME_SPEED]: one(speedPath), [FRAME_FILM]: one(filmPath), [FRAME_POLAROID]: one(polaroidPath),
  [FRAME_LACE]: lacePath, [FRAME_BRUSH]: brushPath,
};
/** 路徑快取：同一個比例、同一個範圍就不用再算（拖動、縮放時每一格都用得到） */
const pathCache = new Map<string, Fill[]>();
const framePath = (kind: string, w: number, h: number, r: number, o: FrameParams = {}) => {
  const key = `${kind}|${Math.round(w)}|${Math.round(h)}|${r.toFixed(3)}|${o.gap}|${o.thick}|${o.vary}|${o.size}|${o.sizeVar}|${o.angleVar}|${o.range}|${(o.kinds || []).join(',')}`;
  let path = pathCache.get(key);
  if (!path) {
    path = PATHS[kind](w, h, r, o);
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
  params: FrameParams = {}, texture?: (tc: CanvasRenderingContext2D, bodyPath: Path2D) => void,
) => {
  if (!(w > 0) || !(h > 0)) return;
  if (kind === FRAME_SCATTER) { paintScatter(ctx, w, h, color, params); return; }
  if (kind === MIST_FRAME_KIND || !PATHS[kind]) { paintMistFrame(ctx, w, h, color, params, texture); return; }
  const path = framePath(kind, w, h, r01(params.range, kind), params);
  const draw = (g: CanvasRenderingContext2D) => {
    if (kind === FRAME_POLAROID) { paintPolaroid(g, w, h, color, r01(params.range, kind)); return; }
    g.save();
    g.beginPath(); g.rect(0, 0, w, h); g.clip();
    g.fillStyle = color;
    g.strokeStyle = color; g.lineJoin = 'round'; g.lineCap = 'round';
    for (const [pp, rule, lw] of path) { if (lw) { g.lineWidth = lw; g.stroke(pp); } else g.fill(pp, rule); }
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
