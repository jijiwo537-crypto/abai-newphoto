/* 樂譜貼圖：在 App 裡即時畫出來（五線譜＋譜號＋音符），輸出一條只有 M／L／Z 的填色路徑。
 *
 * 記譜規則（懂音樂的人看了不會笑）：
 *   ‧ 符頭只落在線上或間上：p＝0 是最下面那條線，每 1 是半格，8 是最上面那條線
 *   ‧ 第三線（p=4）以下符桿朝上、在符頭右邊；以上朝下、在符頭左邊
 *   ‧ 符尾一律長在符桿右邊；連桿的方向照整組的平均高度
 *   ‧ 高音譜號的漩渦繞著第二線；降記號在符頭左邊、同一條線或間上
 *
 * 擠壓變形：五線譜的曲線跟著框拉長拉扁，但線寬、間距、音符一律用「比較小的那個縮放」，
 * 所以音符永遠不會被拉變形。
 * 每個子路徑都是順時針（洞是逆時針），重疊的地方用一般的填色規則就會合在一起。 */
import { CLEF_LOOPS, CLEF_W } from './scoreClef';

type Pt = [number, number];
type Curve = (t: number) => Pt;
/** [t, p, 種類, 臨時記號, 連桿組] —— 種類：q 四分、h 二分、8 八分、16 十六分、b8／b16 連桿 */
export type Note = [number, number, string, string?, string?];
type Spec = {
  W: number; H: number; c: Curve; gap: number | ((t: number) => number); lw: number; lwFn?: (t: number) => number;
  clefT: number; clefUpright?: boolean; clefK?: number; clefDy?: number;
  key?: [number, number, string][]; bars?: number[]; notes: Note[];
  /** 隨機音符時可以用的範圍與顆數 */
  /** 可以放音符的區段（避開轉太急的地方） */
  span: [number, number][]; count: number;
};

/* ---------- 曲線工具 ---------- */
const bez = (a: Pt, b: Pt, c: Pt, d: Pt): Curve => t => { const m = 1 - t; return [0, 1].map(i => m * m * m * a[i] + 3 * m * m * t * b[i] + 3 * m * t * t * c[i] + t * t * t * d[i]) as Pt; };
const line = (a: Pt, b: Pt): Curve => t => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const chain = (...fs: Curve[]): Curve => t => { const n = fs.length, k = Math.min(n - 1, Math.floor(t * n)); return fs[k](t * n - k); };
const spline = (P: Pt[]): Curve => {
  const n = P.length, L = [0];
  for (let i = 1; i < n; i++) L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const T = L[n - 1];
  return t => {
    const s = Math.max(0, Math.min(1, t)) * T; let i = 0; while (i < n - 2 && L[i + 1] < s) i++;
    const u = (s - L[i]) / ((L[i + 1] - L[i]) || 1), p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n - 1, i + 2)];
    return [0, 1].map(k => .5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u * u + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u * u * u)) as Pt;
  };
};
const smoothLerp = (pairs: [number, number][]) => (t: number) => {
  for (let i = 1; i < pairs.length; i++) if (t <= pairs[i][0]) { const [a, va] = pairs[i - 1], [b, vb] = pairs[i]; const u = (t - a) / (b - a); return va + (vb - va) * (u * u * (3 - 2 * u)); }
  return pairs[pairs.length - 1][1];
};
/* 旋律字串：'q5' 四分、'h3' 二分、'e6' 八分、'[e2 e3]' 八分連桿、'{x4 x5}' 十六分連桿 */
let gid = 0;
const mel = (str: string, ta: number, tb: number): Note[] => {
  const toks = str.match(/\[[^\]]*\]|\{[^}]*\}|\S+/g) || [];
  const width = (s: string) => s[0] === '[' || s[0] === '{' ? s.slice(1, -1).trim().split(/\s+/).length * .8 : s[0] === 'h' ? 1.4 : 1;
  const total = toks.reduce((a, s) => a + width(s), 0); let pos = 0; const out: Note[] = [];
  const one = (s: string, t: number, grp?: string, beam?: string) => { const m = s.match(/^([qhex])(-?\d+)([b#]?)$/)!; out.push([t, +m[2], beam || ({ q: 'q', h: 'h', e: '8', x: '16' } as any)[m[1]], m[3] || undefined, grp]); };
  toks.forEach(s => { const w = width(s); if (s[0] === '[' || s[0] === '{') { const inner = s.slice(1, -1).trim().split(/\s+/), g = 'm' + gid++; inner.forEach((x, i) => one(x, ta + (tb - ta) * (pos + .4 + i * .8) / total, g, s[0] === '[' ? 'b8' : 'b16')); } else one(s, ta + (tb - ta) * (pos + w / 2) / total); pos += w; });
  return out;
};

/* ---------- 六種樂譜 ---------- */
const SPECS: Record<string, Spec> = {
  // 照使用者第一張圖：S 形、中間轉一個彎，越往右越細
  'score-glow': { W: 870, H: 669, gap: smoothLerp([[0, 56], [.3, 31], [.45, 19], [.6, 23], [.75, 30], [1, 18]]), lw: 5.5, lwFn: t => 1 - .55 * t,
    c: spline([[118, 345], [230, 326], [300, 296], [360, 280], [425, 290], [468, 335], [478, 395], [492, 448], [522, 482], [565, 482], [610, 452], [660, 420], [720, 401], [805, 380]]),
    clefT: .03, clefUpright: true, clefK: 1, clefDy: .6, key: [[.08, 4, 'b']], span: [[.15, .34], [.66, .97]], count: 9,
    notes: [[.2, 2, 'b16', undefined, 'a1'], [.245, 5, 'b16', undefined, 'a1'], [.31, 6, 'h'], [.35, 3, 'q'],
      [.6, 1, 'b8', undefined, 'a3'], [.635, 3, 'b8', undefined, 'a3'], [.76, 5, 'h'], [.79, 1, '8'], [.83, 2, '8'], [.885, 5, 'b16', undefined, 'a4'], [.925, 7, 'b16', undefined, 'a4'], [.965, 6, 'h']] },
  // 照使用者第二張圖：往右上飛、越遠越細
  'score-wave': { W: 750, H: 540, gap: smoothLerp([[0, 58], [.2, 37], [.4, 31], [.62, 24], [.8, 13], [1, 5]]), lw: 4.5, lwFn: t => 1 - .7 * t,
    c: spline([[0, 372], [150, 369], [280, 404], [370, 398], [430, 330], [470, 250], [505, 180], [560, 104], [640, 55], [745, 22]]),
    clefT: .1, clefUpright: true, clefK: 1.08, clefDy: -.2, span: [[.19, .8]], count: 10,
    notes: [[.209, 3, '8'], [.273, 0, 'q'], [.328, 4, 'q'], [.353, 0, 'b8', undefined, 'b1'], [.405, 0, 'b8', undefined, 'b1'], [.461, 1, 'q'], [.485, 3, 'b16', undefined, 'b2'], [.525, 3, 'b16', undefined, 'b2'], [.576, 3, '8'], [.675, 1, '8'], [.729, 5, 'b16', undefined, 'b3'], [.758, 1, 'b16', undefined, 'b3']] },
  'score-line': { W: 1200, H: 700, gap: 34, lw: 4, c: bez([60, 430], [420, 140], [780, 640], [1140, 300]), clefT: .045, key: [[.118, 4, 'b']], span: [[.19, .97]], count: 11,
    notes: mel('q2 [e4 e5] q6 h5 [e3 e2] q1 q3 h4', .19, .97) },
  'score-arch': { W: 1200, H: 700, gap: 34, lw: 4, c: line([60, 350], [1140, 350]), clefT: .045, bars: [.5, .99], span: [[.1, .97]], count: 10,
    notes: mel('q2 q4 [e5 e6] q7 q6 [e5 e4] h3', .1, .97) },
  'score-float': { W: 1200, H: 700, gap: 34, lw: 4, clefT: .045, span: [[.1, .97]], count: 9,
    c: chain(bez([60, 360], [160, 260], [260, 260], [360, 360]), bez([360, 360], [460, 460], [560, 460], [660, 360]), bez([660, 360], [760, 260], [860, 260], [960, 360]), bez([960, 360], [1020, 420], [1090, 430], [1140, 400])),
    notes: mel('[e2 e3] q4 [e5 e4] q3 [e2 e4] q6 h5', .1, .97) },
  'score-ribbon': { W: 1200, H: 700, gap: t => 34 * (1.25 - .7 * t), lw: 4, c: bez([60, 380], [420, 120], [760, 640], [1140, 260]), clefT: .045, span: [[.12, .95]], count: 10,
    notes: mel('q3 [e4 e5] q6 q5 [e4 e3] q2 h4', .12, .95) },
};
export const SCORE_KINDS = Object.keys(SPECS);
/** kind 可以帶隨機種子：'score-wave@123'（見 scoreKindOf） */
const baseOf = (kind: string) => kind.split('@')[0];
export const isScoreKind = (k?: string) => !!k && baseOf(k) in SPECS;
/** 畫圖時用的 kind：有隨機種子就接在後面 */
export const scoreKindOf = (kind: string, seed?: number) => (seed && isScoreKind(kind) ? `${baseOf(kind)}@${seed}` : kind);

/* ---------- 隨機音符（照樂理） ---------- */
const rng = (seed: number) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const randomNotes = (spec: Spec, seed: number): Note[] => {
  const r = rng(seed);
  // 節奏：四分、二分、八分、八分連桿兩顆、十六分連桿兩顆，佔的寬度不同
  const pool: [string, number][] = [['q', 1], ['q', 1], ['h', 1.4], ['8', 1], ['b8', 1.6], ['b8', 1.6], ['b16', 1.6]];
  const toks: [string, number][] = []; let n = 0;
  while (n < spec.count) { const k = pool[Math.floor(r() * pool.length)]; toks.push(k); n += k[0].startsWith('b') ? 2 : 1; }
  const total = toks.reduce((a, k) => a + k[1], 0);
  // 幾個區段接成一條：位置 0～1 換算回各區段的 t
  const lens = spec.span.map(([a, b]) => b - a), sumL = lens.reduce((a, b) => a + b, 0);
  const tAt = (u: number) => { let x = u * sumL; for (let i = 0; i < spec.span.length; i++) { if (x <= lens[i] || i === spec.span.length - 1) return spec.span[i][0] + Math.min(x, lens[i]); x -= lens[i]; } return spec.span[0][0]; };
  // 音高：從第二線到第四間附近起跳，一次走一到兩步，不超出五線譜（不需要加線）
  let p = 2 + Math.floor(r() * 5);
  const step = () => { const d = [-2, -1, -1, 1, 1, 2, 0][Math.floor(r() * 7)]; p = Math.max(0, Math.min(8, p + d)); if (p === 0 || p === 8) p += p === 0 ? 1 : -1; return p; };
  const out: Note[] = []; let pos = 0, g = 0;
  toks.forEach(([type, w]) => {
    if (type.startsWith('b')) { const grp = 'r' + g++; [0, 1].forEach(i => out.push([tAt((pos + .4 + i * .8) / total), step(), type, undefined, grp])); }
    else out.push([tAt((pos + w / 2) / total), step(), type]);
    pos += w;
  });
  return out;
};

/* ---------- 幾何 ---------- */
const area = (q: Pt[]) => { let a = 0; for (let i = 0; i < q.length; i++) { const [x, y] = q[i], [nx, ny] = q[(i + 1) % q.length]; a += x * ny - nx * y; } return a / 2; };
/** 實心一律順時針（螢幕座標 y 往下時面積為正），洞反過來 */
const orient = (q: Pt[], hole = false) => ((area(q) > 0) === hole ? q.slice().reverse() : q);
const ellipse = (cx: number, cy: number, rx: number, ry: number, rot: number, n = 28): Pt[] => {
  const c = Math.cos(rot), s = Math.sin(rot), out: Pt[] = [];
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, x = Math.cos(a) * rx, y = Math.sin(a) * ry; out.push([cx + x * c - y * s, cy + x * s + y * c]); }
  return out;
};
const rect = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const cubicPts = (a: Pt, b: Pt, c: Pt, d: Pt, n = 10): Pt[] => Array.from({ length: n }, (_, i) => bez(a, b, c, d)((i + 1) / n));

type Frame = { o: Pt; u: Pt; v: Pt };
function build(kind: string, w: number, h: number): Pt[][] {
  const [base, seedS] = kind.split('@');
  const spec = SPECS[base];
  const box = bboxOf(base);
  const sx = w / box.w, sy = h / box.h, k = Math.min(sx, sy);
  const C = (t: number): Pt => { const p = spec.c(Math.max(0, Math.min(1, t))); return [(p[0] - box.x) * sx, (p[1] - box.y) * sy]; };
  const gap = (t: number) => (typeof spec.gap === 'number' ? spec.gap : spec.gap(t)) * k;
  const frame = (t: number): Frame => { const e = 1e-3, a = C(t - e), b = C(t + e); let ux = b[0] - a[0], uy = b[1] - a[1]; const n = Math.hypot(ux, uy) || 1; ux /= n; uy /= n; return { o: C(t), u: [ux, uy], v: [uy, -ux] }; };
  const polys: Pt[][] = [];
  const holes: Pt[][] = [];
  // 五線譜：每條線做成一條有寬度的帶子（線寬可以沿線慢慢變細）
  const N = 140;
  for (let li = -2; li <= 2; li++) {
    const L: Pt[] = [], R: Pt[] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, f = frame(t), gg = gap(t), off = li * gg, hw = spec.lw * k * (spec.lwFn ? spec.lwFn(t) : 1) / 2;
      const cx = f.o[0] + f.v[0] * off, cy = f.o[1] + f.v[1] * off;
      L.push([cx + f.v[0] * hw, cy + f.v[1] * hw]); R.push([cx - f.v[0] * hw, cy - f.v[1] * hw]);
    }
    polys.push(orient([...L, ...R.reverse()]));
  }
  // 在 (t, p) 的局部座標：x 沿著線、y 往下（往五線譜下方）
  const at = (t: number, p: number) => { const f = frame(t), g = gap(t), off = (p - 4) * g / 2; return { x: f.o[0] + f.v[0] * off, y: f.o[1] + f.v[1] * off, u: f.u, v: f.v, g }; };
  const toG = (q: { x: number; y: number; u: Pt; v: Pt }, [lx, ly]: Pt): Pt => [q.x + q.u[0] * lx - q.v[0] * ly, q.y + q.u[1] * lx - q.v[1] * ly];
  const put = (q: any, pts: Pt[], hole = false) => (hole ? holes : polys).push(orient(pts.map(p => toG(q, p)), hole));
  // 降記號：一根直線＋右下的小肚子
  const flat = (q: any, dx: number) => {
    const g = q.g;
    put(q, rect(dx - .33 * g, -2.3 * g, .16 * g, 2.9 * g));
    put(q, ellipse(dx + .05 * g, .05 * g, .42 * g, .34 * g, -.5));
    put(q, ellipse(dx + .02 * g, .02 * g, .2 * g, .14 * g, -.5), true);
  };
  // 譜號
  {
    const q0 = at(spec.clefT, 4);
    const q = spec.clefUpright ? { ...q0, u: [1, 0] as Pt, v: [0, -1] as Pt } : q0;
    const g = q.g * (spec.clefK || 1), H = 7.4 * g, Wc = CLEF_W * H, bottom = 3.5 * q.g - (spec.clefDy || 0) * q.g;
    const loops = CLEF_LOOPS.map(loop => { const pts: Pt[] = []; for (let j = 0; j < loop.length; j += 2) pts.push([(loop[j] / CLEF_W - .5) * Wc, bottom - (1 - loop[j + 1]) * H]); return pts; });
    // 面積最大的那圈是外框，其他都是洞
    const big = loops.reduce((m, l, i) => (Math.abs(area(l)) > Math.abs(area(loops[m])) ? i : m), 0);
    loops.forEach((pts, i) => (i === big ? polys : holes).push(orient(pts.map(p => toG(q, p)), i !== big)));
  }
  (spec.key || []).forEach(([t, p]) => flat(at(t, p), 0));
  (spec.bars || []).forEach(t => { const q = at(t, 4); put(q, rect(-.07 * q.g, -2 * q.g, .14 * q.g, 4 * q.g)); });
  // 音符
  const notes: Note[] = (seedS ? randomNotes(spec, +seedS) : spec.notes).map(n => [...n] as Note);
  const groups: Record<string, number[]> = {};
  notes.forEach((n, i) => { if (n[4]) (groups[n[4]] = groups[n[4]] || []).push(i); });
  // 曲線轉太快的地方（或兩顆隔太遠），連桿會歪 —— 那一組改成各自帶符尾
  Object.entries(groups).forEach(([gk, ids]) => {
    const a = frame(notes[ids[0]][0]).u, b = frame(notes[ids[ids.length - 1]][0]).u;
    if (Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1])) > .35 || notes[ids[ids.length - 1]][0] - notes[ids[0]][0] > .09) {
      ids.forEach(i => { notes[i] = [notes[i][0], notes[i][1], notes[i][2] === 'b16' ? '16' : '8', notes[i][3]]; });
      delete groups[gk];
    }
  });
  const up = (i: number) => { const n = notes[i]; if (n[4] && groups[n[4]]) { const ids = groups[n[4]]; return ids.reduce((s, j) => s + notes[j][1], 0) / ids.length < 4; } return n[1] < 4; };
  const stemLen = 3.3;
  const tips: Record<number, { b: Pt; tip: Pt; g: number }> = {};
  Object.values(groups).forEach(ids => {
    const isUp = up(ids[0]);
    const base = ids.map(i => { const q = at(notes[i][0], notes[i][1]); const sxl = isUp ? .56 : -.56; const b = toG(q, [sxl * q.g, 0]); const d: Pt = isUp ? [q.v[0], q.v[1]] : [-q.v[0], -q.v[1]]; return { q, b, d }; });
    const A = base[0], B = base[base.length - 1];
    let ta: Pt = [A.b[0] + A.d[0] * stemLen * A.q.g, A.b[1] + A.d[1] * stemLen * A.q.g], tb: Pt = [B.b[0] + B.d[0] * stemLen * B.q.g, B.b[1] + B.d[1] * stemLen * B.q.g];
    const inter = (x: typeof A) => { const ex = tb[0] - ta[0], ey = tb[1] - ta[1]; const den = x.d[0] * ey - x.d[1] * ex; return ((ta[0] - x.b[0]) * ey - (ta[1] - x.b[1]) * ex) / (den || 1e-9); };
    base.forEach(x => { const s = inter(x) / x.q.g; if (s < 2.6) { const push = (2.6 - s) * x.q.g; ta = [ta[0] + A.d[0] * push, ta[1] + A.d[1] * push]; tb = [tb[0] + B.d[0] * push, tb[1] + B.d[1] * push]; } });
    base.forEach((x, j) => { const s = inter(x); tips[ids[j]] = { b: x.b, tip: [x.b[0] + x.d[0] * s, x.b[1] + x.d[1] * s], g: x.q.g }; });
    const g = (A.q.g + B.q.g) / 2, th = .5 * g;
    const beam = (off: number) => { const a: Pt = [ta[0] - A.d[0] * off, ta[1] - A.d[1] * off], b: Pt = [tb[0] - B.d[0] * off, tb[1] - B.d[1] * off]; polys.push(orient([a, b, [b[0] - B.d[0] * th, b[1] - B.d[1] * th], [a[0] - A.d[0] * th, a[1] - A.d[1] * th]])); };
    beam(0); if (notes[ids[0]][2] === 'b16') beam(.8 * g);
  });
  notes.forEach((n, i) => {
    const [t, p, type, acc] = n; const q = at(t, p), g = q.g, isUp = up(i);
    if (type === 'h') { put(q, ellipse(0, 0, .62 * g, .43 * g, -.38)); put(q, ellipse(0, 0, .42 * g, .2 * g, -.38), true); }
    else put(q, ellipse(0, 0, .62 * g, .43 * g, -.38));
    if (acc) flat(q, -1.55 * g);
    if (tips[i]) {
      // 連桿的符桿：從符頭到連桿，用整體座標畫一個細長方形
      const { b, tip } = tips[i]; const dx = tip[0] - b[0], dy = tip[1] - b[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L * .065 * g, ny = dx / L * .065 * g;
      polys.push(orient([[b[0] + nx, b[1] + ny], [tip[0] + nx, tip[1] + ny], [tip[0] - nx, tip[1] - ny], [b[0] - nx, b[1] - ny]]));
      return;
    }
    const x = isUp ? .56 * g : -.56 * g, tip = isUp ? -stemLen * g : stemLen * g;
    put(q, rect(x - .065 * g, Math.min(0, tip), .13 * g, Math.abs(tip)));
    const flag = (y0: number) => { const s = isUp ? 1 : -1; put(q, [[x, y0], ...cubicPts([x, y0], [x + .15 * g, y0 + s * .9 * g], [x + 1.15 * g, y0 + s * 1.3 * g], [x + .75 * g, y0 + s * 2.6 * g]), ...cubicPts([x + .75 * g, y0 + s * 2.6 * g], [x + .85 * g, y0 + s * 1.7 * g], [x + .35 * g, y0 + s * 1.35 * g], [x, y0 + s * 1.15 * g])]); };
    if (type === '8' || type === '16') { flag(tip); if (type === '16') flag(tip + (isUp ? .85 : -.85) * g); }
  });
  return [...polys, ...holes];
}
/* 預設（沒有擠壓、預設音符）的外框，當作縮放的基準 —— 隨機音符時框不會跟著跳 */
const boxCache = new Map<string, { x: number; y: number; w: number; h: number }>();
function bboxOf(base: string) {
  let b = boxCache.get(base);
  if (b) return b;
  boxCache.set(base, { x: 0, y: 0, w: 1, h: 1 });   // 先放一個，build 裡面才不會遞迴
  const polys = build(base, 1, 1);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  polys.forEach(q => q.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }));
  b = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  boxCache.set(base, b);
  return b;
}
/** 新增時的高÷寬 */
export const scoreRatio = (kind: string) => { const b = bboxOf(baseOf(kind)); return b.h / b.w; };

const cache = new Map<string, string>();
export const scorePathD = (kind: string, w: number, h: number) => {
  if (!isScoreKind(kind) || !(w > 0) || !(h > 0)) return '';
  const key = `${kind}|${w.toFixed(1)}|${h.toFixed(1)}`;
  const hit = cache.get(key); if (hit) return hit;
  const f = (n: number) => String(Math.round(n * 100) / 100);
  const d = build(kind, w, h).map(q => 'M ' + q.map(([x, y]) => `${f(x)} ${f(y)}`).join(' L ') + ' Z').join(' ');
  cache.set(key, d);
  if (cache.size > 48) cache.delete(cache.keys().next().value!);
  return d;
};
