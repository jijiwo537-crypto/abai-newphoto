/* 星芒：鏡頭光芒那種會發光的星。不是固定圖片，是照參數畫出來的 ——
   放大不會糊、顏色可以換。全部用 'lighter'（相加）疊上去，跟真的光一樣越疊越亮。
   座標：以中心為原點，R＝框的一半；ray.len 1 就是剛好碰到框邊。 */

export type BurstRay = { a: number; len: number; w: number; alpha?: number };
export type StarBurstSpec = {
  id: string;
  name: string;
  /** 光核半徑（R 的比例） */
  core?: number;
  /** 光核外面那圈柔光的半徑與亮度 */
  glow?: number;
  glowAlpha?: number;
  rays?: BurstRay[];
  /** 一大把隨機長短的細芒 */
  fine?: { n: number; len: [number, number]; w: number; alpha: number; seed: number };
  /** 光環 */
  rings?: { r: number; w: number; alpha: number }[];
  /** 穿過中心、兩頭都長出去的一條長光線 */
  streaks?: { a: number; len: number; w: number; alpha: number }[];
  /** 旁邊散落的小星 */
  cluster?: { n: number; seed: number; shape: 'disc' | 'band' | 'ring'; size: [number, number]; spread?: number; angle?: number; rays?: 4 | 6 | 8 };
};

/** n 條平均分佈的芒，從 off 度開始 */
const even = (n: number, len: number, w: number, off = 0, alpha = 1): BurstRay[] =>
  Array.from({ length: n }, (_, i) => ({ a: off + (360 / n) * i, len, w, alpha }));
/** 十字：直的、橫的可以不一樣長 */
const cross = (v: number, h: number, w: number, off = 0, alpha = 1): BurstRay[] =>
  [{ a: off - 90, len: v, w, alpha }, { a: off + 90, len: v, w, alpha }, { a: off, len: h, w, alpha }, { a: off + 180, len: h, w, alpha }];

export const STAR_BURSTS: StarBurstSpec[] = [
  { id: 'sb-cross-thin', name: '細長十字', core: .05, glow: .22, rays: cross(1, 1, .035) },
  { id: 'sb-cross-tall', name: '長直十字', core: .05, glow: .2, rays: cross(1, .62, .035) },
  { id: 'sb-cross-wide', name: '橫長十字', core: .05, glow: .2, rays: cross(.55, 1, .035) },
  { id: 'sb-cross-soft', name: '柔光十字', core: .07, glow: .32, glowAlpha: .7, rays: [...cross(.9, .9, .11, 0, .35), ...cross(1, 1, .03)] },
  { id: 'sb-x', name: '斜十字', core: .05, glow: .22, rays: even(4, 1, .035, 45) },
  { id: 'sb-needle', name: '針芒', core: .035, glow: .14, rays: cross(1, 1, .016) },
  { id: 'sb-six', name: '六芒', core: .05, glow: .22, rays: even(6, .95, .035, 90) },
  { id: 'sb-six-tilt', name: '斜六芒', core: .05, glow: .22, rays: even(6, .95, .035, 0) },
  { id: 'sb-eight', name: '八芒', core: .055, glow: .24, rays: [...cross(1, 1, .035), ...even(4, .55, .03, 45, .85)] },
  { id: 'sb-eight-even', name: '均勻八芒', core: .055, glow: .24, rays: even(8, .9, .03, 0) },
  { id: 'sb-eight-x', name: '長斜八芒', core: .055, glow: .24, rays: [...cross(.75, .75, .03), ...even(4, 1, .03, 45)] },
  { id: 'sb-ten', name: '十芒', core: .055, glow: .24, rays: even(10, .85, .028, 90) },
  { id: 'sb-twelve', name: '十二芒', core: .06, glow: .26, rays: [...cross(1, 1, .035), ...even(8, .62, .024, 22.5, .8)] },
  { id: 'sb-sixteen', name: '十六芒', core: .06, glow: .26, rays: [...cross(1, 1, .03), ...even(4, .7, .024, 45, .85), ...even(8, .45, .018, 22.5, .7)] },
  { id: 'sb-flash', name: '閃光', core: .07, glow: .3, rays: [...cross(1, .95, .04), ...even(4, .62, .028, 45, .8)],
    fine: { n: 18, len: [.25, .55], w: .016, alpha: .45, seed: 3 } },
  { id: 'sb-fine', name: '細芒放射', core: .06, glow: .26, fine: { n: 48, len: [.5, .85], w: .014, alpha: .55, seed: 2 } },
  { id: 'sb-orb', name: '光球', core: .14, glow: .42, glowAlpha: .9, fine: { n: 46, len: [.35, .7], w: .016, alpha: .4, seed: 11 } },
  { id: 'sb-orb-cross', name: '光球十字', core: .1, glow: .36, rays: cross(1, 1, .03), fine: { n: 30, len: [.3, .55], w: .015, alpha: .4, seed: 5 } },
  { id: 'sb-sun', name: '放射球', core: .12, glow: .38, rays: even(24, .62, .02, 0, .7) },
  { id: 'sb-dot', name: '光點', core: .09, glow: .4, glowAlpha: .9, rays: cross(.42, .42, .03, 0, .8) },
  { id: 'sb-ring', name: '光環十字', core: .045, glow: .16, rays: cross(1, 1, .02), rings: [{ r: .42, w: .05, alpha: .55 }] },
  { id: 'sb-ring-eight', name: '光環八芒', core: .05, glow: .2, rays: [...cross(1, 1, .028), ...even(4, .5, .022, 45, .8)], rings: [{ r: .55, w: .04, alpha: .4 }] },
  { id: 'sb-double-ring', name: '雙環', core: .045, glow: .18, rays: cross(.95, .95, .024), rings: [{ r: .3, w: .035, alpha: .45 }, { r: .62, w: .03, alpha: .3 }] },
  { id: 'sb-streak', name: '斜長光', core: .06, glow: .24, rays: cross(.75, .75, .032), streaks: [{ a: -40, len: 1, w: .022, alpha: .9 }],
    fine: { n: 16, len: [.2, .4], w: .014, alpha: .45, seed: 9 } },
  { id: 'sb-anamorphic', name: '橫向光條', core: .06, glow: .24, streaks: [{ a: 0, len: 1, w: .05, alpha: .85 }], rays: cross(.35, .2, .03, 0, .8) },
  { id: 'sb-random', name: '碎芒', core: .055, glow: .24, fine: { n: 12, len: [.45, 1], w: .03, alpha: .85, seed: 21 } },
  { id: 'sb-twin', name: '星芒＋小星', core: .05, glow: .2, rays: cross(.8, .8, .032),
    cluster: { n: 4, seed: 4, shape: 'ring', size: [.12, .22], spread: .72 } },
  { id: 'sb-band', name: '星塵帶', core: .05, glow: .2, rays: cross(.75, .9, .03),
    cluster: { n: 26, seed: 8, shape: 'band', size: [.04, .17], spread: .95, angle: -50 } },
  { id: 'sb-cluster', name: '星群', core: .045, glow: .18, rays: even(4, .5, .028, 0, .9),
    cluster: { n: 42, seed: 12, shape: 'disc', size: [.03, .11], spread: .92 } },
  { id: 'sb-sparkles', name: '閃爍星點', cluster: { n: 9, seed: 31, shape: 'disc', size: [.1, .3], spread: .8, rays: 4 } },
];

const rng = (seed: number) => {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

const rgb = (hex: string) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** 一條芒：中間寬、往尖端收細，亮度從中心往外漸淡。先畫一層寬而淡的光暈，再畫一層細而亮的芯。 */
const drawRay = (g: CanvasRenderingContext2D, ang: number, L: number, W: number, a: number, c: number[]) => {
  if (L <= 0 || W <= 0 || a <= 0) return;
  g.save();
  g.rotate(ang);
  for (const [wm, am] of [[3.6, .3], [1, 1]] as const) {
    const w = W * wm;
    const gr = g.createLinearGradient(0, 0, L, 0);
    gr.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${a * am})`);
    gr.addColorStop(.3, `rgba(${c[0]},${c[1]},${c[2]},${a * am * .55})`);
    gr.addColorStop(.7, `rgba(${c[0]},${c[1]},${c[2]},${a * am * .15})`);
    gr.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(0, -w / 2);
    g.quadraticCurveTo(L * .25, -w * .12, L, 0);
    g.quadraticCurveTo(L * .25, w * .12, 0, w / 2);
    g.closePath();
    g.fill();
  }
  g.restore();
};

const drawGlow = (g: CanvasRenderingContext2D, core: number, glow: number, a: number, c: number[]) => {
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, glow);
  const k = Math.min(.95, core / glow);
  gr.addColorStop(0, `rgba(255,255,255,${a})`);
  gr.addColorStop(k * .5, `rgba(255,255,255,${a})`);
  gr.addColorStop(k, `rgba(${c[0]},${c[1]},${c[2]},${a * .55})`);
  gr.addColorStop(Math.min(1, k + (1 - k) * .35), `rgba(${c[0]},${c[1]},${c[2]},${a * .22})`);
  gr.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
  g.fillStyle = gr;
  g.beginPath(); g.arc(0, 0, glow, 0, Math.PI * 2); g.fill();
};

/** 一顆小星（星群、星塵帶用） */
const drawMini = (g: CanvasRenderingContext2D, s: number, rays: number, a: number, c: number[]) => {
  drawGlow(g, s * .14, s * .45, a, c);
  for (let i = 0; i < rays; i++) drawRay(g, (Math.PI * 2 / rays) * i - Math.PI / 2, s * (i % 2 && rays > 4 ? .6 : 1), s * .07, a, c);
};

/** 在 (cx,cy) 畫一顆星芒，size 是外框的邊長。color 是光的顏色（光核永遠偏白，像真的光）。 */
export const drawStarBurst = (g: CanvasRenderingContext2D, spec: StarBurstSpec, cx: number, cy: number, size: number, color = '#ffffff', alpha = 1) => {
  const R = size / 2, c = rgb(color);
  g.save();
  g.translate(cx, cy);
  g.globalCompositeOperation = 'lighter';
  for (const ring of spec.rings || []) {
    const r = ring.r * R, w = ring.w * R;
    const gr = g.createRadialGradient(0, 0, Math.max(0, r - w), 0, 0, r + w);
    gr.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0)`);
    gr.addColorStop(.5, `rgba(${c[0]},${c[1]},${c[2]},${ring.alpha * alpha})`);
    gr.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
    g.fillStyle = gr;
    g.beginPath(); g.arc(0, 0, r + w, 0, Math.PI * 2); g.arc(0, 0, Math.max(0, r - w), 0, Math.PI * 2, true); g.fill();
  }
  if (spec.fine) {
    const f = spec.fine, rnd = rng(f.seed);
    for (let i = 0; i < f.n; i++) {
      // 平均分佈再加一點亂數 —— 完全隨機的話會擠在一邊，看起來歪掉
      const ang = ((i + (rnd() - .5) * .9) / f.n) * Math.PI * 2, L = (f.len[0] + (f.len[1] - f.len[0]) * rnd()) * R;
      drawRay(g, ang, L, f.w * R * (.6 + rnd() * .8), f.alpha * alpha * (.45 + rnd() * .55), c);
    }
  }
  for (const s of spec.streaks || []) {
    const ang = s.a * Math.PI / 180;
    drawRay(g, ang, s.len * R, s.w * R, s.alpha * alpha, c);
    drawRay(g, ang + Math.PI, s.len * R, s.w * R, s.alpha * alpha, c);
  }
  for (const r of spec.rays || []) drawRay(g, (r.a * Math.PI) / 180, r.len * R, r.w * R, (r.alpha ?? 1) * alpha, c);
  if (spec.cluster) {
    const cl = spec.cluster, rnd = rng(cl.seed), sp = (cl.spread ?? .9) * R;
    const rot = ((cl.angle ?? 0) * Math.PI) / 180;
    for (let i = 0; i < cl.n; i++) {
      let x: number, y: number;
      if (cl.shape === 'band') { const t = rnd() * 2 - 1, o = (rnd() - .5) * .38; x = t * sp; y = o * sp * (1 - Math.abs(t) * .5); }
      else if (cl.shape === 'ring') { const a = rnd() * Math.PI * 2, d = sp * (.55 + rnd() * .45); x = Math.cos(a) * d; y = Math.sin(a) * d; }
      else { const a = rnd() * Math.PI * 2, d = sp * Math.sqrt(rnd()); x = Math.cos(a) * d; y = Math.sin(a) * d; }
      const px = x * Math.cos(rot) - y * Math.sin(rot), py = x * Math.sin(rot) + y * Math.cos(rot);
      const s = (cl.size[0] + (cl.size[1] - cl.size[0]) * Math.pow(rnd(), 2.2)) * R;
      g.save(); g.translate(px, py);
      drawMini(g, s, cl.rays ?? (rnd() < .2 ? 8 : 4), alpha * (.55 + rnd() * .45), c);
      g.restore();
    }
  }
  if (spec.core || spec.glow) drawGlow(g, (spec.core ?? .05) * R, (spec.glow ?? .22) * R, (spec.glowAlpha ?? 1) * alpha, c);
  g.restore();
};
