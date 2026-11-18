/* 「樂譜」分類：六種樂譜圖形。輪廓資料在 scoreShapesData.ts（長邊 1000 的座標，只有 M／L／Z），
   這裡照目前的框寬高縮放。洞（譜號、空心音符）的繞行方向跟外圈相反，用一般的填色規則就會挖空。 */
import { SCORE_RAW } from './scoreShapesData';

export const SCORE_KINDS = ['score-glow', 'score-wave', 'score-line', 'score-arch', 'score-float', 'score-ribbon'];
export const isScoreKind = (k?: string) => !!k && k in SCORE_RAW;
/** 新增時的高÷寬 */
export const scoreRatio = (kind: string) => { const r = SCORE_RAW[kind]; return r ? r.h / r.w : 1; };

/* 第一次用到時才把字串拆成數字（每個子路徑一組 x,y,x,y…） */
const parsed = new Map<string, Float32Array[]>();
const loopsOf = (kind: string) => {
  let p = parsed.get(kind);
  if (!p) {
    p = SCORE_RAW[kind].d.split('Z').map(s => s.replace('M', '').trim()).filter(Boolean)
      .map(s => Float32Array.from(s.split(/\s+/).map(Number)));
    parsed.set(kind, p);
  }
  return p;
};
const cache = new Map<string, string>();
export const scorePathD = (kind: string, w: number, h: number) => {
  const raw = SCORE_RAW[kind]; if (!raw) return '';
  const key = `${kind}|${w.toFixed(2)}|${h.toFixed(2)}`;
  const hit = cache.get(key); if (hit) return hit;
  const sx = w / raw.w, sy = h / raw.h, f = (n: number) => String(Math.round(n * 100) / 100);
  let d = '';
  for (const a of loopsOf(kind)) {
    d += `M ${f(a[0] * sx)} ${f(a[1] * sy)}`;
    for (let i = 2; i < a.length; i += 2) d += ` L ${f(a[i] * sx)} ${f(a[i + 1] * sy)}`;
    d += ' Z ';
  }
  cache.set(key, d);
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  return d;
};
