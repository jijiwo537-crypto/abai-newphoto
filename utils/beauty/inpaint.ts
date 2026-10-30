/**
 * 修補（內容感知填補）：把塗到的地方用照片裡別處的質感重建出來。
 *
 * 方法跟 Photoshop「內容感知填色」同一套（Barnes et al. 2009 PatchMatch ＋
 * Wexler et al. 2007 多尺度 EM 補洞）：
 *
 *   1. 從洞的四周取一塊工作範圍（ROI），建影像金字塔，最粗那層的洞只剩幾個像素。
 *   2. 每一層反覆做兩件事（EM）：
 *      E：PatchMatch —— 替洞裡（及洞邊）每個 7×7 小塊，在「完全已知」的區域找最像的
 *         小塊（鄰居傳遞＋隨機搜尋，幾輪就收斂）。
 *      M：投票 —— 洞裡每個像素 = 所有蓋到它的小塊、各自找到的來源像素的加權平均
 *         （權重看小塊有多像：越像越重，σ 取所有距離的 75 百分位，同 Wexler）。
 *   3. 往細一層時，對應關係（NNF）跟著放大兩倍再修，所以大結構在粗層就定好、
 *      細節在細層補上 —— 不會出現重複貼圖的圖章感，也不會糊成一片。
 *   4. 最後用筆刷的柔邊混回原圖：中心整塊換掉，邊緣平滑過渡，沒有接縫。
 *
 * 純函式、決定性（固定亂數種子）：預覽（Web Worker）、復原重播、原尺寸輸出算出來的
 * 方法完全相同。
 */

export interface PatchRect { x: number; y: number; w: number; h: number }

/** 小塊半徑（7×7） */
const PR = 3;
const P = PR * 2 + 1;
/** 算洞的門檻：筆刷覆蓋率超過這個就算要重建（柔邊再混回去） */
const HOLE_T = 0.02;

/**
 * 給定洞（筆刷覆蓋）的外框，算出要拿來做事的工作範圍：洞的外框往外擴，
 * 擴的距離跟洞的大小成正比（越大的洞要從越遠的地方找質感）。
 */
export function patchRoi(W: number, H: number, hole: PatchRect): PatchRect {
  const m = Math.round(Math.min(Math.max(Math.max(hole.w, hole.h) * 1.25 + P * 2, 28), Math.max(W, H)));
  const x0 = Math.max(0, hole.x - m), y0 = Math.max(0, hole.y - m);
  const x1 = Math.min(W, hole.x + hole.w + m), y1 = Math.min(H, hole.y + hole.h + m);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** 亂數（xorshift32），固定種子 → 同一筆每次算出來都一樣 */
const rng = (seed: number) => {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
};

interface Level { w: number; h: number; img: Float32Array; hole: Uint8Array }

const down = (L: Level): Level => {
  const w = Math.max(1, (L.w + 1) >> 1), h = Math.max(1, (L.h + 1) >> 1);
  const img = new Float32Array(w * h * 3), hole = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, n = 0, anyHole = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const sx = Math.min(L.w - 1, x * 2 + dx), sy = Math.min(L.h - 1, y * 2 + dy), si = sy * L.w + sx;
      if (L.hole[si]) { anyHole = 1; continue; }
      r += L.img[si * 3]; g += L.img[si * 3 + 1]; b += L.img[si * 3 + 2]; n++;
    }
    const i = y * w + x;
    // 只要有一個子像素在洞裡，粗層的這一格就算洞：洞只會被放大，不會在粗層漏掉一角
    hole[i] = anyHole;
    if (n) { img[i * 3] = r / n; img[i * 3 + 1] = g / n; img[i * 3 + 2] = b / n; }
  }
  return { w, h, img, hole };
};

/** 洞先用四周往內一圈一圈平均補滿（只當最粗那一層的起點） */
const diffuseFill = (L: Level) => {
  const { w, h, img } = L;
  const known = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) known[i] = L.hole[i] ? 0 : 1;
  let left = 0; for (let i = 0; i < w * h; i++) if (!known[i]) left++;
  let guard = w + h + 2;
  while (left > 0 && guard-- > 0) {
    const next: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (known[i]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (!known[j]) continue;
        r += img[j * 3]; g += img[j * 3 + 1]; b += img[j * 3 + 2]; n++;
      }
      if (n) { img[i * 3] = r / n; img[i * 3 + 1] = g / n; img[i * 3 + 2] = b / n; next.push(i); }
    }
    if (!next.length) break;
    for (const i of next) known[i] = 1;
    left -= next.length;
  }
};

/**
 * 最粗那一層的起點：由洞邊往內一圈一圈（onion peel）補。每個邊緣像素拿「它周圍已知
 * （含剛補好）的像素」去跟所有合格的來源小塊比（只比已知的那幾格），抄最像的那塊的中心。
 * 這樣線條、紋路會從洞邊延續進去；用平均色當起點的話，後面只會挑到同樣平坦的地方
 * （磚牆會補成一塊沒有磚縫的紅色）。回傳每個洞像素選到的來源（給 NNF 當起點）。
 */
const onionInit = (L: Level, valid: Int32Array, rand: () => number): Int32Array => {
  const { w, h, img, hole } = L;
  const known = new Uint8Array(w * h), pick = new Int32Array(w * h).fill(-1);
  for (let i = 0; i < w * h; i++) known[i] = hole[i] ? 0 : 1;
  // 來源太多時隨機取一部分比（最粗層通常只有幾百到幾千個，幾乎都是全比）
  const pool = valid.length > 2500 ? Int32Array.from({ length: 2500 }, () => valid[(rand() * valid.length) | 0]) : valid;
  let guard = w + h;
  while (guard-- > 0) {
    const front: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (known[i]) continue;
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h && known[yy * w + xx]) k++; }
      if (k) front.push(i * 16 + k);
    }
    if (!front.length) break;
    // 已知鄰居越多的越先補（資訊越完整、越不會猜錯）
    front.sort((a, b) => (b & 15) - (a & 15));
    for (const f of front) {
      const p = f >> 4, px = p % w, py = (p / w) | 0;
      let best = -1, bestD = Infinity;
      for (let c = 0; c < pool.length; c++) {
        const q = pool[c], qx = q % w, qy = (q / w) | 0;
        let s2 = 0, n = 0;
        for (let dy = -PR; dy <= PR && s2 < bestD * 1e9; dy++) {
          const y1 = py + dy; if (y1 < 0 || y1 >= h) continue;
          for (let dx = -PR; dx <= PR; dx++) {
            const x1 = px + dx; if (x1 < 0 || x1 >= w) continue;
            const a = y1 * w + x1; if (!known[a]) continue;
            const b = ((qy + dy) * w + qx + dx) * 3, a3 = a * 3;
            const d0 = img[a3] - img[b], d1 = img[a3 + 1] - img[b + 1], d2 = img[a3 + 2] - img[b + 2];
            s2 += d0 * d0 + d1 * d1 + d2 * d2; n++;
          }
        }
        if (n) { const d = s2 / n; if (d < bestD) { bestD = d; best = q; } }
      }
      if (best >= 0) { img[p * 3] = img[best * 3]; img[p * 3 + 1] = img[best * 3 + 1]; img[p * 3 + 2] = img[best * 3 + 2]; pick[p] = best; }
      known[p] = 1;
    }
  }
  return pick;
};

/**
 * 細層也用 onion peel 從洞邊往內補，但不做全比對（太慢）：每個像素只試
 *   ① 粗一層對應關係放大後的建議、② 已補好的鄰居各自的來源平移一格（PatchMatch 的傳遞）、
 *   ③ 以目前最佳為中心、半徑減半的隨機搜尋、④ 幾個全域隨機。
 * 距離同樣只比已知（含已補好）的像素。這讓細的線條（磚縫、髮絲邊、衣服的紋路）
 * 能在原解析度從洞邊接進去 —— 粗層看不到那麼細的東西。
 */
const onionFast = (L: Level, validMap: Uint8Array, valid: Int32Array, suggest: Int32Array, rand: () => number): Int32Array => {
  const { w, h, img, hole } = L;
  const known = new Uint8Array(w * h), pick = new Int32Array(w * h).fill(-1);
  for (let i = 0; i < w * h; i++) known[i] = hole[i] ? 0 : 1;
  const masked = (p: number, q: number, cut: number) => {
    const px = p % w, py = (p / w) | 0, qx = q % w, qy = (q / w) | 0;
    let s2 = 0, n = 0;
    for (let dy = -PR; dy <= PR; dy++) {
      const y1 = py + dy; if (y1 < 0 || y1 >= h) continue;
      for (let dx = -PR; dx <= PR; dx++) {
        const x1 = px + dx; if (x1 < 0 || x1 >= w) continue;
        const a = y1 * w + x1; if (!known[a]) continue;
        const b = ((qy + dy) * w + qx + dx) * 3, a3 = a * 3;
        const d0 = img[a3] - img[b], d1 = img[a3 + 1] - img[b + 1], d2 = img[a3 + 2] - img[b + 2];
        s2 += d0 * d0 + d1 * d1 + d2 * d2; n++;
      }
      if (n > 6 && s2 / n > cut) return Infinity;
    }
    return n ? s2 / n : Infinity;
  };
  const maxR = Math.max(w, h);
  let guard = w + h;
  while (guard-- > 0) {
    const front: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (known[i]) continue;
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h && known[yy * w + xx]) k++; }
      if (k) front.push(i * 16 + k);
    }
    if (!front.length) break;
    front.sort((a, b) => (b & 15) - (a & 15));
    for (const f of front) {
      const p = f >> 4, px = p % w, py = (p / w) | 0;
      let best = -1, bestD = Infinity;
      const tryQ = (q: number) => { if (q < 0 || q >= w * h || !validMap[q]) return; const d = masked(p, q, bestD); if (d < bestD) { bestD = d; best = q; } };
      tryQ(suggest[p]);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = px + dx, yy = py + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const n2 = yy * w + xx; if (!known[n2]) continue;
        // 已知（原圖）的鄰居，它的「來源」就是它自己；補過的鄰居用它抄的那塊
        const src = pick[n2] >= 0 ? pick[n2] : n2;
        tryQ(src - dx - dy * w);
      }
      for (let r = 0; r < 4; r++) tryQ(valid[(rand() * valid.length) | 0]);
      if (best >= 0) {
        let rad = maxR;
        const bx = best % w, by = (best / w) | 0;
        while (rad >= 1) {
          const qx = Math.min(w - 1 - PR, Math.max(PR, bx + Math.round((rand() * 2 - 1) * rad)));
          const qy = Math.min(h - 1 - PR, Math.max(PR, by + Math.round((rand() * 2 - 1) * rad)));
          tryQ(qy * w + qx); rad >>= 1;
        }
        img[p * 3] = img[best * 3]; img[p * 3 + 1] = img[best * 3 + 1]; img[p * 3 + 2] = img[best * 3 + 2]; pick[p] = best;
      }
      known[p] = 1;
    }
  }
  return pick;
};

/** 每一格「當來源小塊中心」合不合格：小塊整塊在範圍內、而且完全沒碰到洞 */
const validCenters = (L: Level): Int32Array => {
  const { w, h, hole } = L;
  const S = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += hole[y * w + x]; S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row; } }
  const out: number[] = [];
  for (let y = PR; y < h - PR; y++) for (let x = PR; x < w - PR; x++) {
    const a = S[(y - PR) * (w + 1) + (x - PR)], b = S[(y - PR) * (w + 1) + (x + PR + 1)];
    const c = S[(y + PR + 1) * (w + 1) + (x - PR)], d = S[(y + PR + 1) * (w + 1) + (x + PR + 1)];
    if (d - b - c + a === 0) out.push(y * w + x);
  }
  return Int32Array.from(out);
};

/** 要找對應的小塊中心：小塊有碰到洞的那些（洞往外擴 PR） */
const targetCenters = (L: Level): Int32Array => {
  const { w, h, hole } = L;
  const mark = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!hole[y * w + x]) continue;
    for (let dy = -PR; dy <= PR; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -PR; dx <= PR; dx++) { const xx = x + dx; if (xx >= 0 && xx < w) mark[yy * w + xx] = 1; } }
  }
  const out: number[] = [];
  for (let i = 0; i < w * h; i++) if (mark[i]) out.push(i);
  return Int32Array.from(out);
};

function solveLevel(L: Level, valid: Int32Array, validMap: Uint8Array, targets: Int32Array, nnf: Int32Array, iters: number, rand: () => number, sharpFinish = false) {
  const { w, h, img, hole } = L;
  const nT = targets.length;
  const cost = new Float32Array(nT), count = new Float32Array(nT);
  const tIndex = new Int32Array(w * h).fill(-1);
  for (let t = 0; t < nT; t++) tIndex[targets[t]] = t;
  // 小塊距離：只算落在範圍內的像素；超過目前最佳就提早結束
  const dist = (p: number, q: number, cut: number) => {
    const px = p % w, py = (p / w) | 0, qx = q % w, qy = (q / w) | 0;
    let s = 0;
    for (let dy = -PR; dy <= PR; dy++) {
      const y1 = py + dy; if (y1 < 0 || y1 >= h) continue;
      const rowP = y1 * w, rowQ = (qy + dy) * w;
      for (let dx = -PR; dx <= PR; dx++) {
        const x1 = px + dx; if (x1 < 0 || x1 >= w) continue;
        const a = (rowP + x1) * 3, b = (rowQ + qx + dx) * 3;
        const d0 = img[a] - img[b], d1 = img[a + 1] - img[b + 1], d2 = img[a + 2] - img[b + 2];
        s += d0 * d0 + d1 * d1 + d2 * d2;
      }
      if (s > cut) return s;
    }
    return s;
  };
  for (let t = 0; t < nT; t++) {
    const p = targets[t], px = p % w, py = (p / w) | 0;
    const cx = Math.min(px + PR, w - 1) - Math.max(px - PR, 0) + 1, cy = Math.min(py + PR, h - 1) - Math.max(py - PR, 0) + 1;
    count[t] = cx * cy;
  }
  const sum = new Float32Array(w * h * 3), wsum = new Float32Array(w * h);
  const maxR = Math.max(w, h);
  // 隨機搜尋的次數上限：洞很大的時候不要讓單層的時間爆掉
  const searchCap = nT > 120000 ? 4 : 8;
  for (let it = 0; it < iters; it++) {
    for (let t = 0; t < nT; t++) cost[t] = dist(targets[t], nnf[t], Infinity);
    const fwd = (it & 1) === 0;
    for (let k = 0; k < nT; k++) {
      const t = fwd ? k : nT - 1 - k, p = targets[t];
      const px = p % w, py = (p / w) | 0;
      let best = nnf[t], bestD = cost[t];
      const s = fwd ? -1 : 1;
      // 傳遞：左／上（或右／下）鄰居的對應，平移一格過來試試
      const nx = px + s, ny = py + s;
      if (nx >= 0 && nx < w) { const tn = tIndex[py * w + nx]; if (tn >= 0) { const q = nnf[tn] - s; if (q >= 0 && q < w * h && validMap[q]) { const d = dist(p, q, bestD); if (d < bestD) { bestD = d; best = q; } } } }
      if (ny >= 0 && ny < h) { const tn = tIndex[ny * w + px]; if (tn >= 0) { const q = nnf[tn] - s * w; if (q >= 0 && q < w * h && validMap[q]) { const d = dist(p, q, bestD); if (d < bestD) { bestD = d; best = q; } } } }
      // 隨機搜尋：以目前最佳為中心，半徑一路減半
      let r = maxR, tries = 0;
      const bx = best % w, by = (best / w) | 0;
      while (r >= 1 && tries < searchCap) {
        const qx = Math.min(w - 1 - PR, Math.max(PR, bx + Math.round((rand() * 2 - 1) * r)));
        const qy = Math.min(h - 1 - PR, Math.max(PR, by + Math.round((rand() * 2 - 1) * r)));
        const q = qy * w + qx;
        if (validMap[q]) { const d = dist(p, q, bestD); if (d < bestD) { bestD = d; best = q; } }
        r >>= 1; tries++;
      }
      // 偶爾直接從全部合格的中心抽一個：洞旁邊沒有好的質感時，仍有機會找到遠處的
      if (valid.length) { const q = valid[(rand() * valid.length) | 0]; const d = dist(p, q, bestD); if (d < bestD) { bestD = d; best = q; } }
      nnf[t] = best; cost[t] = bestD;
    }
    // 投票（M 步）：σ² 取「每像素平均距離」的 75 百分位
    const norm = new Float32Array(nT);
    for (let t = 0; t < nT; t++) norm[t] = cost[t] / count[t];
    const sorted = Float32Array.from(norm).sort();
    const sigma2 = Math.max(1, sorted[Math.min(nT - 1, Math.floor(nT * 0.75))]);
    sum.fill(0); wsum.fill(0);
    for (let t = 0; t < nT; t++) {
      const p = targets[t], q = nnf[t];
      const px = p % w, py = (p / w) | 0, qx = q % w, qy = (q / w) | 0;
      const wt = Math.exp(-norm[t] / (2 * sigma2)) + 1e-6;
      for (let dy = -PR; dy <= PR; dy++) {
        const y1 = py + dy; if (y1 < 0 || y1 >= h) continue;
        for (let dx = -PR; dx <= PR; dx++) {
          const x1 = px + dx; if (x1 < 0 || x1 >= w) continue;
          const i = y1 * w + x1; if (!hole[i]) continue;
          const j = ((qy + dy) * w + qx + dx) * 3;
          sum[i * 3] += wt * img[j]; sum[i * 3 + 1] += wt * img[j + 1]; sum[i * 3 + 2] += wt * img[j + 2]; wsum[i] += wt;
        }
      }
    }
    for (let i = 0; i < w * h; i++) {
      if (!hole[i] || !wsum[i]) continue;
      img[i * 3] = sum[i * 3] / wsum[i]; img[i * 3 + 1] = sum[i * 3 + 1] / wsum[i]; img[i * 3 + 2] = sum[i * 3 + 2] / wsum[i];
    }
  }
  /* 最細那一層的最後一步：投票（平均）會把細紋理（磚縫、毛孔、布紋）抹糊。
     改成「每個像素直接取自己那個小塊找到的來源像素」——跟 PatchMatch 論文的
     重建法一樣，對應關係本來就一塊一塊是連貫的，所以結果是銳利的。
     只有洞邊 PR 像素內還保留投票的平均，讓新舊交界自然銜接。 */
  if (sharpFinish) {
    const dEdge = edgeDistance(L);
    for (let t = 0; t < nT; t++) {
      const p = targets[t];
      if (!hole[p]) continue;
      // 洞裡每一格都直接取來源（銳利）；新舊交界靠最後的筆刷柔邊混回去，不再留一圈平均過的模糊帶
      const q = nnf[t], k = dEdge[p] > 0 ? 1 : 0;
      if (k <= 0) continue;
      img[p * 3] += (img[q * 3] - img[p * 3]) * k;
      img[p * 3 + 1] += (img[q * 3 + 1] - img[p * 3 + 1]) * k;
      img[p * 3 + 2] += (img[q * 3 + 2] - img[p * 3 + 2]) * k;
    }
  }
}

/** 洞裡每個像素離洞邊（已知像素）幾格（棋盤距離，兩趟掃描） */
const edgeDistance = (L: Level): Float32Array => {
  const { w, h, hole } = L, INF = 1e9, d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = hole[i] ? INF : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!d[i]) continue;
    let m = d[i];
    if (x > 0) m = Math.min(m, d[i - 1] + 1);
    if (y > 0) { m = Math.min(m, d[i - w] + 1); if (x > 0) m = Math.min(m, d[i - w - 1] + 1); if (x < w - 1) m = Math.min(m, d[i - w + 1] + 1); }
    d[i] = m;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; if (!d[i]) continue;
    let m = d[i];
    if (x < w - 1) m = Math.min(m, d[i + 1] + 1);
    if (y < h - 1) { m = Math.min(m, d[i + w] + 1); if (x < w - 1) m = Math.min(m, d[i + w + 1] + 1); if (x > 0) m = Math.min(m, d[i + w - 1] + 1); }
    d[i] = m;
  }
  return d;
};

/**
 * 在一塊 RGBA 影像（就是工作範圍那一塊）上補洞。
 * alpha：每個像素被筆刷蓋到的程度（0…1）。回傳一塊同大小的新 RGBA（不改動輸入）。
 * 沒有洞或周圍完全沒有可用的質感時回傳 null。
 */
export function inpaintCrop(rgba: Uint8ClampedArray, W: number, H: number, alpha: Float32Array, seed = 1): Uint8ClampedArray | null {
  const n = W * H;
  const base: Level = { w: W, h: H, img: new Float32Array(n * 3), hole: new Uint8Array(n) };
  let holes = 0;
  for (let i = 0; i < n; i++) {
    base.img[i * 3] = rgba[i * 4]; base.img[i * 3 + 1] = rgba[i * 4 + 1]; base.img[i * 3 + 2] = rgba[i * 4 + 2];
    if (alpha[i] > HOLE_T) { base.hole[i] = 1; holes++; }
  }
  if (!holes) return null;
  // 金字塔：一路縮到洞只剩幾個像素寬（或範圍本身太小、再縮就沒有合格的來源了）
  const levels: Level[] = [base];
  const extent = (L: Level) => {
    let x0 = L.w, y0 = L.h, x1 = -1, y1 = -1;
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) if (L.hole[y * L.w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return Math.max(x1 - x0 + 1, y1 - y0 + 1);
  };
  while (true) {
    const L = levels[levels.length - 1];
    if (L.w < P * 4 || L.h < P * 4 || extent(L) <= P) break;
    const D = down(L);
    if (!validCenters(D).length) break;
    levels.push(D);
  }
  const rand = rng(seed * 2654435761 + W * 31 + H);
  let prev: { L: Level; targets: Int32Array; nnf: Int32Array } | null = null;
  for (let li = levels.length - 1; li >= 0; li--) {
    const L = levels[li];
    const valid = validCenters(L);
    if (!valid.length) { if (li === 0) return null; continue; }
    const validMap = new Uint8Array(L.w * L.h);
    for (const q of valid) validMap[q] = 1;
    const targets = targetCenters(L);
    const nnf = new Int32Array(targets.length);
    if (!prev) {
      diffuseFill(L);          // 保底：萬一有哪一格沒被 onion 補到
      const pick = onionInit(L, valid, rand);
      for (let t = 0; t < targets.length; t++) { const q = pick[targets[t]]; nnf[t] = q >= 0 ? q : valid[(rand() * valid.length) | 0]; }
    } else {
      // 洞裡的像素先用粗一層的結果放大（雙線性）當起點
      const C = prev.L;
      for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
        const i = y * L.w + x; if (!L.hole[i]) continue;
        const fx = Math.min(C.w - 1, Math.max(0, (x - 0.5) / 2)), fy = Math.min(C.h - 1, Math.max(0, (y - 0.5) / 2));
        const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(C.w - 1, x0 + 1), y1 = Math.min(C.h - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
        for (let c = 0; c < 3; c++) {
          const a = C.img[(y0 * C.w + x0) * 3 + c], b = C.img[(y0 * C.w + x1) * 3 + c], d = C.img[(y1 * C.w + x0) * 3 + c], e = C.img[(y1 * C.w + x1) * 3 + c];
          L.img[i * 3 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
        }
      }
      // 對應關係也放大兩倍（落到不合格的位置就隨機換一個合格的）
      const cIdx = new Int32Array(C.w * C.h).fill(-1);
      for (let t = 0; t < prev.targets.length; t++) cIdx[prev.targets[t]] = t;
      for (let t = 0; t < targets.length; t++) {
        const p = targets[t], px = p % L.w, py = (p / L.w) | 0;
        const cp = Math.min(C.h - 1, py >> 1) * C.w + Math.min(C.w - 1, px >> 1);
        const ct = cIdx[cp];
        let q = -1;
        if (ct >= 0) {
          const cq = prev.nnf[ct], qx = (cq % C.w) * 2 + (px & 1), qy = ((cq / C.w) | 0) * 2 + (py & 1);
          if (qx >= PR && qy >= PR && qx < L.w - PR && qy < L.h - PR) { const qq = qy * L.w + qx; if (validMap[qq]) q = qq; }
        }
        nnf[t] = q >= 0 ? q : valid[(rand() * valid.length) | 0];
      }
      // 洞裡從邊往內重新補一次（粗層的對應當建議），細的結構才接得進去
      const suggest = new Int32Array(L.w * L.h).fill(-1);
      for (let t = 0; t < targets.length; t++) suggest[targets[t]] = nnf[t];
      const pick = onionFast(L, validMap, valid, suggest, rand);
      for (let t = 0; t < targets.length; t++) { const q = pick[targets[t]]; if (q >= 0) nnf[t] = q; }
    }
    // 粗層多跑幾輪定大結構，細層少跑幾輪補細節（Wexler 的做法）
    const fromCoarse = levels.length - 1 - li;
    const iters = fromCoarse === 0 ? 12 : fromCoarse === 1 ? 8 : li === 0 ? 6 : 5;
    solveLevel(L, valid, validMap, targets, nnf, iters, rand, li === 0);
    prev = { L, targets, nnf };
  }
  // 用筆刷的柔邊混回原圖：覆蓋率 ≥ 0.3 的整塊換掉，外圈平滑過渡（帶子窄，不會留一圈新舊重疊的鬼影）
  const out = new Uint8ClampedArray(rgba);
  const img = base.img;
  for (let i = 0; i < n; i++) {
    const a = alpha[i];
    if (a <= HOLE_T) continue;
    const u = Math.min(1, (a - HOLE_T) / (0.3 - HOLE_T)), t = u * u * (3 - 2 * u);
    out[i * 4] = rgba[i * 4] + (img[i * 3] - rgba[i * 4]) * t;
    out[i * 4 + 1] = rgba[i * 4 + 1] + (img[i * 3 + 1] - rgba[i * 4 + 1]) * t;
    out[i * 4 + 2] = rgba[i * 4 + 2] + (img[i * 3 + 2] - rgba[i * 4 + 2]) * t;
  }
  return out;
}

/** 從整張圖切出工作範圍、補洞、回傳範圍與結果（同步版；原尺寸輸出與重播用） */
export function inpaintImage(data: Uint8ClampedArray, W: number, H: number, alpha: Float32Array, hole: PatchRect, seed = 1): { rect: PatchRect; rgba: Uint8ClampedArray } | null {
  const crop = cropFor(data, W, H, alpha, hole);
  const res = inpaintCrop(crop.rgba, crop.rect.w, crop.rect.h, crop.alpha, seed);
  return res ? { rect: crop.rect, rgba: res } : null;
}

export function cropFor(data: Uint8ClampedArray, W: number, H: number, alpha: Float32Array, hole: PatchRect) {
  const rect = patchRoi(W, H, hole);
  const rgba = new Uint8ClampedArray(rect.w * rect.h * 4), a = new Float32Array(rect.w * rect.h);
  for (let y = 0; y < rect.h; y++) {
    const si = (rect.y + y) * W + rect.x;
    rgba.set(data.subarray(si * 4, (si + rect.w) * 4), y * rect.w * 4);
    a.set(alpha.subarray(si, si + rect.w), y * rect.w);
  }
  return { rect, rgba, alpha: a };
}
