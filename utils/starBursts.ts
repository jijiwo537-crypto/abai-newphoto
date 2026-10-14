/* 星芒：鏡頭光芒那種會發光的星。不是固定圖片，是照參數畫出來的 ——
   放大不會糊、顏色可以換。全部用 'lighter'（相加）疊上去，跟真的光一樣越疊越亮。
   座標：以中心為原點，R＝框的一半；ray.len 1 就是剛好碰到框邊。
   規則（主人定的）：每一種都要上下左右對稱、不能只是別種轉個角度；
   漸層一律用平滑曲線取很多個點，芒的兩側用柔焦散開，不能有硬邊。 */

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
  /** 一大把細芒：n 條平均分佈，長度照 pattern 輪流（所以一定對稱） */
  fine?: { n: number; len: number; pattern: number[]; w: number; alpha: number; off?: number };
  /** 光環：r 半徑、w 光帶寬度（都是 R 的比例） */
  rings?: { r: number; w: number; alpha: number }[];
  /** 穿過中心、兩頭都長出去的光條（橫向光條那種，比芒寬、比較扁） */
  streaks?: { a: number; len: number; w: number; alpha: number }[];
};

/** n 條平均分佈的芒，從 off 度開始 */
const even = (n: number, len: number, w: number, off = 0, alpha = 1): BurstRay[] =>
  Array.from({ length: n }, (_, i) => ({ a: off + (360 / n) * i, len, w, alpha }));
/** 十字：直的、橫的可以不一樣長 */
const cross = (v: number, h: number, w: number, alpha = 1): BurstRay[] =>
  [{ a: -90, len: v, w, alpha }, { a: 90, len: v, w, alpha }, { a: 0, len: h, w, alpha }, { a: 180, len: h, w, alpha }];

export const STAR_BURSTS: StarBurstSpec[] = [
  { id: 'sb-cross-thin', name: '細長十字', core: .05, glow: .24, rays: cross(1, 1, .03) },
  { id: 'sb-cross-tall', name: '長直十字', core: .05, glow: .22, rays: cross(1, .6, .03) },
  { id: 'sb-cross-soft', name: '柔光十字', core: .07, glow: .34, glowAlpha: .8, rays: [...cross(.85, .85, .09, .35), ...cross(1, 1, .026)] },
  { id: 'sb-needle', name: '針芒', core: .035, glow: .15, rays: cross(1, 1, .013) },
  { id: 'sb-cross-short', name: '短芒十字', core: .08, glow: .36, glowAlpha: .85, rays: cross(.55, .55, .055) },
  { id: 'sb-cross-double', name: '雙層十字', core: .06, glow: .26, rays: [...cross(1, 1, .022), ...cross(.42, .42, .07, .7)] },
  { id: 'sb-six', name: '六芒', core: .05, glow: .24, rays: even(6, .95, .03, 90) },
  { id: 'sb-six-ring', name: '六芒光環', core: .05, glow: .22, rays: even(6, .9, .026, 90), rings: [{ r: .5, w: .07, alpha: .55 }] },
  { id: 'sb-eight', name: '八芒', core: .055, glow: .25, rays: [...cross(1, 1, .03), ...even(4, .55, .026, 45, .85)] },
  { id: 'sb-eight-even', name: '均勻八芒', core: .055, glow: .25, rays: even(8, .9, .027) },
  { id: 'sb-diamond', name: '鑽石光', core: .06, glow: .26, rays: [...cross(1, 1, .028), ...even(4, .24, .09, 45, .55)] },
  { id: 'sb-ten', name: '十芒', core: .055, glow: .25, rays: even(10, .85, .025, 90) },
  { id: 'sb-twelve', name: '十二芒', core: .06, glow: .27, rays: [...cross(1, 1, .032), ...even(8, .62, .021, 22.5, .8)] },
  { id: 'sb-twelve-even', name: '均勻十二芒', core: .06, glow: .27, rays: even(12, .8, .022) },
  { id: 'sb-sixteen', name: '十六芒', core: .06, glow: .27, rays: [...cross(1, 1, .028), ...even(4, .7, .022, 45, .85), ...even(8, .45, .017, 22.5, .7)] },
  { id: 'sb-flash', name: '閃光', core: .07, glow: .32, rays: [...cross(1, 1, .036), ...even(4, .6, .026, 45, .8)],
    fine: { n: 32, len: .48, pattern: [1, .55, .8, .6], w: .012, alpha: .4, off: 5.625 } },
  { id: 'sb-fine', name: '細芒放射', core: .06, glow: .27, fine: { n: 48, len: .85, pattern: [1, .62, .82, .55, .9, .6], w: .013, alpha: .55 } },
  { id: 'sb-soft-rays', name: '柔芒放射', core: .08, glow: .34, rays: even(16, .62, .06, 0, .4) },
  { id: 'sb-orb', name: '光球', core: .14, glow: .44, glowAlpha: .95, fine: { n: 48, len: .66, pattern: [1, .7, .85, .62], w: .015, alpha: .38 } },
  { id: 'sb-orb-cross', name: '光球十字', core: .1, glow: .38, rays: cross(1, 1, .028), fine: { n: 32, len: .52, pattern: [1, .65, .8, .6], w: .014, alpha: .38, off: 5.625 } },
  { id: 'sb-sun', name: '放射球', core: .12, glow: .4, rays: even(24, .62, .018, 0, .7) },
  { id: 'sb-burst', name: '星爆', core: .09, glow: .38, rays: [...cross(1, 1, .036), ...even(4, .72, .028, 45, .9), ...even(8, .5, .018, 22.5, .7)],
    fine: { n: 48, len: .4, pattern: [1, .7, .85, .6], w: .011, alpha: .35, off: 3.75 } },
  { id: 'sb-dot', name: '光點', core: .09, glow: .42, glowAlpha: .9, rays: cross(.4, .4, .028, .8) },
  { id: 'sb-ring', name: '光環十字', core: .045, glow: .18, rays: cross(1, 1, .02), rings: [{ r: .46, w: .075, alpha: .6 }] },
  { id: 'sb-ring-eight', name: '光環八芒', core: .05, glow: .22, rays: [...cross(1, 1, .026), ...even(4, .5, .02, 45, .8)], rings: [{ r: .58, w: .07, alpha: .5 }] },
  { id: 'sb-double-ring', name: '雙環', core: .045, glow: .2, rays: cross(.95, .95, .022), rings: [{ r: .3, w: .055, alpha: .55 }, { r: .64, w: .065, alpha: .4 }] },
  { id: 'sb-ring-orb', name: '光環光球', core: .11, glow: .36, glowAlpha: .9, rings: [{ r: .62, w: .08, alpha: .5 }] },
  { id: 'sb-halo-wide', name: '大光暈', core: .06, glow: .26, rays: even(8, .78, .022), rings: [{ r: .45, w: .13, alpha: .28 }] },
  { id: 'sb-anamorphic', name: '橫向光條', core: .06, glow: .26, streaks: [{ a: 0, len: 1, w: .05, alpha: .85 }], rays: cross(.32, .2, .028, .8) },
  { id: 'sb-streak-cross', name: '光條十字', core: .065, glow: .28, streaks: [{ a: 0, len: 1, w: .045, alpha: .6 }], rays: cross(1, .7, .028) },
];

const rgb = (hex: string) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgba = (c: number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(4)})`;
/** 照一條平滑曲線取很多個停點 —— 只放三四個點的話，轉折的地方會看得出一圈一圈的接縫 */
const smoothStops = (gr: CanvasGradient, f: (t: number) => number, c: number[] | ((t: number) => number[]), steps = 24) => {
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    gr.addColorStop(t, rgba(typeof c === 'function' ? c(t) : c, f(t)));
  }
};

/** 一條芒：細細的光針，亮度沿著長度平滑地淡掉；兩側用陰影柔焦散開（高斯那種），不會有硬邊。 */
const drawRay = (g: CanvasRenderingContext2D, ang: number, L: number, W: number, a: number, c: number[], soft = 2.6) => {
  if (L <= 0 || W <= 0 || a <= 0) return;
  g.save();
  g.rotate(ang);
  const gr = g.createLinearGradient(0, 0, L, 0);
  smoothStops(gr, t => a * Math.pow(1 - t, 1.6) * (1 - .25 * t), c, 16);
  g.fillStyle = gr;
  g.shadowColor = rgba(c, .9);
  g.shadowBlur = Math.max(1, W * soft);
  g.beginPath();
  g.moveTo(0, -W / 2);
  g.quadraticCurveTo(L * .3, -W * .2, L, 0);
  g.quadraticCurveTo(L * .3, W * .2, 0, W / 2);
  g.closePath();
  g.fill();
  g.restore();
};

/** 光核：中間一小塊純白，外面是帶顏色的柔光，兩段都用平滑曲線 */
const drawGlow = (g: CanvasRenderingContext2D, core: number, glow: number, a: number, c: number[]) => {
  const halo = g.createRadialGradient(0, 0, 0, 0, 0, glow);
  smoothStops(halo, t => a * .55 * Math.pow(1 - t, 2.4), c, 24);
  g.fillStyle = halo;
  g.beginPath(); g.arc(0, 0, glow, 0, Math.PI * 2); g.fill();
  const cr = core * 2.2;
  const hot = g.createRadialGradient(0, 0, 0, 0, 0, cr);
  smoothStops(hot, t => a * Math.exp(-Math.pow(t * 2.2, 2) * 1.1), [255, 255, 255], 24);
  g.fillStyle = hot;
  g.beginPath(); g.arc(0, 0, cr, 0, Math.PI * 2); g.fill();
};

/** 光環：剖面是柔和的光帶（中間亮、兩側平滑淡掉），內緣偏暖、外緣偏冷一點點，像鏡頭裡的光暈 */
const drawRing = (g: CanvasRenderingContext2D, r: number, w: number, a: number, c: number[]) => {
  const E = 3.2, r0 = Math.max(0, r - w * E), r1 = r + w * E;
  const gr = g.createRadialGradient(0, 0, r0, 0, 0, r1);
  const warm = [c[0], Math.round(c[1] * .96), Math.round(c[2] * .9)];
  const cool = [Math.round(c[0] * .9), Math.round(c[1] * .96), c[2]];
  const mid = (r - r0) / (r1 - r0), hw = w / (r1 - r0);
  const mix = (t: number) => {
    const k = Math.max(0, Math.min(1, (t - mid) / (hw * 2) + .5));
    return [0, 1, 2].map(i => Math.round(warm[i] * (1 - k) + cool[i] * k));
  };
  // 高斯剖面＋一層更寬更淡的光；兩頭再乘一個平滑的窗，到內外邊緣剛好是 0（不然會看到一圈硬邊）
  smoothStops(gr, t => {
    const d = (t - mid) / hw, win = Math.cos(Math.min(1, Math.abs(d) / E) * Math.PI / 2) ** 2;
    return a * win * (Math.exp(-d * d * 1.2) * .8 + Math.exp(-d * d * .3) * .25);
  }, mix, 48);
  g.fillStyle = gr;
  g.beginPath(); g.arc(0, 0, r1, 0, Math.PI * 2); g.fill();
};

/** 在 (cx,cy) 畫一顆星芒，size 是外框的邊長。color 是光的顏色（光核永遠偏白，像真的光）。 */
export const drawStarBurst = (g: CanvasRenderingContext2D, spec: StarBurstSpec, cx: number, cy: number, size: number, color = '#ffffff', alpha = 1) => {
  const R = size / 2, c = rgb(color);
  g.save();
  g.translate(cx, cy);
  g.globalCompositeOperation = 'lighter';
  for (const ring of spec.rings || []) drawRing(g, ring.r * R, ring.w * R, ring.alpha * alpha, c);
  if (spec.fine) {
    const f = spec.fine;
    for (let i = 0; i < f.n; i++) {
      const k = f.pattern[i % f.pattern.length];
      drawRay(g, ((f.off ?? 0) + (360 / f.n) * i) * Math.PI / 180, f.len * k * R, f.w * R, f.alpha * alpha * (.55 + .45 * k), c);
    }
  }
  for (const s of spec.streaks || []) {
    const ang = s.a * Math.PI / 180;
    drawRay(g, ang, s.len * R, s.w * R, s.alpha * alpha, c, 3.5);
    drawRay(g, ang + Math.PI, s.len * R, s.w * R, s.alpha * alpha, c, 3.5);
  }
  for (const r of spec.rays || []) drawRay(g, (r.a * Math.PI) / 180, r.len * R, r.w * R, (r.alpha ?? 1) * alpha, c);
  if (spec.core || spec.glow) drawGlow(g, (spec.core ?? .05) * R, (spec.glow ?? .22) * R, (spec.glowAlpha ?? 1) * alpha, c);
  g.restore();
};
