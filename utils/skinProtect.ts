/* 仿色的膚色保護：先找到真正的臉，再從「這張臉」學出這個人、在這個光線下的膚色。
 *
 * 以前的做法只看顏色像不像「一般的膚色」：木頭、沙灘、磚牆會被誤當成皮膚保護起來，
 * 在藍光、綠光這類有色燈光下的臉反而保護不到。這裡改成：
 *
 *   1. 找臉（faceStill，MediaPipe 478 點）。整張臉的範圍（含嘴唇、眼睛）一定保護。
 *   2. 每張臉各自學一個膚色模型：只取「確定是皮膚」的地方（避開眼睛、眉毛、嘴唇、鼻孔、輪廓邊緣），
 *      在 CIELAB 的色度平面（a*, b*）上求平均與共變異數，剔除離群值再算一次（穩健估計）。
 *      亮度另外記一個範圍（身上的皮膚常常比臉暗，往暗的那邊放寬）。
 *   3. 整張圖每一點算它跟每張臉的膚色有多像（馬氏距離），再乘上「離臉多遠」：
 *      脖子、手臂、手在臉附近才算數，畫面另一頭剛好同色的東西不會被保護。
 *   4. 補洞（閉運算）＋邊緣感知羽化（導引濾波，亮度當導引）：臉上的反光、陰影一起保護，
 *      皮膚與背景的交界保持銳利，不會有一圈色差。
 *
 * 找不到臉就完全不保護（整張照參考圖走）。 */
import { detectFacesStill } from './faceStill';
import { drawSkinMask, FACE_OVAL, type MaskBufs } from './faceSkinDraw';
import { guidedFilter, morphClose, maskSize } from './protectMask';
import { rgbToLab } from './colorTransfer';

/** 皮膚被保護的程度（1 ＝ 膚色完全不換）。0.6 ＝ 膚色跟著整體的色調走四成：
    臉也有被仿到色（跟畫面融在一起、不像貼上去的），但不會被染成參考圖的顏色（藍臉、綠臉） */
export const SKIN_KEEP = 0.6;

export interface SkinMap {
  w: number;
  h: number;
  /** 0～1：這一點是皮膚（或臉）的程度，已經補洞、羽化過 */
  skin: Float32Array;
  faces: number;
}

const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

type Model = { ma: number; mb: number; ia: number; ib: number; ic: number; lLo: number; lHi: number; cx: number; cy: number; size: number };

/** 從一堆 (a, b) 樣本求穩健的高斯：剔除馬氏距離超過 3 的再算一次 */
function fitGauss(A: number[], B: number[]) {
  let keep = A.map(() => true), res = { ma: 0, mb: 0, ia: 1, ib: 1, ic: 0 };
  for (let it = 0; it < 3; it++) {
    let n = 0, sa = 0, sb = 0;
    for (let i = 0; i < A.length; i++) if (keep[i]) { n++; sa += A[i]; sb += B[i]; }
    if (n < 20) break;
    const ma = sa / n, mb = sb / n;
    let caa = 0, cbb = 0, cab = 0;
    for (let i = 0; i < A.length; i++) if (keep[i]) { const da = A[i] - ma, db = B[i] - mb; caa += da * da; cbb += db * db; cab += da * db; }
    // 共變異數加一點底（至少 2 個 Lab 單位的標準差）：臉上顏色很平均時模型不會窄到容不下身上的皮膚
    caa = caa / n + 4; cbb = cbb / n + 4; cab /= n;
    const det = caa * cbb - cab * cab;
    res = { ma, mb, ia: cbb / det, ib: caa / det, ic: -cab / det };
    keep = A.map((a, i) => { const da = a - ma, db = B[i] - mb; return res.ia * da * da + 2 * res.ic * da * db + res.ib * db * db < 9; });
  }
  return res;
}

/** 算出照片的皮膚圖（遮罩尺寸，長邊最多 640）。src 的原始尺寸是 W×H */
export async function buildSkinMap(src: CanvasImageSource, W: number, H: number): Promise<SkinMap> {
  const { w, h } = maskSize(W, H), n = w * h;
  const empty: SkinMap = { w, h, skin: new Float32Array(n), faces: 0 };
  const faces = await detectFacesStill(src, W, H);
  if (!faces.length) return empty;

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data;
  const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n), luma = new Float32Array(n);
  const lab = [0, 0, 0];
  for (let k = 0, p = 0; k < n; k++, p += 4) {
    const r = px[p] / 255, gg = px[p + 1] / 255, b = px[p + 2] / 255;
    rgbToLab(r, gg, b, lab);
    L[k] = lab[0]; A[k] = lab[1]; B[k] = lab[2];
    luma[k] = 0.299 * r + 0.587 * gg + 0.114 * b;
  }

  const bufs: MaskBufs = { a: null, t: null };
  const face = new Float32Array(n);   // 整張臉（一定保護）
  const models: Model[] = [];
  for (const f of faces) {
    // ① 確定是皮膚的地方：faceSkinDraw 的「只有皮膚」遮罩（挖掉眼、眉、唇、鼻孔，外緣內收）取中間最確定的部分
    drawSkinMask(g, w, h, [f], W, H, bufs);
    const sm = g.getImageData(0, 0, w, h).data;
    const sa: number[] = [], sb: number[] = [], sl: number[] = [];
    for (let k = 0; k < n; k++) if (sm[k * 4] > 200) { sa.push(A[k]); sb.push(B[k]); sl.push(L[k]); }
    // ② 整張臉的範圍（外輪廓整塊填滿，柔一點邊）
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.beginPath();
    FACE_OVAL.forEach((i, j) => { const x = f[i * 2] * w, y = f[i * 2 + 1] * h; if (j) g.lineTo(x, y); else g.moveTo(x, y); });
    g.closePath(); g.fillStyle = '#fff'; g.fill();
    const om = g.getImageData(0, 0, w, h).data;
    for (let k = 0; k < n; k++) { const v = om[k * 4] / 255; if (v > face[k]) face[k] = v; }
    if (sa.length < 30) continue;
    const gs = fitGauss(sa, sb);
    sl.sort((x, y) => x - y);
    const lLo = sl[Math.floor(sl.length * 0.05)], lHi = sl[Math.floor(sl.length * 0.95)];
    // 臉的中心與大小（遮罩像素）：額頭 10 到下巴 152 的距離
    let cx = 0, cy = 0;
    for (let i = 0; i < f.length; i += 2) { cx += f[i]; cy += f[i + 1]; }
    cx = cx / (f.length / 2) * w; cy = cy / (f.length / 2) * h;
    const size = Math.max(4, Math.hypot((f[10 * 2] - f[152 * 2]) * w, (f[10 * 2 + 1] - f[152 * 2 + 1]) * h));
    models.push({ ...gs, lLo, lHi, cx, cy, size });
  }

  // ③ 每一點：像不像某張臉的膚色 × 離那張臉多近，取最像的那一張
  const skin = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let best = face[k];
    if (best < 1) for (const m of models) {
      const x = k % w, y = (k - x) / w;
      const dist = Math.hypot(x - m.cx, y - m.cy) / m.size;
      const near = 1 - smooth(1.5, 6, dist);          // 臉的 1.5 倍內全算，6 倍外不算
      if (near <= 0) continue;
      const da = A[k] - m.ma, db = B[k] - m.mb;
      const d2 = m.ia * da * da + 2 * m.ic * da * db + m.ib * db * db;
      const col = Math.exp(-0.5 * d2 / 2.25);            // 比臉上的分布寬 1.5 倍：身上的皮膚受光不同
      const lum = smooth(m.lLo - 35, m.lLo - 15, L[k]) * (1 - smooth(m.lHi + 8, m.lHi + 20, L[k]));
      const v = col * lum * near;
      if (v > best) best = v;
    }
    skin[k] = best;
  }

  // ④ 補洞＋邊緣感知羽化
  const short = Math.min(w, h);
  const closed = morphClose(skin, w, h, Math.max(1, Math.round(short * 0.015)), new Float32Array(n));
  const out = guidedFilter(luma, closed, w, h, Math.max(1, Math.round(short * 0.02)), 0.002, new Float32Array(n));
  c.width = c.height = 0;
  return { w, h, skin: out, faces: faces.length };
}

/** 變成套用時用的保護權重（R 通道），乘上保護程度 */
export function skinWeight(m: SkinMap): Float32Array {
  const out = new Float32Array(m.skin.length);
  for (let i = 0; i < out.length; i++) out[i] = m.skin[i] * SKIN_KEEP;
  return out;
}

/** 統計用：把 RGBA 像素裡「是皮膚」的拿掉（皮膚另外保護，顏色對應只該從其他地方學）。
    剩下太少（大頭照）就整張照用 */
export function withoutSkin(data: Uint8ClampedArray, dw: number, dh: number, m: SkinMap | null): Uint8ClampedArray {
  if (!m || !m.faces) return data;
  const n = dw * dh, keep = new Uint8Array(n);
  let kept = 0;
  for (let y = 0; y < dh; y++) {
    const my = Math.min(m.h - 1, Math.floor((y + 0.5) * m.h / dh));
    for (let x = 0; x < dw; x++) {
      const mx = Math.min(m.w - 1, Math.floor((x + 0.5) * m.w / dw));
      if (m.skin[my * m.w + mx] < 0.35) { keep[y * dw + x] = 1; kept++; }
    }
  }
  if (kept < n * 0.25) return data;
  const out = new Uint8ClampedArray(kept * 4);
  for (let i = 0, j = 0; i < n; i++) if (keep[i]) { out[j++] = data[i * 4]; out[j++] = data[i * 4 + 1]; out[j++] = data[i * 4 + 2]; out[j++] = 255; }
  return out;
}
