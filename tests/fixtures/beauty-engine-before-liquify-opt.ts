// -------------------------------------------------------------
// ABAI 美顏引擎 —— 純函式影像運算層
//
// 這裡不含任何 React / DOM 狀態，全部是可獨立測試的像素運算：
//   去痘   自動供體搜尋 + 正規化卷積無縫貼合
//   去皺   高低頻分離，只削弱暗部細節
//   液化   位移場前向變形，永遠從原始像素單次取樣
//   修容   HSL 色相混合，保留原有明暗與唇紋質感
//
// 全部在裝置端完成，不上傳、不呼叫任何 API。
// -------------------------------------------------------------

export interface Rect { x: number; y: number; w: number; h: number; }

export type LiquifyMode = 'push' | 'bloat' | 'pucker' | 'restore';

/** 液化位移場：以 1/LIQUIFY_SCALE 解析度儲存的向量場 */
export interface LiquifyField {
  data: Float32Array;  // [dx, dy] 交錯，長度 w*h*2
  w: number;
  h: number;
  max: number;         // 目前最大位移量（用來推算需要重繪的範圍）
  limit: number;       // 單點位移上限。必須與筆刷大小無關，否則換小筆刷
                       // 碰到舊區域時，會把先前用大筆刷推出來的位移壓回去
}

export const LIQUIFY_SCALE = 4;

/** 筆刷大小以「長邊 1024px 時的影像像素半徑」為基準，換算後與解析度無關 */
export const BRUSH_REF_WIDTH = 1024;
export const DEFAULT_BRUSH: Record<string, number> = {
  blemish: 14, wrinkle: 32, liquify: 100, makeup: 20,
};
export const BRUSH_RANGE: Record<string, [number, number]> = {
  blemish: [5, 55], wrinkle: [10, 90], liquify: [40, 260], makeup: [8, 90],
};

/**
 * 修容筆色票。
 *
 * 前十個是唇色：紅色分量固定在 A0，綠色分量由 00 均勻遞增到 64，
 * 形成一條由正紅走到橙黃的連續色階，彼此同調所以整排看起來是一套的。
 * 後五個是膚色，供修容陰影、遮瑕與提亮使用。
 */
export const LIP_PRESETS: { name: string; hex: string }[] = [
  { name: '正紅', hex: '#A00000' },
  { name: '烈紅', hex: '#A00B00' },
  { name: '棗紅', hex: '#A01600' },
  { name: '磚紅', hex: '#A02100' },
  // 實用修容色：腮紅、陰影、提亮、眼影
  { name: '腮紅粉', hex: '#E38A8A' },
  { name: '蜜桃腮', hex: '#F0A184' },
  { name: '提亮米', hex: '#FBF0E4' },
  { name: '修容棕', hex: '#8C5F42' },
  { name: '鼻影褐', hex: '#6E5142' },
  { name: '眼影可可', hex: '#5E4034' },
  { name: '象牙', hex: '#F0D5C0' },
  { name: '自然', hex: '#E5BFA3' },
  { name: '蜜糖', hex: '#D2A077' },
  { name: '小麥', hex: '#B8825A' },
  { name: '古銅', hex: '#96603C' },
];

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

// -------------------------------------------------------------
// 暫存緩衝池：避免每次筆劃都重新配置 Float32Array 造成 GC 抖動
// -------------------------------------------------------------
const pool = new Map<string, Float32Array>();
function buf(key: string, n: number): Float32Array {
  let a = pool.get(key);
  if (!a || a.length < n) { a = new Float32Array(n); pool.set(key, a); }
  return a;
}
export function releaseBuffers() { pool.clear(); }

// -------------------------------------------------------------
// O(1) 滑動視窗 box blur（可分離，多次疊代即逼近高斯）
// -------------------------------------------------------------
function boxH(s: Float32Array, d: Float32Array, w: number, h: number, r: number) {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += s[o + clamp(i, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      d[o + x] = sum * inv;
      sum += s[o + clamp(x + r + 1, 0, w - 1)] - s[o + clamp(x - r, 0, w - 1)];
    }
  }
}
function boxV(s: Float32Array, d: Float32Array, w: number, h: number, r: number) {
  const inv = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += s[clamp(i, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      d[y * w + x] = sum * inv;
      sum += s[clamp(y + r + 1, 0, h - 1) * w + x] - s[clamp(y - r, 0, h - 1) * w + x];
    }
  }
}
function box(s: Float32Array, d: Float32Array, w: number, h: number, r: number, tmp: Float32Array) {
  boxH(s, tmp, w, h, r); boxV(tmp, d, w, h, r);
}

// -------------------------------------------------------------
// 去痘：自動取樣修復筆
//
// 1. 在 16 方位 × 3 半徑搜尋「邊界最接近且本身最平滑」的皮膚當供體
// 2. 若最佳供體仍不夠像（旁邊就是眼睛、頭髮、衣領），改用邊界外推，
//    絕不把外來內容搬到臉上 —— 這是廉價修復筆最常見的災難
// 3. 用正規化卷積解出邊界薄膜函數（Poisson 無縫融合的快速近似），
//    讓移植過來的皮膚自動吃掉底下的膚色與明暗差
// -------------------------------------------------------------
export function healAt(base: ImageData, W: number, H: number, cxf: number, cyf: number, Rf: number): Rect | null {
  const cx = Math.round(cxf), cy = Math.round(cyf);
  const R = Math.max(3, Math.round(Rf));
  const P = R + 2, S = P * 2 + 1;
  if (cx - P < 0 || cy - P < 0 || cx + P >= W || cy + P >= H) return null;

  const d = base.data;
  const n = S * S;
  const mk = buf('hm', n), wt = buf('hw', n), t1 = buf('ht1', n), t2 = buf('ht2', n);
  const dr = buf('hdr', n), dg = buf('hdg', n), db = buf('hdb', n);
  // 供體與目標區塊必然重疊，先把供體像素抄出來再寫入，避免邊寫邊讀污染
  const sr = buf('hsr', n), sg = buf('hsg', n), sb = buf('hsb', n);

  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, ox = x - P, oy = y - P;
    const t = Math.sqrt(ox * ox + oy * oy) / R;
    let m = t >= 1 ? 0 : t <= 0.62 ? 1 : (1 - (t - 0.62) / 0.38);
    mk[i] = m * m * (3 - 2 * m);
    wt[i] = 1 - mk[i];
  }

  // 目標邊界的紋理量 → 決定「供體像不像」的門檻（雜訊大的照片門檻要放寬）
  let gs = 0, gs2 = 0, gc = 0, ringNoise = 0, rn = 0;
  for (let y = -P; y <= P; y++) for (let x = -P; x <= P; x++) {
    const t = Math.sqrt(x * x + y * y) / R;
    if (t < 0.82 || t >= 1.12) continue;
    const ti = ((cy + y) * W + cx + x) * 4;
    const g = d[ti] * 0.299 + d[ti + 1] * 0.587 + d[ti + 2] * 0.114;
    gs += g; gs2 += g * g; gc++;
    if (cx + x + 1 < W) {
      const g2 = d[ti + 4] * 0.299 + d[ti + 5] * 0.587 + d[ti + 6] * 0.114;
      ringNoise += Math.abs(g - g2); rn++;
    }
  }
  const tv = gc ? Math.max(0, gs2 / gc - (gs / gc) * (gs / gc)) : 0;
  const TH = 500 + 8 * tv;

  let bx = -1, by = -1, best = Infinity, bestBorder = Infinity;
  for (let ri = 0; ri < 3; ri++) {
    const rad = R * (2.0 + ri * 0.85);
    for (let k = 0; k < 16; k++) {
      const ang = k * Math.PI / 8;
      const sx = Math.round(cx + Math.cos(ang) * rad);
      const sy = Math.round(cy + Math.sin(ang) * rad);
      if (sx - P < 0 || sy - P < 0 || sx + P >= W || sy + P >= H) continue;
      let border = 0, bc = 0, sum = 0, sum2 = 0, ic = 0;
      for (let y = -P; y <= P; y += 2) {
        for (let x = -P; x <= P; x += 2) {
          const t = Math.sqrt(x * x + y * y) / R;
          if (t >= 1.15) continue;
          const si = ((sy + y) * W + sx + x) * 4;
          if (t > 0.82) {
            const ti = ((cy + y) * W + cx + x) * 4;
            const ar = d[ti] - d[si], ag = d[ti + 1] - d[si + 1], ab = d[ti + 2] - d[si + 2];
            border += ar * ar + ag * ag + ab * ab; bc++;
          } else {
            const g = d[si] * 0.299 + d[si + 1] * 0.587 + d[si + 2] * 0.114;
            sum += g; sum2 += g * g; ic++;
          }
        }
      }
      if (!bc || !ic) continue;
      const bm = border / bc;
      const varS = Math.max(0, sum2 / ic - (sum / ic) * (sum / ic));
      const score = bm + varS * 6;     // 供體越平滑越好，避免搬到別的痘痘
      if (score < best) { best = score; bestBorder = bm; bx = sx; by = sy; }
    }
  }

  const fallback = (bx < 0 || bestBorder > TH);
  if (fallback) {
    // 由已知邊界向內外推（正規化卷積），不引入任何外來內容
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x, ti = ((cy + y - P) * W + cx + x - P) * 4;
      sr[i] = d[ti] * wt[i]; sg[i] = d[ti + 1] * wt[i]; sb[i] = d[ti + 2] * wt[i];
    }
    const er = Math.max(3, Math.round(R * 0.9));
    box(wt, t2, S, S, er, t1);
    box(sr, sr, S, S, er, t1); box(sg, sg, S, S, er, t1); box(sb, sb, S, S, er, t1);
    for (let i = 0; i < n; i++) {
      const den = t2[i] > 0.015 ? t2[i] : 0.015;
      sr[i] /= den; sg[i] /= den; sb[i] /= den;
    }
  } else {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x, si = ((by + y - P) * W + bx + x - P) * 4;
      sr[i] = d[si]; sg[i] = d[si + 1]; sb[i] = d[si + 2];
    }
  }

  // 邊界薄膜函數：只用遮罩外的差異，所以痘痘本身不會被算回來
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, ti = ((cy + y - P) * W + cx + x - P) * 4;
    dr[i] = (d[ti] - sr[i]) * wt[i];
    dg[i] = (d[ti + 1] - sg[i]) * wt[i];
    db[i] = (d[ti + 2] - sb[i]) * wt[i];
  }
  const br = Math.max(2, Math.round(R * 0.62));
  box(wt, t2, S, S, br, t1);
  box(dr, dr, S, S, br, t1); box(dg, dg, S, S, br, t1); box(db, db, S, S, br, t1);

  // 外推路徑沒有毛孔，補回與周圍等量的顆粒，避免出現一塊過度乾淨的皮膚
  const grain = fallback && rn ? clamp(ringNoise / rn * 0.7, 0, 5) : 0;

  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, m = mk[i];
    if (m <= 0.002) continue;
    const den = t2[i] > 0.02 ? t2[i] : 0.02;
    const ti = ((cy + y - P) * W + cx + x - P) * 4;
    const ns = grain ? (Math.random() - 0.5) * grain * 2 : 0;
    const nr = sr[i] + dr[i] / den + ns;
    const ng = sg[i] + dg[i] / den + ns;
    const nb = sb[i] + db[i] / den + ns;
    d[ti] = d[ti] + (nr - d[ti]) * m;
    d[ti + 1] = d[ti + 1] + (ng - d[ti + 1]) * m;
    d[ti + 2] = d[ti + 2] + (nb - d[ti + 2]) * m;
  }
  return { x: cx - P, y: cy - P, w: S, h: S };
}

/** healAt 會影響到的範圍（呼叫端需要在修改前先快照這塊，供復原使用） */
export function healRect(cxf: number, cyf: number, Rf: number): Rect {
  const R = Math.max(3, Math.round(Rf));
  const half = R + 3;
  return { x: Math.round(cxf) - half, y: Math.round(cyf) - half, w: half * 2 + 1, h: half * 2 + 1 };
}

// -------------------------------------------------------------
// 去皺：高低頻分離筆刷
//
// 只削弱「比周圍暗」的高頻成分 —— 皺紋、法令紋、細紋都是暗線條 ——
// 亮部的毛孔質感保留 0.65，所以臉不會被抹成一片平面而失去立體感。
// -------------------------------------------------------------
export function wrinkleRect(W: number, H: number, cx: number, cy: number, R: number): Rect | null {
  const br = Math.max(2, Math.round(R * 0.55));
  const pad = br * 2 + 2;
  const x = clamp(Math.round(cx - R - pad), 0, W);
  const y = clamp(Math.round(cy - R - pad), 0, H);
  const w = clamp(Math.round(cx + R + pad), 0, W) - x;
  const h = clamp(Math.round(cy + R + pad), 0, H) - y;
  if (w < 3 || h < 3) return null;
  return { x, y, w, h };
}

export function wrinkleDab(base: ImageData, W: number, H: number, cx: number, cy: number, R: number, amount: number): Rect | null {
  const rect = wrinkleRect(W, H, cx, cy, R);
  if (!rect) return null;
  const { x: x0, y: y0, w, h } = rect;
  const br = Math.max(2, Math.round(R * 0.55));
  const n = w * h;
  const ch = [buf('wr', n), buf('wg', n), buf('wb', n)];
  const lo = [buf('wlr', n), buf('wlg', n), buf('wlb', n)];
  const t1 = buf('wt', n);
  const d = base.data;

  for (let y = 0; y < h; y++) {
    let si = ((y + y0) * W + x0) * 4, di = y * w;
    for (let x = 0; x < w; x++, si += 4, di++) {
      ch[0][di] = d[si]; ch[1][di] = d[si + 1]; ch[2][di] = d[si + 2];
    }
  }
  for (let c = 0; c < 3; c++) box(ch[c], lo[c], w, h, br, t1);

  for (let y = 0; y < h; y++) {
    const gy = y + y0;
    for (let x = 0; x < w; x++) {
      const gx = x + x0;
      const t = Math.hypot(gx - cx, gy - cy) / R;
      if (t >= 1) continue;
      const k = 1 - t * t, m = k * k * amount;
      const i = y * w + x, o = (gy * W + gx) * 4;
      for (let c = 0; c < 3; c++) {
        const hi = ch[c][i] - lo[c][i];
        const att = hi < 0 ? m : m * 0.35;   // 暗線條重壓，亮部質感保留
        d[o + c] = lo[c][i] + hi * (1 - att);
      }
    }
  }
  return rect;
}

// -------------------------------------------------------------
// 液化：位移場前向變形
//
// 畫面永遠是 out(p) = src(p + d(p))，也就是每一格畫素都從「原始像素」
// 單次雙線性取樣。推一百次的畫質等同推一次 —— 這是專業液化的必要條件，
// 反覆對上一次結果重新取樣的作法會越推越糊。
// -------------------------------------------------------------
export function createLiquifyField(W: number, H: number): LiquifyField {
  const w = Math.ceil(W / LIQUIFY_SCALE) + 1;
  const h = Math.ceil(H / LIQUIFY_SCALE) + 1;
  return { data: new Float32Array(w * h * 2), w, h, max: 0, limit: Math.min(W, H) * 0.28 };
}

export function sampleLiquify(f: LiquifyField, x: number, y: number, out: [number, number]) {
  const fx = x / LIQUIFY_SCALE, fy = y / LIQUIFY_SCALE;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const a = clamp(x0, 0, f.w - 1), b = clamp(x0 + 1, 0, f.w - 1);
  const c = clamp(y0, 0, f.h - 1), e = clamp(y0 + 1, 0, f.h - 1);
  const i00 = (c * f.w + a) * 2, i10 = (c * f.w + b) * 2;
  const i01 = (e * f.w + a) * 2, i11 = (e * f.w + b) * 2;
  const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
  out[0] = f.data[i00] * w00 + f.data[i10] * w10 + f.data[i01] * w01 + f.data[i11] * w11;
  out[1] = f.data[i00 + 1] * w00 + f.data[i10 + 1] * w10 + f.data[i01 + 1] * w01 + f.data[i11 + 1] * w11;
}

export function liquifyDab(
  f: LiquifyField, cx: number, cy: number, dx: number, dy: number,
  R: number, force: number, mode: LiquifyMode,
) {
  const mr = R / LIQUIFY_SCALE, mcx = cx / LIQUIFY_SCALE, mcy = cy / LIQUIFY_SCALE;
  const x0 = Math.max(0, Math.floor(mcx - mr)), x1 = Math.min(f.w - 1, Math.ceil(mcx + mr));
  const y0 = Math.max(0, Math.floor(mcy - mr)), y1 = Math.min(f.h - 1, Math.ceil(mcy + mr));
  const LIMIT = f.limit;    // 限制單點最大位移，避免折疊撕裂（與筆刷大小無關）

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const ox = x - mcx, oy = y - mcy;
      const t = Math.sqrt(ox * ox + oy * oy) / mr;
      if (t >= 1) continue;
      const k = 1 - t * t, w = k * k * force;   // C1 連續的羽化，邊緣不會有硬接縫
      const i = (y * f.w + x) * 2;
      let ax: number, ay: number;
      if (mode === 'push') { ax = -dx * w; ay = -dy * w; }
      else if (mode === 'bloat') { ax = -ox * LIQUIFY_SCALE * w * 0.42; ay = -oy * LIQUIFY_SCALE * w * 0.42; }
      else if (mode === 'pucker') { ax = ox * LIQUIFY_SCALE * w * 0.42; ay = oy * LIQUIFY_SCALE * w * 0.42; }
      else { const rr = 1 - w * 0.55; f.data[i] *= rr; f.data[i + 1] *= rr; continue; }
      let nx = f.data[i] + ax, ny = f.data[i + 1] + ay;
      const mag = Math.hypot(nx, ny);
      if (mag > LIMIT) { nx = nx / mag * LIMIT; ny = ny / mag * LIMIT; }
      f.data[i] = nx; f.data[i + 1] = ny;
    }
  }

  let mx = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * f.w + x) * 2;
    const m = Math.abs(f.data[i]) + Math.abs(f.data[i + 1]);
    if (m > mx) mx = m;
  }
  if (mx > f.max) f.max = mx;
}

export function recomputeLiquifyMax(f: LiquifyField) {
  let m = 0;
  for (let i = 0; i < f.data.length; i += 2) {
    const v = Math.abs(f.data[i]) + Math.abs(f.data[i + 1]);
    if (v > m) m = v;
  }
  f.max = m;
}

/** 把 src 依位移場變形後寫入 target（target 大小 = rect 大小） */
export function warpRegion(src: ImageData, W: number, H: number, f: LiquifyField, target: ImageData, rect: Rect) {
  const out = target.data, sd = src.data;
  const o2: [number, number] = [0, 0];
  for (let y = 0; y < rect.h; y++) {
    const gy = rect.y + y;
    for (let x = 0; x < rect.w; x++) {
      const gx = rect.x + x;
      sampleLiquify(f, gx, gy, o2);
      let sx = gx + o2[0], sy = gy + o2[1];
      sx = sx < 0 ? 0 : sx > W - 1.001 ? W - 1.001 : sx;
      sy = sy < 0 ? 0 : sy > H - 1.001 ? H - 1.001 : sy;
      const ix = sx | 0, iy = sy | 0, tx = sx - ix, ty = sy - iy;
      const i00 = (iy * W + ix) * 4, i10 = i00 + 4, i01 = i00 + W * 4, i11 = i01 + 4;
      const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
      const o = (y * rect.w + x) * 4;
      out[o] = sd[i00] * w00 + sd[i10] * w10 + sd[i01] * w01 + sd[i11] * w11;
      out[o + 1] = sd[i00 + 1] * w00 + sd[i10 + 1] * w10 + sd[i01 + 1] * w01 + sd[i11 + 1] * w11;
      out[o + 2] = sd[i00 + 2] * w00 + sd[i10 + 2] * w10 + sd[i01 + 2] * w01 + sd[i11 + 2] * w11;
      out[o + 3] = 255;
    }
  }
}

// -------------------------------------------------------------
// 修容筆：HSL 色相混合（等同 Photoshop 的「顏色」混合模式）
//
// 直接把顏色蓋上去會變成一塊死板的色塊，唇紋、唇珠反光全部消失。
// 正確做法是只換掉色相與飽和度，明度完全沿用原圖 ——
// 這樣唇紋、立體感、光澤都留著，看起來才像真的擦上去的。
//
// 一筆之內用「覆蓋率取最大值」而不是疊加，所以來回塗抹不會越塗越濃、
// 也不會在筆觸交疊處出現一塊塊的色斑。
// -------------------------------------------------------------
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3
    ? h.split('').map(c => parseInt(c + c, 16))
    : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  return [v[0] || 0, v[1] || 0, v[2] || 0];
}

/** 只取色相與飽和度，回傳值配合 hueSatToRgb 使用 */
function rgbToHueSat(r: number, g: number, b: number): [number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h: number;
  if (mx === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6;
  else if (mx === G) h = ((B - R) / d + 2) / 6;
  else h = ((R - G) / d + 4) / 6;
  return [h, s];
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

/** 給定色相、飽和度與「原圖的明度」，組回 RGB */
function hueSatToRgb(h: number, s: number, l: number, out: [number, number, number]) {
  if (s === 0) { out[0] = out[1] = out[2] = l * 255; return; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  out[0] = hue2rgb(p, q, h + 1 / 3) * 255;
  out[1] = hue2rgb(p, q, h) * 255;
  out[2] = hue2rgb(p, q, h - 1 / 3) * 255;
}

export function makeupRect(W: number, H: number, cx: number, cy: number, R: number): Rect | null {
  const x = clamp(Math.floor(cx - R) - 1, 0, W);
  const y = clamp(Math.floor(cy - R) - 1, 0, H);
  const w = clamp(Math.ceil(cx + R) + 1, 0, W) - x;
  const h = clamp(Math.ceil(cy + R) + 1, 0, H) - y;
  if (w < 1 || h < 1) return null;
  return { x, y, w, h };
}

/**
 * 把一次筆觸的覆蓋率蓋進 alpha 場（取最大值，不累加）。
 * hardness 0 = 邊緣完全柔化，100 = 幾乎硬邊。
 * 回傳這次影響到的範圍。
 */
export function stampAlpha(
  alpha: Float32Array, W: number, H: number,
  cx: number, cy: number, R: number, hardness: number, strength: number,
): Rect | null {
  const rect = makeupRect(W, H, cx, cy, R);
  if (!rect) return null;
  const inner = clamp(hardness / 100, 0, 0.97);
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const t = Math.hypot(x - cx, y - cy) / R;
      if (t >= 1) continue;
      let w: number;
      if (t <= inner) w = 1;
      else {
        const u = (t - inner) / (1 - inner);
        w = 1 - u * u * (3 - 2 * u);   // smoothstep，邊緣 C1 連續不會有硬圈
      }
      const a = w * strength;
      const i = y * W + x;
      if (a > alpha[i]) alpha[i] = a;
    }
  }
  return rect;
}

/**
 * 依 alpha 場，從筆觸開始前的像素（src）重新合成到 dst。
 * 每次都從 src 重算，所以同一筆來回塗抹不會累積變色。
 */
export function makeupComposite(
  src: Uint8ClampedArray, dst: Uint8ClampedArray, W: number,
  rect: Rect, alpha: Float32Array, rgb: [number, number, number],
) {
  const [ch, cs] = rgbToHueSat(rgb[0], rgb[1], rgb[2]);
  // 目標色本身的明度。深色之所以「深」靠的就是低明度 —— 若只換色相、明度
  // 仍沿用原圖，深酒紅塗上去會變成「高明度 + 高飽和」＝ 鮮豔，而不是深邃。
  // 因此明度以目標色為基準，再把原圖的明暗起伏疊回去以保留唇紋與反光。
  const cl = (Math.max(rgb[0], rgb[1], rgb[2]) + Math.min(rgb[0], rgb[1], rgb[2])) / 510;
  const TEXTURE = 0.55;   // 原圖明暗起伏的保留比例
  const out: [number, number, number] = [0, 0, 0];
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = y * W + x;
      const a = alpha[i];
      if (a <= 0.001) continue;
      const o = i * 4;
      const r = src[o], g = src[o + 1], b = src[o + 2];
      const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255;
      // 明度大致沿用原圖，唇紋與反光才不會被抹平
      const l0 = (mx + mn) / 2;
      const l = clamp(cl + (l0 - 0.5) * TEXTURE, 0.02, 0.98);
      // 飽和度依原圖自身的濃淡調整，而不是整片套同一個值。
      // 全部統一的話，原有的濃淡變化會被抹平，看起來就像貼了一塊色塊上去。
      // 上限鎖在目標色本身的飽和度，否則反覆塗抹會越塗越豔、失控。
      const d = mx - mn;
      const s0 = d === 0 ? 0 : (l0 > 0.5 ? d / (2 - mx - mn) : d / (mx + mn));
      const s = Math.min(cs, cs * (0.6 + 0.55 * s0));
      hueSatToRgb(ch, s, l, out);
      dst[o]     = r + (out[0] - r) * a;
      dst[o + 1] = g + (out[1] - g) * a;
      dst[o + 2] = b + (out[2] - b) * a;
      dst[o + 3] = 255;
    }
  }
}
