/* 曲線內插：單調三次 Hermite（Fritsch–Carlson）。
 *
 * 控制點之間不會「衝過頭」—— 兩個點都在 0 以上，中間就不會掉到 0 以下，
 * 這是調色曲線最重要的性質（Catmull-Rom、自然樣條都會在陡的地方甩出波紋，
 * 波紋落在顏色上就是色帶與髒色）。Resolve、Lightroom 的色相曲線看起來也是這種
 * 「平滑但不甩」的手感。
 *
 * periodic：x 是色相（0 與 1 是同一點），曲線頭尾相接，斜率也連續。 */

export type CurvePt = { x: number; y: number };

/** 把控制點取樣成 n 格的表（x 均勻分布在 0..1；循環時第 n 格不含 x=1） */
export function sampleCurve(pts: CurvePt[], n: number, periodic: boolean, neutral: number): Float32Array {
  const out = new Float32Array(n);
  const p = [...pts].sort((a, b) => a.x - b.x);
  if (!p.length) { out.fill(neutral); return out; }
  if (p.length === 1) { out.fill(p[0].y); return out; }
  // 循環：前後各補一圈，邊界上的斜率就跟中間一樣算
  const xs: number[] = [], ys: number[] = [];
  if (periodic) {
    const k = p.length;
    for (let i = -2; i < k + 2; i++) { const q = p[(i + k) % k]; xs.push(q.x + Math.floor(i / k)); ys.push(q.y); }
  } else { for (const q of p) { xs.push(q.x); ys.push(q.y); } }
  const m = xs.length;
  const d: number[] = [], t: number[] = new Array(m).fill(0);
  for (let i = 0; i < m - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-9, xs[i + 1] - xs[i]));
  for (let i = 1; i < m - 1; i++) t[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  if (!periodic) { t[0] = d[0]; t[m - 1] = d[m - 2]; }
  for (let i = 0; i < m - 1; i++) {
    if (d[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / d[i], b = t[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const s = 3 / Math.sqrt(h); t[i] = s * a * d[i]; t[i + 1] = s * b * d[i]; }
  }
  let seg = 0;
  for (let j = 0; j < n; j++) {
    const x = periodic ? j / n : j / (n - 1);
    if (!periodic && x <= xs[0]) { out[j] = ys[0]; continue; }
    if (!periodic && x >= xs[m - 1]) { out[j] = ys[m - 1]; continue; }
    while (seg < m - 2 && x > xs[seg + 1]) seg++;
    while (seg > 0 && x < xs[seg]) seg--;
    const x0 = xs[seg], x1 = xs[seg + 1], hh = x1 - x0, u = (x - x0) / hh;
    const h00 = 2 * u * u * u - 3 * u * u + 1, h10 = u * u * u - 2 * u * u + u, h01 = -2 * u * u * u + 3 * u * u, h11 = u * u * u - u * u;
    out[j] = h00 * ys[seg] + h10 * hh * t[seg] + h01 * ys[seg + 1] + h11 * hh * t[seg + 1];
  }
  return out;
}

/** 從表裡線性取值（periodic 時頭尾相接） */
export function tableAt(tab: Float32Array, off: number, n: number, x: number, periodic: boolean): number {
  if (periodic) {
    let f = (x - Math.floor(x)) * n;
    const i = Math.floor(f); f -= i;
    return tab[off + (i % n)] * (1 - f) + tab[off + ((i + 1) % n)] * f;
  }
  const f = Math.min(1, Math.max(0, x)) * (n - 1), i = Math.min(n - 2, Math.floor(f));
  return tab[off + i] + (tab[off + i + 1] - tab[off + i]) * (f - i);
}
