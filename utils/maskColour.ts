/* 遮色片自己的 HSL：跟全圖 HSL（utils/photoPixelCore 第 8 步）完全同一套公式與上限，
   只是包成「一個顏色進、一個顏色出」，給遮色片的逐點／烤查色表用。 */
const HSL_MAX_HUE_SHIFT = 15, HSL_MAX_SAT = .5, HSL_MAX_LUM = .1;
const CENTERS = [0, 30, 60, 120, 180, 240, 270, 300];
type Band = { h: number; s: number; l: number };
export const isMaskHslIdentity = (x: Band[] | null | undefined) => !x || x.length !== 8 || x.every(b => b.h === 0 && b.s === 0 && b.l === 0);

/** 回傳一支就地改寫 c（0~255）的函式；沒調任何東西時回傳 null */
export function makeHslFast(arr: Band[] | null | undefined): ((c: Float32Array) => void) | null {
  if (isMaskHslIdentity(arr)) return null;
  const H = arr!.map(b => b.h / 100), S = arr!.map(b => b.s / 100 * HSL_MAX_SAT), L = arr!.map(b => b.l / 100 * HSL_MAX_LUM);
  return (c: Float32Array) => {
    const r = c[0], g = c[1], b = c[2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), chroma = mx - mn;
    const gt = chroma / 255, tg = gt <= .03 ? 0 : gt >= .12 ? 1 : (gt - .03) / .09;
    const gate = tg * tg * (3 - 2 * tg);
    if (gate <= 0) return;
    let hue = mx === r ? 60 * (((g - b) / chroma) % 6) : mx === g ? 60 * ((b - r) / chroma + 2) : 60 * ((r - g) / chroma + 4);
    if (hue < 0) hue += 360;
    const lgt = (mx + mn) / 510, sat = chroma / (255 - Math.abs(mx + mn - 255));
    let i0 = 7;
    for (let k = 0; k < 7; k++) if (hue < CENTERS[k + 1]) { i0 = k; break; }
    const c0 = CENTERS[i0], c1 = i0 === 7 ? 360 : CENTERS[i0 + 1], i1 = i0 === 7 ? 0 : i0 + 1;
    const tt = c1 === c0 ? 0 : (hue - c0) / (c1 - c0), wb = tt * tt * (3 - 2 * tt), wa = 1 - wb;
    const dh = (H[i0] * wa + H[i1] * wb) * gate, ds = (S[i0] * wa + S[i1] * wb) * gate, dl = (L[i0] * wa + L[i1] * wb) * gate;
    let h2 = hue + dh * HSL_MAX_HUE_SHIFT; if (h2 < 0) h2 += 360; else if (h2 >= 360) h2 -= 360;
    const s2 = Math.max(0, Math.min(1, sat * (1 + ds)));
    const l2 = Math.max(0, Math.min(1, dl >= 0 ? lgt + (1 - lgt) * dl : lgt * (1 + dl)));
    const cc = (1 - Math.abs(2 * l2 - 1)) * s2, hp = h2 / 60, xx = cc * (1 - Math.abs((hp % 2) - 1));
    let r2 = 0, g2 = 0, b2 = 0;
    if (hp < 1) { r2 = cc; g2 = xx; } else if (hp < 2) { r2 = xx; g2 = cc; } else if (hp < 3) { g2 = cc; b2 = xx; }
    else if (hp < 4) { g2 = xx; b2 = cc; } else if (hp < 5) { r2 = xx; b2 = cc; } else { r2 = cc; b2 = xx; }
    const mm = l2 - cc * .5;
    c[0] = Math.max(0, Math.min(255, (r2 + mm) * 255)); c[1] = Math.max(0, Math.min(255, (g2 + mm) * 255)); c[2] = Math.max(0, Math.min(255, (b2 + mm) * 255));
  };
}
