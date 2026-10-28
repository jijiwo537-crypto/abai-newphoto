/* 修補（仿製／修復筆）。
 *
 * 跟 Lightroom、Photoshop 的修復筆刷同一套做法：
 *  1. 使用者塗出要修的範圍（覆蓋率 alpha，邊緣是柔的）。
 *  2. findHealSource：自動找一塊「拿來蓋上去最像」的來源 —— 比的是範圍外面那一圈（周圍的樣子），
 *     不是範圍裡面（裡面正是要去掉的東西）。先在縮小的圖上找整個附近，再回原尺寸細修。
 *  3. applyHeal：
 *     · 仿製（clone）：來源像素原封不動搬過來，用柔邊接上。
 *     · 修復（heal）：搬來源的「質感」，明暗與顏色跟著目標周圍走 —— 在範圍外那一圈量
 *       「目標 − 來源」的差，用推拉金字塔（push–pull）把這個差平順地補滿整個範圍
 *       （膜插值，跟 Poisson 融合同一個效果），加回來源上。所以就算來源比較亮、偏色，
 *       蓋上去也看不出接縫。
 * 座標都是像素。來源位置用位移 (dx, dy) 表示：目標點 p 拿 p + (dx, dy) 的像素。
 * 重播（復原／重做、原尺寸輸出）只需要 alpha 與 (dx, dy)，不再搜尋，結果完全一樣。
 */

export type HealMode = 'heal' | 'clone';
export type HealRect = { x: number; y: number; w: number; h: number };

/** alpha > 0 的外框 */
export function alphaBounds(alpha: Float32Array, W: number, H: number, hint?: HealRect | null): HealRect | null {
  const x0 = hint ? Math.max(0, hint.x) : 0, y0 = hint ? Math.max(0, hint.y) : 0;
  const x1 = hint ? Math.min(W, hint.x + hint.w) : W, y1 = hint ? Math.min(H, hint.y + hint.h) : H;
  let a = Infinity, b = Infinity, c = -1, d = -1;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (alpha[y * W + x] > 0.002) {
    if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y;
  }
  return c < 0 ? null : { x: a, y: b, w: c - a + 1, h: d - b + 1 };
}

/* ── 自動找來源 ──────────────────────────────────────────────── */

/** 縮小的網格：box 平均 RGB 與最大 alpha */
function shrink(src: Uint8ClampedArray, alpha: Float32Array, W: number, H: number, win: HealRect, s: number) {
  const gw = Math.max(1, Math.floor(win.w / s)), gh = Math.max(1, Math.floor(win.h / s));
  const rgb = new Float32Array(gw * gh * 3), m = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    let r = 0, g = 0, b = 0, n = 0, am = 0;
    const sx = win.x + gx * s, sy = win.y + gy * s;
    for (let y = sy; y < Math.min(H, sy + s); y++) for (let x = sx; x < Math.min(W, sx + s); x++) {
      const o = (y * W + x) * 4; r += src[o]; g += src[o + 1]; b += src[o + 2]; n++;
      const a = alpha[y * W + x]; if (a > am) am = a;
    }
    const i = gy * gw + gx;
    rgb[i * 3] = r / n; rgb[i * 3 + 1] = g / n; rgb[i * 3 + 2] = b / n;
    m[i] = am > 0.02 ? 1 : 0;
  }
  return { gw, gh, rgb, m };
}

/** 方形擴張 d 格（水平、垂直各一趟前綴和，成本跟 d 無關） */
function dilate(m: Uint8Array, gw: number, gh: number, d: number) {
  if (d <= 0) return m;
  const tmp = new Uint8Array(gw * gh), out = new Uint8Array(gw * gh);
  const pre = new Int32Array(Math.max(gw, gh) + 1);
  for (let y = 0; y < gh; y++) {
    pre[0] = 0; for (let x = 0; x < gw; x++) pre[x + 1] = pre[x] + m[y * gw + x];
    for (let x = 0; x < gw; x++) tmp[y * gw + x] = pre[Math.min(gw, x + d + 1)] - pre[Math.max(0, x - d)] > 0 ? 1 : 0;
  }
  for (let x = 0; x < gw; x++) {
    pre[0] = 0; for (let y = 0; y < gh; y++) pre[y + 1] = pre[y] + tmp[y * gw + x];
    for (let y = 0; y < gh; y++) out[y * gw + x] = pre[Math.min(gh, y + d + 1)] - pre[Math.max(0, y - d)] > 0 ? 1 : 0;
  }
  return out;
}

/**
 * 在一個縮小網格上評分所有位移。回傳前幾名（格子單位）。
 * 分數 ＝ 周圍那一圈的色差（主要）＋ 來源裡面的紋理強度跟周圍差多少 ＋ 一點點距離懲罰。
 */
function scoreGrid(g: ReturnType<typeof shrink>, ringW: number, range: number, keep: number,
  center?: { ox: number; oy: number; rad: number }) {
  const { gw, gh, rgb, m } = g;
  const big = dilate(m, gw, gh, ringW);
  const near = dilate(m, gw, gh, 1);
  const ring: number[] = [], inner: number[] = [];
  let bx0 = gw, by0 = gh, bx1 = -1, by1 = -1;
  for (let i = 0; i < gw * gh; i++) {
    if (big[i] && !m[i]) ring.push(i);
    if (m[i]) inner.push(i);
    if (big[i]) { const x = i % gw, y = (i / gw) | 0; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  }
  if (!ring.length || !inner.length) return [];
  // 周圍一圈的平均紋理強度（相鄰格的色差）
  const grad = (i: number) => {
    const x = i % gw; const j = x + 1 < gw ? i + 1 : i - 1; const k = i + gw < gw * gh ? i + gw : i - gw;
    let e = 0;
    for (let c = 0; c < 3; c++) e += Math.abs(rgb[i * 3 + c] - rgb[j * 3 + c]) + Math.abs(rgb[i * 3 + c] - rgb[k * 3 + c]);
    return e;
  };
  let ringGrad = 0; for (const i of ring) ringGrad += grad(i); ringGrad /= ring.length;
  const ringStep = Math.max(1, Math.floor(ring.length / 320)), innerStep = Math.max(1, Math.floor(inner.length / 140));
  const best: { ox: number; oy: number; c: number }[] = [];
  const ringCnt = Math.ceil(ring.length / ringStep);
  const tryOff = (ox: number, oy: number) => {
    if (bx0 + ox < 0 || by0 + oy < 0 || bx1 + ox >= gw || by1 + oy >= gh) return;
    // 來源的範圍不能壓到目標本身（不然等於把要去掉的東西又搬回來）
    for (let n = 0; n < inner.length; n += innerStep) { const i = inner[n]; if (near[i + oy * gw + ox]) return; }
    let e = 0;
    // 已經比目前留下來最差的那名還差，就不用算完
    const cap = best.length >= keep ? best[best.length - 1].c * ringCnt : Infinity;
    for (let n = 0; n < ring.length; n += ringStep) {
      const i = ring[n], j = i + oy * gw + ox;
      const dr = rgb[i * 3] - rgb[j * 3], dg = rgb[i * 3 + 1] - rgb[j * 3 + 1], db = rgb[i * 3 + 2] - rgb[j * 3 + 2];
      e += dr * dr + dg * dg + db * db;
      if (e > cap) return;
    }
    e /= ringCnt;
    let tg = 0, tc = 0;
    for (let n = 0; n < inner.length; n += innerStep) { tg += grad(inner[n] + oy * gw + ox); tc++; }
    tg /= tc;
    const tex = (tg - ringGrad) * (tg - ringGrad) * 0.6;
    const dist = (ox * ox + oy * oy) / Math.max(1, (bx1 - bx0 + 1) * (by1 - by0 + 1));
    const c = e + tex + dist * 6;
    if (best.length < keep || c < best[best.length - 1].c) {
      best.push({ ox, oy, c }); best.sort((a, b) => a.c - b.c); if (best.length > keep) best.pop();
    }
  };
  if (center) {
    for (let oy = center.oy - center.rad; oy <= center.oy + center.rad; oy++)
      for (let ox = center.ox - center.rad; ox <= center.ox + center.rad; ox++) tryOff(ox, oy);
  } else {
    // 先每隔一格找，再在前幾名旁邊補齊
    for (let oy = -range; oy <= range; oy += 2) for (let ox = -range; ox <= range; ox += 2) if (ox || oy) tryOff(ox, oy);
    for (const b of best.slice()) for (let oy = b.oy - 1; oy <= b.oy + 1; oy++) for (let ox = b.ox - 1; ox <= b.ox + 1; ox++) if ((ox || oy) && (ox !== b.ox || oy !== b.oy)) tryOff(ox, oy);
  }
  return best;
}

/**
 * 自動找來源位移。src＝這一筆之前的整張圖，alpha＝這一筆的覆蓋率，rect＝alpha 的外框。
 * 找不到（例如整張都被塗滿）就回傳 null。
 */
export function findHealSource(src: Uint8ClampedArray, W: number, H: number, alpha: Float32Array, rect: HealRect): { dx: number; dy: number } | null {
  const span = Math.max(rect.w, rect.h);
  // 搜尋範圍：外框往外三倍（至少 60px），不超出整張圖
  const reach = Math.max(60, span * 3);
  const win: HealRect = {
    x: Math.max(0, Math.floor(rect.x - reach)), y: Math.max(0, Math.floor(rect.y - reach)), w: 0, h: 0,
  };
  win.w = Math.min(W, Math.ceil(rect.x + rect.w + reach)) - win.x;
  win.h = Math.min(H, Math.ceil(rect.y + rect.h + reach)) - win.y;
  // 粗找：目標外框縮到約 22 格
  const s0 = Math.max(1, Math.ceil(span / 22));
  const g0 = shrink(src, alpha, W, H, win, s0);
  const ring0 = Math.max(2, Math.round(span / s0 * 0.3));
  const range0 = Math.ceil(reach / s0);
  const top = scoreGrid(g0, ring0, range0, 4);
  if (!top.length) return null;
  // 細修：目標外框約 90 格，在粗找的前幾名附近各找一圈
  const s1 = Math.max(1, Math.ceil(span / 90));
  if (s1 >= s0) return { dx: top[0].ox * s0, dy: top[0].oy * s0 };
  const g1 = shrink(src, alpha, W, H, win, s1);
  const ring1 = Math.max(2, Math.round(span / s1 * 0.3));
  const k = s0 / s1, rad = Math.ceil(k) + 1;
  let pick = { ox: top[0].ox * k, oy: top[0].oy * k, c: Infinity };
  for (const t of top) {
    const r = scoreGrid(g1, ring1, 0, 1, { ox: Math.round(t.ox * k), oy: Math.round(t.oy * k), rad });
    if (r.length && r[0].c < pick.c) pick = r[0];
  }
  return { dx: Math.round(pick.ox * s1), dy: Math.round(pick.oy * s1) };
}

/* ── 套用 ─────────────────────────────────────────────────────── */

/** 推拉金字塔：w=1 的地方值已知，其餘從粗的那層平順補滿（雙線性上採樣，沒有方塊感） */
function pushPull(val: Float32Array, wt: Float32Array, w: number, h: number, ch: number) {
  const levels: { v: Float32Array; w: Float32Array; W: number; H: number }[] = [{ v: val, w: wt, W: w, H: h }];
  while (levels[levels.length - 1].W > 1 || levels[levels.length - 1].H > 1) {
    const p = levels[levels.length - 1];
    const W2 = Math.max(1, Math.ceil(p.W / 2)), H2 = Math.max(1, Math.ceil(p.H / 2));
    const v2 = new Float32Array(W2 * H2 * ch), w2 = new Float32Array(W2 * H2);
    for (let y = 0; y < p.H; y++) for (let x = 0; x < p.W; x++) {
      const i = y * p.W + x, q = (y >> 1) * W2 + (x >> 1), ww = p.w[i];
      if (!ww) continue;
      w2[q] += ww;
      for (let c = 0; c < ch; c++) v2[q * ch + c] += p.v[i * ch + c] * ww;
    }
    // 存成「已正規化的值」與「截到 1 的權重」
    for (let q = 0; q < W2 * H2; q++) {
      const ww = w2[q];
      if (ww > 0) for (let c = 0; c < ch; c++) v2[q * ch + c] /= ww;
      w2[q] = Math.min(1, ww);
    }
    levels.push({ v: v2, w: w2, W: W2, H: H2 });
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const f = levels[l], c = levels[l + 1];
    for (let y = 0; y < f.H; y++) for (let x = 0; x < f.W; x++) {
      const i = y * f.W + x, ww = f.w[i];
      if (ww >= 1) continue;
      // 粗層雙線性取樣（像素中心對齊）
      const fx = Math.max(0, Math.min(c.W - 1, (x + 0.5) / 2 - 0.5)), fy = Math.max(0, Math.min(c.H - 1, (y + 0.5) / 2 - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(c.W - 1, x0 + 1), y1 = Math.min(c.H - 1, y0 + 1);
      const ax = fx - x0, ay = fy - y0;
      for (let k = 0; k < ch; k++) {
        const s = (c.v[(y0 * c.W + x0) * ch + k] * (1 - ax) + c.v[(y0 * c.W + x1) * ch + k] * ax) * (1 - ay)
          + (c.v[(y1 * c.W + x0) * ch + k] * (1 - ax) + c.v[(y1 * c.W + x1) * ch + k] * ax) * ay;
        f.v[i * ch + k] = f.v[i * ch + k] * ww + s * (1 - ww);
      }
      f.w[i] = 1;
    }
  }
  return levels[0].v;
}

/**
 * 把一筆修補套到 dst 上。src 是「這一筆之前」的圖（可以跟 dst 是同一個陣列 —— 需要的部分會先複製出來）。
 * 回傳改到的範圍。
 */
export function applyHeal(src: Uint8ClampedArray, dst: Uint8ClampedArray, W: number, H: number,
  alpha: Float32Array, rect: HealRect, dx: number, dy: number, mode: HealMode, opacity = 1): HealRect | null {
  dx = Math.round(dx); dy = Math.round(dy);
  // 目標外框再往外留一圈，修復要在這一圈量「目標 − 來源」的差
  const pad = Math.max(3, Math.round(Math.max(rect.w, rect.h) * 0.06));
  const x0 = Math.max(0, rect.x - pad), y0 = Math.max(0, rect.y - pad);
  const x1 = Math.min(W, rect.x + rect.w + pad), y1 = Math.min(H, rect.y + rect.h + pad);
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return null;
  // 來源整塊都要在圖裡面（外框以外的部分超出就夾住）
  const T = new Float32Array(w * h * 3), S = new Float32Array(w * h * 3), A = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = x0 + x, gy = y0 + y, i = y * w + x, o = (gy * W + gx) * 4;
    const sx = Math.max(0, Math.min(W - 1, gx + dx)), sy = Math.max(0, Math.min(H - 1, gy + dy)), so = (sy * W + sx) * 4;
    T[i * 3] = src[o]; T[i * 3 + 1] = src[o + 1]; T[i * 3 + 2] = src[o + 2];
    S[i * 3] = src[so]; S[i * 3 + 1] = src[so + 1]; S[i * 3 + 2] = src[so + 2];
    A[i] = alpha[gy * W + gx];
  }
  let M: Float32Array | null = null;
  if (mode === 'heal') {
    // 已知值：範圍外面（覆蓋率幾乎是 0）的「目標 − 來源」；範圍裡面交給推拉補
    const val = new Float32Array(w * h * 3), wt = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) if (A[i] < 0.01) {
      wt[i] = 1;
      val[i * 3] = T[i * 3] - S[i * 3]; val[i * 3 + 1] = T[i * 3 + 1] - S[i * 3 + 1]; val[i * 3 + 2] = T[i * 3 + 2] - S[i * 3 + 2];
    }
    M = pushPull(val, wt, w, h, 3);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, a = A[i] * opacity;
    if (a <= 0) continue;
    const o = ((y0 + y) * W + x0 + x) * 4;
    for (let c = 0; c < 3; c++) {
      const s = S[i * 3 + c] + (M ? M[i * 3 + c] : 0);
      const t = T[i * 3 + c];
      dst[o + c] = t + (s - t) * a;
    }
  }
  return { x: x0, y: y0, w, h };
}

/* ── 外框輪廓 ─────────────────────────────────────────────────
 * 筆觸＝沿著路徑、半徑 r 的一串圓（膠囊的聯集）。用距離場做 marching squares，
 * 邊上做線性內插，得到平順的輪廓折線（工作像素座標）。畫面上的細白線、虛線都畫這條。 */
export function strokeContours(pts: number[], r: number, step: number): number[][] {
  const n = pts.length / 2;
  if (!n || r <= 0) return [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { const x = pts[i * 2], y = pts[i * 2 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  step = Math.max(0.5, step);
  const ox = x0 - r - step * 2, oy = y0 - r - step * 2;
  const gw = Math.ceil((x1 - x0 + 2 * r) / step) + 5, gh = Math.ceil((y1 - y0 + 2 * r) / step) + 5;
  // f > 0 在筆觸裡面
  const f = new Float32Array(gw * gh);
  const segDist2 = (px: number, py: number) => {
    let best = Infinity;
    if (n === 1) { const dx = px - pts[0], dy = py - pts[1]; return dx * dx + dy * dy; }
    for (let i = 0; i + 1 < n; i++) {
      const ax = pts[i * 2], ay = pts[i * 2 + 1], bx = pts[i * 2 + 2], by = pts[i * 2 + 3];
      const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy;
      let t = l2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = px - ax - vx * t, dy = py - ay - vy * t, d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    return best;
  };
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) f[j * gw + i] = r - Math.sqrt(segDist2(ox + i * step, oy + j * step));
  // 每一格的線段（邊的編號：0 上、1 右、2 下、3 左），端點用「邊的鍵」串起來
  const pt = (i: number, j: number, e: number): [number, number] => {
    const a = (ii: number, jj: number) => f[jj * gw + ii];
    let ax: number, ay: number, bx: number, by: number, fa: number, fb: number;
    if (e === 0) { ax = i; ay = j; bx = i + 1; by = j; } else if (e === 1) { ax = i + 1; ay = j; bx = i + 1; by = j + 1; }
    else if (e === 2) { ax = i; ay = j + 1; bx = i + 1; by = j + 1; } else { ax = i; ay = j; bx = i; by = j + 1; }
    fa = a(ax, ay); fb = a(bx, by);
    const t = fa === fb ? 0.5 : fa / (fa - fb);
    return [ox + (ax + (bx - ax) * t) * step, oy + (ay + (by - ay) * t) * step];
  };
  const key = (i: number, j: number, e: number) => e === 0 ? `h${i},${j}` : e === 2 ? `h${i},${j + 1}` : e === 3 ? `v${i},${j}` : `v${i + 1},${j}`;
  const adj = new Map<string, string[]>(), pos = new Map<string, [number, number]>();
  const link = (a: string, b: string) => { (adj.get(a) || adj.set(a, []).get(a)!).push(b); (adj.get(b) || adj.set(b, []).get(b)!).push(a); };
  const TABLE: number[][][] = [[], [[3, 2]], [[2, 1]], [[3, 1]], [[0, 1]], [[3, 0], [2, 1]], [[0, 2]], [[3, 0]], [[3, 0]], [[0, 2]], [[0, 1], [3, 2]], [[0, 1]], [[3, 1]], [[2, 1]], [[3, 2]], []];
  for (let j = 0; j + 1 < gh; j++) for (let i = 0; i + 1 < gw; i++) {
    const c = (f[j * gw + i] > 0 ? 8 : 0) | (f[j * gw + i + 1] > 0 ? 4 : 0) | (f[(j + 1) * gw + i + 1] > 0 ? 2 : 0) | (f[(j + 1) * gw + i] > 0 ? 1 : 0);
    for (const [ea, eb] of TABLE[c]) {
      const ka = key(i, j, ea), kb = key(i, j, eb);
      if (!pos.has(ka)) pos.set(ka, pt(i, j, ea));
      if (!pos.has(kb)) pos.set(kb, pt(i, j, eb));
      link(ka, kb);
    }
  }
  // 串成折線
  const seen = new Set<string>(), out: number[][] = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const line: number[] = [];
    let cur: string | undefined = start, prev = '';
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const p = pos.get(cur)!; line.push(p[0], p[1]);
      const nb: string[] = adj.get(cur) || [];
      const nx = nb.find(k => k !== prev && !seen.has(k));
      prev = cur; cur = nx;
    }
    if (line.length >= 4) { line.push(line[0], line[1]); out.push(line); }
  }
  return out;
}

/* ── 覆蓋率（距離場）──────────────────────────────────────────
 * 修補的範圍＝筆觸路徑往外 r 的膠囊聯集，邊緣用 smoothstep 羽化（跟 stampAlpha 同一條曲線）。
 * 先算一次「每個像素離路徑多遠 ÷ r」，之後調羽化只是查表重寫覆蓋率（不用整條筆觸重蓋一次），
 * 拉羽化滑桿才順。移動目標＝整塊平移，距離場直接搬過去用。 */
export type HealField = { x: number; y: number; w: number; h: number; t: Float32Array };
export function healField(pts: number[], r: number, W: number, H: number): HealField | null {
  const n = pts.length / 2;
  if (!n || r <= 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { const x = pts[i * 2], y = pts[i * 2 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const fx = Math.max(0, Math.floor(x0 - r - 1)), fy = Math.max(0, Math.floor(y0 - r - 1));
  const fw = Math.min(W, Math.ceil(x1 + r + 2)) - fx, fh = Math.min(H, Math.ceil(y1 + r + 2)) - fy;
  if (fw <= 0 || fh <= 0) return null;
  const t = new Float32Array(fw * fh).fill(2);
  const R2 = r * r;
  // 每一段只掃它自己的外框，取最小距離
  const seg = (ax: number, ay: number, bx: number, by: number) => {
    const sx0 = Math.max(fx, Math.floor(Math.min(ax, bx) - r)), sx1 = Math.min(fx + fw - 1, Math.ceil(Math.max(ax, bx) + r));
    const sy0 = Math.max(fy, Math.floor(Math.min(ay, by) - r)), sy1 = Math.min(fy + fh - 1, Math.ceil(Math.max(ay, by) + r));
    const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy;
    for (let y = sy0; y <= sy1; y++) for (let x = sx0; x <= sx1; x++) {
      let u = l2 > 0 ? ((x - ax) * vx + (y - ay) * vy) / l2 : 0; u = u < 0 ? 0 : u > 1 ? 1 : u;
      const dx = x - ax - vx * u, dy = y - ay - vy * u, d2 = dx * dx + dy * dy;
      if (d2 >= R2) continue;
      const i = (y - fy) * fw + (x - fx), v = Math.sqrt(d2) / r;
      if (v < t[i]) t[i] = v;
    }
  };
  if (n === 1) seg(pts[0], pts[1], pts[0], pts[1]);
  else for (let i = 0; i + 1 < n; i++) seg(pts[i * 2], pts[i * 2 + 1], pts[i * 2 + 2], pts[i * 2 + 3]);
  return { x: fx, y: fy, w: fw, h: fh, t };
}
/** 把距離場（平移 ox, oy）寫成覆蓋率。hard＝邊緣硬度 0–100（100 − 羽化）。回傳寫到的範圍 */
export function fieldAlpha(alpha: Float32Array, W: number, H: number, f: HealField, hard: number, ox = 0, oy = 0): HealRect | null {
  const inner = Math.max(0, Math.min(0.97, hard / 100));
  const x0 = Math.max(0, f.x + ox), y0 = Math.max(0, f.y + oy);
  const x1 = Math.min(W, f.x + ox + f.w), y1 = Math.min(H, f.y + oy + f.h);
  if (x1 <= x0 || y1 <= y0) return null;
  for (let y = y0; y < y1; y++) {
    const row = (y - oy - f.y) * f.w - f.x - ox;
    for (let x = x0; x < x1; x++) {
      const t = f.t[row + x];
      let a = 0;
      if (t < 1) {
        if (t <= inner) a = 1;
        else { const u = (t - inner) / (1 - inner); a = 1 - u * u * (3 - 2 * u); }
      }
      alpha[y * W + x] = a;
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
