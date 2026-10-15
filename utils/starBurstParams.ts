/* 星芒的「自訂參數」：把一顆星芒拆成幾個看得懂的旋鈕（光核、三組芒、細芒、兩個光環、光條），
   排序工具的星芒頁用它來讓主人自己調。數值都是 0～幾百的整數，方便用滑桿、也方便複製給 Claude。
   長度、半徑以「框的一半」為 100；寬度以千分之一為單位。 */
import type { StarBurstSpec, BurstRay } from './starBursts';

export type RayGroup = {
  /** 幾條（0＝關掉） */
  n: number;
  /** 直的那條的長度（0～100） */
  len: number;
  /** 橫的那條相對於直的長度（%）：100＝一樣長，小於 100 橫的比較短 */
  aspect: number;
  /** 粗細（千分之一框寬） */
  w: number;
  /** 亮度（%） */
  alpha: number;
  /** 從正上方開始轉幾度 */
  rot: number;
  /** 斷層：在芒的哪裡（0＝根部、100＝尖端）、多寬、淡掉多少（0＝沒有斷層，100＝完全斷開） */
  gapPos?: number; gapW?: number; gapDepth?: number;
};
export type BurstParams = {
  core: number; glow: number; glowAlpha: number;
  /** 柔光集中度 0～100（越大越貼著光核） */
  glowConc?: number;
  groups: [RayGroup, RayGroup, RayGroup];
  fineN: number; fineLen: number; fineVar: number; fineW: number; fineAlpha: number; fineRot: number;
  /** 從現成星芒帶過來的細芒長短規律，跟當時的長短差；「長短差」照比例放大縮小這個規律 */
  finePattern?: number[]; fineVarBase?: number;
  rings: [{ r: number; w: number; alpha: number }, { r: number; w: number; alpha: number }];
  streakLen: number; streakW: number; streakAlpha: number;
  /** 整體發光：範圍（框的一半＝100）、強度（%） */
  bloomR?: number; bloomA?: number;
};

const OFF: RayGroup = { n: 0, len: 60, aspect: 100, w: 25, alpha: 80, rot: 45 };
const r0 = (v: number) => Math.round(v);

/** 參數 → 畫圖用的規格。id 跟著參數變，快取才不會拿到舊的圖 */
export const paramsToSpec = (p: BurstParams, name = '自訂'): StarBurstSpec => {
  const rays: BurstRay[] = [];
  for (const g of p.groups) {
    if (g.n <= 0 || g.len <= 0 || g.w <= 0 || g.alpha <= 0) continue;
    for (let i = 0; i < g.n; i++) {
      const deg = -90 + g.rot + (360 / g.n) * i, t = (deg * Math.PI) / 180;
      // 直的方向長度＝len，橫的方向＝len×aspect，中間平滑過渡（橢圓）
      const k = Math.hypot(Math.sin(t), (g.aspect / 100) * Math.cos(t));
      rays.push({ a: deg, len: Math.min(1, (g.len / 100) * k), w: g.w / 1000, alpha: g.alpha / 100,
        ...(g.gapDepth ? { gap: { pos: (g.gapPos ?? 50) / 100, w: (g.gapW ?? 12) / 100, depth: g.gapDepth / 100 } } : {}) });
    }
  }
  const v = p.fineVar / 100;
  const spec: StarBurstSpec = {
    id: 'custom-' + JSON.stringify(p).split('').reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7).toString(36),
    name,
    core: p.core / 100, glow: p.glow / 100, glowAlpha: p.glowAlpha / 100, glowConc: (p.glowConc ?? 20) / 100,
    rays,
    rings: p.rings.filter(r => r.r > 0 && r.w > 0 && r.alpha > 0).map(r => ({ r: r.r / 100, w: r.w / 1000, alpha: r.alpha / 100 })),
  };
  if (p.fineN > 0 && p.fineLen > 0 && p.fineAlpha > 0)
    spec.fine = {
      n: p.fineN, len: p.fineLen / 100,
      pattern: p.finePattern && p.fineVarBase
        ? p.finePattern.map(x => 1 - (1 - x) * (p.fineVar / p.fineVarBase!))
        : [1, 1 - v * .45, 1 - v * .18, 1 - v * .4],
      w: p.fineW / 1000, alpha: p.fineAlpha / 100, off: p.fineRot,
    };
  if ((p.bloomA ?? 0) > 0 && (p.bloomR ?? 0) > 0) spec.bloom = { r: p.bloomR! / 100, a: p.bloomA! / 100 };
  if (p.streakLen > 0 && p.streakAlpha > 0) spec.streaks = [{ a: 0, len: p.streakLen / 100, w: p.streakW / 1000, alpha: p.streakAlpha / 100 }];
  return spec;
};

/** 現成的星芒 → 參數（當作自訂的起點）。芒依「粗細＋亮度」分組，最長的那組當主芒。 */
export const specToParams = (s: StarBurstSpec): BurstParams => {
  const byKey = new Map<string, BurstRay[]>();
  for (const r of s.rays || []) {
    const k = `${r.w}|${r.alpha ?? 1}|${JSON.stringify(r.gap ?? null)}`;
    byKey.set(k, [...(byKey.get(k) || []), r]);
  }
  const groups = [...byKey.values()]
    .sort((a, b) => Math.max(...b.map(r => r.len)) - Math.max(...a.map(r => r.len)))
    .slice(0, 3)
    .map((rs): RayGroup => {
      const norm = (d: number) => ((d % 360) + 360) % 360;
      const vert = rs.find(r => norm(r.a) === 270 || norm(r.a) === 90);
      const hor = rs.find(r => norm(r.a) === 0 || norm(r.a) === 180);
      const len = vert ? vert.len : Math.max(...rs.map(r => r.len));
      const step = 360 / rs.length;
      const rot = Math.min(...rs.map(r => norm(r.a + 90) % step));
      const gp = rs[0].gap;
      return { n: rs.length, len: r0(len * 100), aspect: vert && hor ? r0((hor.len / vert.len) * 100) : 100, w: r0(rs[0].w * 1000), alpha: r0((rs[0].alpha ?? 1) * 100), rot: r0(rot * 100) / 100,
        gapPos: gp ? r0(gp.pos * 100) : 50, gapW: gp ? r0(gp.w * 100) : 12, gapDepth: gp ? r0(gp.depth * 100) : 0 };
    });
  while (groups.length < 3) groups.push({ ...OFF });
  const f = s.fine;
  const ring = (i: number) => s.rings?.[i] ? { r: r0(s.rings[i].r * 100), w: r0(s.rings[i].w * 1000), alpha: r0(s.rings[i].alpha * 100) } : { r: 0, w: 70, alpha: 50 };
  const st = s.streaks?.[0];
  return {
    core: r0((s.core ?? .05) * 100 * 10) / 10, glow: r0((s.glow ?? .22) * 100), glowAlpha: r0((s.glowAlpha ?? 1) * 100), glowConc: r0((s.glowConc ?? .2) * 100),
    groups: groups as BurstParams['groups'],
    fineN: f?.n ?? 0, fineLen: f ? r0(f.len * 100) : 60, fineVar: f ? r0(((1 - Math.min(...f.pattern)) / .45) * 100) : 60,
    fineW: f ? r0(f.w * 1000) : 13, fineAlpha: f ? r0(f.alpha * 100) : 45, fineRot: f?.off ?? 0,
    ...(f ? { finePattern: f.pattern, fineVarBase: r0(((1 - Math.min(...f.pattern)) / .45) * 100) } : {}),
    rings: [ring(0), ring(1)],
    bloomR: s.bloom ? r0(s.bloom.r * 100) : 30, bloomA: s.bloom ? r0(s.bloom.a * 100) : 0,
    streakLen: st ? r0(st.len * 100) : 0, streakW: st ? r0(st.w * 1000) : 50, streakAlpha: st ? r0(st.alpha * 100) : 80,
  };
};
