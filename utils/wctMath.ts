/* WCT（白化－上色轉換）的數學：Li et al. 2017《Universal Style Transfer via Feature Transforms》，
   WCT2（Yoo et al. 2019）在每一層都做一次。自己實作，不依賴外部程式。
     白化：  x̂ = Ec Dc^-1/2 Ecᵀ (x − μc)          （內容特徵的相關性去掉）
     上色：  y  = Es Ds^1/2  Esᵀ x̂ + μs            （換成參考圖特徵的相關性）
   兩步合成一個 C×C 矩陣 T＝Ws·Wc，整張特徵只乘一次。

   對稱矩陣的特徵分解用 Householder 三對角化＋隱式位移 QL（標準的數值方法），
   512×512 在瀏覽器裡一次不到一秒。 */

/** 對稱矩陣 A（n×n，列優先 Float64Array）的特徵分解：回傳特徵值 d 與特徵向量 V（V 的第 j 欄對應 d[j]） */
export function eigSym(A: Float64Array, n: number): { d: Float64Array; V: Float64Array } {
  const V = new Float64Array(A), d = new Float64Array(n), e = new Float64Array(n);
  const at = (i: number, j: number) => i * n + j;
  // ── Householder：化成三對角 ──
  for (let j = 0; j < n; j++) d[j] = V[at(n - 1, j)];
  for (let i = n - 1; i > 0; i--) {
    let scale = 0, h = 0;
    for (let k = 0; k < i; k++) scale += Math.abs(d[k]);
    if (scale === 0) {
      e[i] = d[i - 1];
      for (let j = 0; j < i; j++) { d[j] = V[at(i - 1, j)]; V[at(i, j)] = 0; V[at(j, i)] = 0; }
    } else {
      for (let k = 0; k < i; k++) { d[k] /= scale; h += d[k] * d[k]; }
      let f = d[i - 1], g = Math.sqrt(h);
      if (f > 0) g = -g;
      e[i] = scale * g; h -= f * g; d[i - 1] = f - g;
      for (let j = 0; j < i; j++) e[j] = 0;
      for (let j = 0; j < i; j++) {
        f = d[j]; V[at(j, i)] = f; g = e[j] + V[at(j, j)] * f;
        for (let k = j + 1; k <= i - 1; k++) { g += V[at(k, j)] * d[k]; e[k] += V[at(k, j)] * f; }
        e[j] = g;
      }
      f = 0;
      for (let j = 0; j < i; j++) { e[j] /= h; f += e[j] * d[j]; }
      const hh = f / (h + h);
      for (let j = 0; j < i; j++) e[j] -= hh * d[j];
      for (let j = 0; j < i; j++) {
        f = d[j]; g = e[j];
        for (let k = j; k <= i - 1; k++) V[at(k, j)] -= f * e[k] + g * d[k];
        d[j] = V[at(i - 1, j)]; V[at(i, j)] = 0;
      }
    }
    d[i] = h;
  }
  for (let i = 0; i < n - 1; i++) {
    V[at(n - 1, i)] = V[at(i, i)]; V[at(i, i)] = 1;
    const h = d[i + 1];
    if (h !== 0) {
      for (let k = 0; k <= i; k++) d[k] = V[at(k, i + 1)] / h;
      for (let j = 0; j <= i; j++) {
        let g = 0;
        for (let k = 0; k <= i; k++) g += V[at(k, i + 1)] * V[at(k, j)];
        for (let k = 0; k <= i; k++) V[at(k, j)] -= g * d[k];
      }
    }
    for (let k = 0; k <= i; k++) V[at(k, i + 1)] = 0;
  }
  for (let j = 0; j < n; j++) { d[j] = V[at(n - 1, j)]; V[at(n - 1, j)] = 0; }
  V[at(n - 1, n - 1)] = 1; e[0] = 0;
  // ── 隱式位移 QL：三對角的特徵值與向量 ──
  for (let i = 1; i < n; i++) e[i - 1] = e[i];
  e[n - 1] = 0;
  let f = 0, tst1 = 0;
  const eps = 2 ** -52;
  for (let l = 0; l < n; l++) {
    tst1 = Math.max(tst1, Math.abs(d[l]) + Math.abs(e[l]));
    let m = l;
    while (m < n) { if (Math.abs(e[m]) <= eps * tst1) break; m++; }
    if (m > l) {
      for (let iter = 0; iter < 60; iter++) {
        let g = d[l], p = (d[l + 1] - g) / (2 * e[l]), r = Math.hypot(p, 1);
        if (p < 0) r = -r;
        d[l] = e[l] / (p + r); d[l + 1] = e[l] * (p + r);
        const dl1 = d[l + 1]; let h = g - d[l];
        for (let i = l + 2; i < n; i++) d[i] -= h;
        f += h;
        p = d[m];
        let c = 1, c2 = c, c3 = c, el1 = e[l + 1], s = 0, s2 = 0;
        for (let i = m - 1; i >= l; i--) {
          c3 = c2; c2 = c; s2 = s;
          g = c * e[i]; h = c * p; r = Math.hypot(p, e[i]);
          e[i + 1] = s * r; s = e[i] / r; c = p / r;
          p = c * d[i] - s * g; d[i + 1] = h + s * (c * g + s * d[i]);
          for (let k = 0; k < n; k++) {
            h = V[at(k, i + 1)];
            V[at(k, i + 1)] = s * V[at(k, i)] + c * h;
            V[at(k, i)] = c * V[at(k, i)] - s * h;
          }
        }
        p = -s * s2 * c3 * el1 * e[l] / dl1; e[l] = s * p; d[l] = c * p;
        if (Math.abs(e[l]) <= eps * tst1) break;
      }
    }
    d[l] += f; e[l] = 0;
  }
  return { d, V };
}

/** 特徵（C 個通道 × N 個位置，Float32Array 依通道排）的平均與共變異數（＋單位矩陣，跟原論文一樣，避免奇異） */
function stats(x: Float32Array, C: number, N: number) {
  const mean = new Float64Array(C);
  for (let c = 0; c < C; c++) { let s = 0; const o = c * N; for (let i = 0; i < N; i++) s += x[o + i]; mean[c] = s / N; }
  const cov = new Float64Array(C * C), row = new Float64Array(N);
  const cen = new Float32Array(C * N);
  for (let c = 0; c < C; c++) { const o = c * N, m = mean[c]; for (let i = 0; i < N; i++) cen[o + i] = x[o + i] - m; }
  for (let a = 0; a < C; a++) {
    const oa = a * N;
    for (let i = 0; i < N; i++) row[i] = cen[oa + i];
    for (let b = a; b < C; b++) {
      const ob = b * N; let s = 0;
      for (let i = 0; i < N; i++) s += row[i] * cen[ob + i];
      const v = s / Math.max(1, N - 1) + (a === b ? 1 : 0);
      cov[a * C + b] = v; cov[b * C + a] = v;
    }
  }
  return { mean, cov, cen };
}

/** 對稱半正定矩陣的 f(Σ)：特徵值各自套 f */
function symFn(cov: Float64Array, C: number, f: (v: number) => number) {
  const { d, V } = eigSym(cov, C), out = new Float64Array(C * C);
  for (let k = 0; k < C; k++) {
    const fk = f(Math.max(1e-5, d[k]));
    for (let i = 0; i < C; i++) { const vik = V[i * C + k] * fk; if (!vik) continue; for (let j = 0; j < C; j++) out[i * C + j] += vik * V[j * C + k]; }
  }
  return out;
}

/** 參考圖那一層的上色資料（同一張參考圖可以重複用） */
export type StyleStat = { C: number; mean: Float64Array; color: Float64Array };
export function styleStat(s: Float32Array, C: number, N: number): StyleStat {
  const st = stats(s, C, N);
  return { C, mean: st.mean, color: symFn(st.cov, C, Math.sqrt) };
}

/** 對內容特徵 x（C×N）做 WCT，就地改寫。結果夾在內容原本的最小、最大值之間（跟原論文一樣） */
export function wctInPlace(x: Float32Array, C: number, N: number, s: StyleStat) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < x.length; i++) { const v = x[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const st = stats(x, C, N);
  const W = symFn(st.cov, C, v => 1 / Math.sqrt(v));
  // T = 上色 × 白化
  const T = new Float64Array(C * C);
  for (let i = 0; i < C; i++) for (let k = 0; k < C; k++) { const a = s.color[i * C + k]; if (!a) continue; for (let j = 0; j < C; j++) T[i * C + j] += a * W[k * C + j]; }
  const Tf = new Float32Array(T), cen = st.cen, acc = new Float32Array(N);
  for (let i = 0; i < C; i++) {
    acc.fill(0);
    for (let k = 0; k < C; k++) { const t = Tf[i * C + k]; if (!t) continue; const o = k * N; for (let n = 0; n < N; n++) acc[n] += t * cen[o + n]; }
    const m = s.mean[i], o = i * N;
    for (let n = 0; n < N; n++) { const v = acc[n] + m; x[o + n] = v < lo ? lo : v > hi ? hi : v; }
  }
}
