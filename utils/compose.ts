// 構圖（裁切 / 比例 / 翻轉 / 角度 / 梯形校正）的幾何運算。
// 這一層完全不碰 React 與 DOM 狀態，只吃參數吐 canvas，所以預覽與存檔可以走同一條路徑，
// 差別只在輸出邊長。

export interface CropRect {
  /** 都是相對於梯形校正 + 角度轉正後畫面的 0~1 normalized 座標 */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GeoParams {
  /** 90 度為單位的旋轉，0~3 */
  quarter: number;
  /** -45 ~ 45 的微調角度 */
  angle: number;
  flipH: boolean;
  flipV: boolean;
  /** -100 ~ 100，正值把上緣縮窄（相機仰角造成的上寬下窄） */
  keyV: number;
  /** -100 ~ 100，正值把左緣縮窄 */
  keyH: number;
  /** 在自動覆蓋倍率之上再放大多少（雙指縮放），1 = 剛好蓋滿 */
  zoom: number;
  /** 影像在框內的平移，單位是輸出框的寬高比例 */
  offset: { x: number; y: number };
  /** 比例鎖，'free' 代表不鎖；其餘是 w/h 的值 */
  aspect: string;
  crop: CropRect;
}

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

export const DEFAULT_GEO: GeoParams = {
  quarter: 0,
  angle: 0,
  flipH: false,
  flipV: false,
  keyV: 0,
  keyH: 0,
  zoom: 1,
  offset: { x: 0, y: 0 },
  aspect: 'free',
  crop: { ...FULL_CROP },
};

export const ASPECT_PRESETS: { id: string; label: string; ratio: number | null }[] = [
  { id: 'free', label: '自由', ratio: null },
  { id: 'orig', label: '原始', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
  { id: '2:3', label: '2:3', ratio: 2 / 3 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '5:4', label: '5:4', ratio: 5 / 4 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
];

export function isCropFull(c: CropRect) {
  return c.x <= 0.0005 && c.y <= 0.0005 && c.w >= 0.999 && c.h >= 0.999;
}

export function isGeoIdentity(g: GeoParams) {
  return g.quarter === 0 && g.angle === 0 && !g.flipH && !g.flipV &&
    g.keyV === 0 && g.keyH === 0 && (g.zoom ?? 1) === 1 &&
    !(g.offset?.x) && !(g.offset?.y) && isCropFull(g.crop);
}

/** 只有 drawImage 就能完成的部分：90 度旋轉、水平/垂直翻轉。 */
export function stageCanvas(
  img: CanvasImageSource,
  srcW: number,
  srcH: number,
  g: GeoParams,
  maxSize?: number
): HTMLCanvasElement {
  const q = ((g.quarter % 4) + 4) % 4;
  const swap = q === 1 || q === 3;
  let w = swap ? srcH : srcW;
  let h = swap ? srcW : srcH;

  let scale = 1;
  if (maxSize && Math.max(w, h) > maxSize) {
    scale = maxSize / Math.max(w, h);
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
  }

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((q * Math.PI) / 2);
  ctx.scale(g.flipH ? -1 : 1, g.flipV ? -1 : 1);
  const dw = swap ? h : w;
  const dh = swap ? w : h;
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();

  return c;
}

type Quad = [number, number][]; // p0=(0,0) p1=(1,0) p2=(1,1) p3=(0,1) 的目標位置

/** 梯形校正 + 微調角度所形成的四邊形，座標以原圖寬高為單位。 */
function targetQuad(w: number, h: number, g: GeoParams): Quad {
  const kv = Math.max(-1, Math.min(1, g.keyV / 100));
  const kh = Math.max(-1, Math.min(1, g.keyH / 100));

  // 正值縮上緣、負值縮下緣；水平方向同理。0.5 是縮到最窄剩一半。
  const top = Math.max(0, kv) * 0.5;
  const bottom = Math.max(0, -kv) * 0.5;
  const left = Math.max(0, kh) * 0.5;
  const right = Math.max(0, -kh) * 0.5;

  let quad: Quad = [
    [top / 2, left / 2],
    [1 - top / 2, right / 2],
    [1 - bottom / 2, 1 - right / 2],
    [bottom / 2, 1 - left / 2],
  ];

  // 換算到像素座標
  quad = quad.map(([x, y]) => [x * w, y * h]) as Quad;

  if (g.angle !== 0) {
    const a = (g.angle * Math.PI) / 180;
    const cos = Math.cos(a), sin = Math.sin(a);
    const cx = w / 2, cy = h / 2;
    quad = quad.map(([x, y]) => {
      const dx = x - cx, dy = y - cy;
      return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
    }) as Quad;
  }

  return quad;
}

/**
 * 單位正方形 → 四邊形的投影變換係數。
 * (u,v) → ((a·u + b·v + c) / (g·u + h·v + 1), (d·u + e·v + f) / (g·u + h·v + 1))
 */
function squareToQuad(q: Quad) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;

  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    return { a: x1 - x0, b: x2 - x1, c: x0, d: y1 - y0, e: y2 - y1, f: y0, g: 0, h: 0 };
  }
  const den = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(den) < 1e-9) {
    return { a: x1 - x0, b: x2 - x1, c: x0, d: y1 - y0, e: y2 - y1, f: y0, g: 0, h: 0 };
  }
  const g0 = (dx3 * dy2 - dy3 * dx2) / den;
  const h0 = (dx1 * dy3 - dy1 * dx3) / den;
  return {
    a: x1 - x0 + g0 * x1,
    b: x3 - x0 + h0 * x3,
    c: x0,
    d: y1 - y0 + g0 * y1,
    e: y3 - y0 + h0 * y3,
    f: y0,
    g: g0,
    h: h0,
  };
}

function invert3(m: { a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number }) {
  const { a, b, c, d, e, f, g, h } = m;
  const i = 1;
  const A = e * i - f * h;
  const B = c * h - b * i;
  const C = b * f - c * e;
  const D = f * g - d * i;
  const E = a * i - c * g;
  const F = c * d - a * f;
  const G = d * h - e * g;
  const H = b * g - a * h;
  const I = a * e - b * d;
  const det = a * A + b * D + c * G;
  if (Math.abs(det) < 1e-12) return null;
  const s = 1 / det;
  return [A * s, B * s, C * s, D * s, E * s, F * s, G * s, H * s, I * s];
}



function quadCenter(q: Quad): [number, number] {
  return [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4];
}

function scaleAbout(q: Quad, k: number, cx: number, cy: number): Quad {
  return q.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]) as Quad;
}

function translateQuad(q: Quad, dx: number, dy: number): Quad {
  return q.map(([x, y]) => [x + dx, y + dy]) as Quad;
}

function coversFrame(q: Quad, w: number, h: number) {
  return ([[0, 0], [w, 0], [w, h], [0, h]] as [number, number][])
    .every(([x, y]) => insideConvex(q, x, y));
}

/** 蓋滿整個輸出框所需的最小放大倍率 */
function coverFactor(quad: Quad, w: number, h: number) {
  const [cx, cy] = quadCenter(quad);
  if (coversFrame(quad, w, h)) return 1;
  let lo = 1, hi = 2;
  for (let i = 0; i < 20 && !coversFrame(scaleAbout(quad, hi, cx, cy), w, h); i++) hi *= 1.5;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (coversFrame(scaleAbout(quad, mid, cx, cy), w, h)) hi = mid; else lo = mid;
  }
  return hi;
}

/**
 * 先自動放大到蓋滿輸出框，再套上使用者的縮放與平移。
 * 平移量會被收斂到「四邊仍然頂住框」為止 —— 也就是只有還有多餘的影像可以拉時才拉得動。
 */
function placeQuad(quad: Quad, w: number, h: number, zoom: number, offset: { x: number; y: number }): Quad {
  const [cx, cy] = quadCenter(quad);
  const base = scaleAbout(quad, coverFactor(quad, w, h) * Math.max(1, zoom), cx, cy);
  const dx = offset.x * w;
  const dy = offset.y * h;
  if (dx === 0 && dy === 0) return base;
  if (coversFrame(translateQuad(base, dx, dy), w, h)) return translateQuad(base, dx, dy);
  // 拉過頭就退到還蓋得住的最遠位置
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (coversFrame(translateQuad(base, dx * mid, dy * mid), w, h)) lo = mid; else hi = mid;
  }
  return translateQuad(base, dx * lo, dy * lo);
}

/** 把四邊形以中心等比放大，直到整個 w x h 的輸出框都被蓋住為止。 */
function coverQuad(quad: Quad, w: number, h: number): Quad {
  const cx = (quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0]) / 4;
  const cy = (quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1]) / 4;
  const scaled = (k: number): Quad =>
    quad.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]) as Quad;
  const covers = (q: Quad) =>
    ([[0, 0], [w, 0], [w, h], [0, h]] as [number, number][]).every(([x, y]) => insideConvex(q, x, y));

  if (covers(quad)) return quad;
  let lo = 1, hi = 2;
  for (let i = 0; i < 20 && !covers(scaled(hi)); i++) hi *= 1.5;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (covers(scaled(mid))) hi = mid; else lo = mid;
  }
  return scaled(hi);
}

/**
 * 把梯形校正與微調角度實際畫出來。輸出畫布剛好裝下變形後的四邊形，
 * 四邊形外面留空（後續由裁切框決定要不要保留）。
 */
export function warpCanvas(src: HTMLCanvasElement, g: GeoParams, maxSize?: number): HTMLCanvasElement {
  if (g.keyV === 0 && g.keyH === 0 && g.angle === 0 && (g.zoom ?? 1) === 1 && !g.offset?.x && !g.offset?.y) {
    if (!maxSize || Math.max(src.width, src.height) <= maxSize) return src;
    const s = maxSize / Math.max(src.width, src.height);
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(src.width * s));
    out.height = Math.max(1, Math.round(src.height * s));
    const c = out.getContext('2d')!;
    c.imageSmoothingQuality = 'high';
    c.drawImage(src, 0, 0, out.width, out.height);
    return out;
  }

  // 輸出框固定成來源尺寸，畫面不會隨著角度變大變小；影像則自動放大到把整個框蓋滿，
  // 這樣裁切框不用退讓、四角也不會空出來 —— 跟 iPhone 相簿的裁切一致。
  let outW = src.width;
  let outH = src.height;
  let shrink = 1;
  if (maxSize && Math.max(outW, outH) > maxSize) {
    shrink = maxSize / Math.max(outW, outH);
    outW = Math.max(1, Math.round(outW * shrink));
    outH = Math.max(1, Math.round(outH * shrink));
  }

  const quad = targetQuad(src.width, src.height, g).map(([x, y]) => [x * shrink, y * shrink]) as Quad;
  const local = placeQuad(quad, outW, outH, g.zoom ?? 1, g.offset || { x: 0, y: 0 });
  const fwd = squareToQuad(local);
  const inv = invert3(fwd);

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const octx = out.getContext('2d')!;
  if (!inv) {
    octx.drawImage(src, 0, 0, outW, outH);
    return out;
  }

  const sctx = src.getContext('2d', { willReadFrequently: true })!;
  const sData = sctx.getImageData(0, 0, src.width, src.height).data;
  const oImg = octx.createImageData(outW, outH);
  const oData = oImg.data;

  const sw = src.width, sh = src.height;
  const [i0, i1, i2, i3, i4, i5, i6, i7, i8] = inv;

  for (let y = 0; y < outH; y++) {
    const py = y + 0.5;
    for (let x = 0; x < outW; x++) {
      const px = x + 0.5;
      const wgt = i6 * px + i7 * py + i8;
      if (wgt === 0) continue;
      // 反解回單位正方形，再放大到來源像素
      const u = (i0 * px + i1 * py + i2) / wgt;
      const v = (i3 * px + i4 * py + i5) / wgt;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;

      const fx = u * sw - 0.5;
      const fy = v * sh - 0.5;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const x1 = Math.min(sw - 1, Math.max(0, x0 + 1));
      const y1 = Math.min(sh - 1, Math.max(0, y0 + 1));
      const cx0 = Math.min(sw - 1, Math.max(0, x0));
      const cy0 = Math.min(sh - 1, Math.max(0, y0));

      const p00 = (cy0 * sw + cx0) * 4;
      const p10 = (cy0 * sw + x1) * 4;
      const p01 = (y1 * sw + cx0) * 4;
      const p11 = (y1 * sw + x1) * 4;

      const w00 = (1 - tx) * (1 - ty);
      const w10 = tx * (1 - ty);
      const w01 = (1 - tx) * ty;
      const w11 = tx * ty;

      const o = (y * outW + x) * 4;
      oData[o] = sData[p00] * w00 + sData[p10] * w10 + sData[p01] * w01 + sData[p11] * w11;
      oData[o + 1] = sData[p00 + 1] * w00 + sData[p10 + 1] * w10 + sData[p01 + 1] * w01 + sData[p11 + 1] * w11;
      oData[o + 2] = sData[p00 + 2] * w00 + sData[p10 + 2] * w10 + sData[p01 + 2] * w01 + sData[p11 + 2] * w11;
      oData[o + 3] = 255;
    }
  }

  octx.putImageData(oImg, 0, 0);
  return out;
}

/**
 * 變形後的畫面在輸出畫布上佔的四邊形，換算成 0~1。四邊形之外是空的，
 * 裁切框不該框到那裡。
 */
export function outputQuad(_srcW: number, _srcH: number, _g: GeoParams): [number, number][] {
  // 影像現在一律自動放大到蓋滿輸出框，所以整個框都是有效區域，
  // 裁切框不會再因為角度或梯形而被推來推去。
  return [[0, 0], [1, 0], [1, 1], [0, 1]];
}

function insideConvex(quad: [number, number][], px: number, py: number) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = quad[i];
    const [bx, by] = quad[(i + 1) % 4];
    const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    if (Math.abs(cross) < 1e-9) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function cropCorners(c: CropRect): [number, number][] {
  return [[c.x, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + c.h], [c.x, c.y + c.h]];
}

export function cropFitsQuad(quad: [number, number][], c: CropRect) {
  return cropCorners(c).every(([x, y]) => insideConvex(quad, x, y));
}

/**
 * 把裁切框縮到完全落在有效畫面裡的最大尺寸（等比例、以中心收縮）。
 * 旋轉或梯形校正之後，原本的框可能會露出空白角落，這裡把它收回來。
 */
export function fitCropInsideQuad(
  quad: [number, number][],
  crop: CropRect,
  frameW: number,
  frameH: number,
  ratio: number | null
): CropRect {
  const centered = (s: number): CropRect => {
    const cx = crop.x + crop.w / 2;
    const cy = crop.y + crop.h / 2;
    let w = crop.w * s;
    let h = crop.h * s;
    if (ratio !== null) {
      const nRatio = ratio * (frameH / frameW);
      h = Math.min(h, 1);
      w = h * nRatio;
      if (w > 1) { w = 1; h = w / nRatio; }
    }
    return {
      x: Math.max(0, Math.min(1 - w, cx - w / 2)),
      y: Math.max(0, Math.min(1 - h, cy - h / 2)),
      w, h,
    };
  };

  if (cropFitsQuad(quad, centered(1))) return centered(1);

  let lo = 0.05, hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (cropFitsQuad(quad, centered(mid))) lo = mid; else hi = mid;
  }
  return centered(lo);
}

/** 裁切之前的完整畫面（給裁切介面當底圖用）。 */
export function stageAndWarp(
  img: CanvasImageSource,
  srcW: number,
  srcH: number,
  g: GeoParams,
  maxSize?: number
): HTMLCanvasElement {
  return warpCanvas(stageCanvas(img, srcW, srcH, g, maxSize), g, maxSize);
}

/** 完整的構圖結果：翻轉 → 鏡像 → 梯形校正 → 角度 → 裁切。 */
export function composeCanvas(
  img: CanvasImageSource,
  srcW: number,
  srcH: number,
  g: GeoParams,
  maxSize?: number
): HTMLCanvasElement {
  const base = stageAndWarp(img, srcW, srcH, g, maxSize);
  if (isCropFull(g.crop)) return base;

  const cx = Math.max(0, Math.min(base.width - 1, Math.round(g.crop.x * base.width)));
  const cy = Math.max(0, Math.min(base.height - 1, Math.round(g.crop.y * base.height)));
  const cw = Math.max(1, Math.min(base.width - cx, Math.round(g.crop.w * base.width)));
  const ch = Math.max(1, Math.min(base.height - cy, Math.round(g.crop.h * base.height)));

  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  out.getContext('2d')!.drawImage(base, cx, cy, cw, ch, 0, 0, cw, ch);
  return out;
}

/** 依比例把裁切框調成合法的最大置中矩形。 */
export function fitCropToAspect(crop: CropRect, frameW: number, frameH: number, ratio: number | null): CropRect {
  if (ratio === null) return crop;
  const targetPx = ratio * frameH / frameW; // 換算成 normalized 空間的 w/h
  let w = crop.w;
  let h = w / targetPx;
  if (h > 1) { h = 1; w = h * targetPx; }
  if (w > 1) { w = 1; h = w / targetPx; }
  const cx = crop.x + crop.w / 2;
  const cy = crop.y + crop.h / 2;
  let x = cx - w / 2;
  let y = cy - h / 2;
  x = Math.max(0, Math.min(1 - w, x));
  y = Math.max(0, Math.min(1 - h, y));
  return { x, y, w, h };
}
