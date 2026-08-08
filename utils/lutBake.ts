/**
 * 把「整條顏色鏈」烤成一顆 3D LUT。
 *
 * 為什麼要這樣做
 * ─────────────────────────────────────────────────────────────────
 * 編輯器那條 processPixels 是逐像素跑的：預覽 828×1792 就是 148 萬次
 * 查表＋色彩空間轉換，一次 150～250ms。換一顆濾鏡、動一下滑桿都要重跑一次，
 * 那就是「點濾鏡很卡」的原因。
 *
 * 但整條鏈（曝光、對比、色溫、飽和、曲線、HSL、底片 LUT…）有一個關鍵性質：
 * **它是純粹的 RGB→RGB 函數** —— 同樣的輸入色一定得到同樣的輸出色，
 * 跟這顆像素在圖上的哪個位置、旁邊是什麼完全無關。
 * 這種函數可以整條收進一張查色表：只要在 33³ 個格點上各算一次（三萬多次，約 1ms），
 * 中間的顏色用三線性內插補出來就好。
 *
 * 專業軟體（Lightroom、DaVinci 那一類）就是這樣做的：CPU 算出一顆小小的 3D LUT，
 * GPU 每一幀只做一次查表。換濾鏡＝換一張幾十 KB 的貼圖，一個 draw call 就畫完。
 *
 * 這一支刻意**不重寫任何顏色公式** —— 它直接呼叫現有的 processPixels，
 * 只是把「一張照片」換成「一張含有所有格點顏色的合成圖」。
 * 所以顏色數學的真理來源仍然是原本那份 CPU 程式碼，
 * 兩條路唯一的差別只剩「格點內插」帶來的誤差，而那是可以量的。
 *
 * 不能烤進來的東西
 * ─────────────────────────────────────────────────────────────────
 * 銳化要看鄰居像素、顆粒與模糊是空間運算、暈影跟位置有關 ——
 * 這些都不是純粹的 RGB→RGB，所以留在原本的路徑上，這裡只收顏色。
 */

export type BakedLut = {
  /** 每邊幾個格點（33 是業界常用值：32 段 ＋ 收尾那一點，剛好對齊 0 與 255） */
  size: number;
  /** size³ × 3 的 RGB 資料，索引是 ((b * size + g) * size + r) * 3 */
  data: Uint8ClampedArray;
};

/** 產生「所有格點顏色」的來源圖：第 i 個像素的顏色就是第 i 個格點 */
export const makeIdentityGrid = (size: number): Uint8ClampedArray => {
  const n = size * size * size;
  const src = new Uint8ClampedArray(n * 4);
  const step = 255 / (size - 1);
  let i = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        src[i] = Math.round(r * step);
        src[i + 1] = Math.round(g * step);
        src[i + 2] = Math.round(b * step);
        src[i + 3] = 255;
        i += 4;
      }
    }
  }
  return src;
};

/**
 * 用現有的像素管線把顏色鏈烤成 3D LUT。
 *
 * @param run  就是 processPixels，由呼叫端把 params / 濾鏡 / 曲線都綁好，
 *             這裡只負責餵格點圖進去、把結果撿出來。簽名固定為
 *             (source, dest, w, h) —— 其餘參數呼叫端自己閉包起來。
 */
export const bakeColorLut = (
  run: (source: Uint8ClampedArray, dest: Uint8ClampedArray, w: number, h: number) => void,
  size = 33,
): BakedLut => {
  const n = size * size * size;
  const src = makeIdentityGrid(size);
  const dst = new Uint8ClampedArray(n * 4);
  /* 排成一長條（w = n, h = 1）。刻意不排成方形：管線裡若有任何跟行列有關的
     邏輯（例如以列為單位的最佳化），一長條最不容易踩到。 */
  run(src, dst, n, 1);
  const data = new Uint8ClampedArray(n * 3);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    data[i * 3] = dst[j];
    data[i * 3 + 1] = dst[j + 1];
    data[i * 3 + 2] = dst[j + 2];
  }
  return { size, data };
};

/**
 * 在 CPU 上用三線性內插查這顆表 —— 跟 GPU 的 sampler3D(LINEAR) 算的是同一件事。
 * 拿來當比對基準，以及沒有 WebGL2 時的退路。
 */
export const sampleBaked = (
  lut: BakedLut, r: number, g: number, b: number, out: { r: number; g: number; b: number },
): void => {
  const { size, data } = lut;
  const max = size - 1;
  const fr = (r / 255) * max, fg = (g / 255) * max, fb = (b / 255) * max;
  const r0 = Math.min(max, Math.floor(fr)), g0 = Math.min(max, Math.floor(fg)), b0 = Math.min(max, Math.floor(fb));
  const r1 = Math.min(max, r0 + 1), g1 = Math.min(max, g0 + 1), b1 = Math.min(max, b0 + 1);
  const dr = fr - r0, dg = fg - g0, db = fb - b0;
  const at = (ri: number, gi: number, bi: number) => ((bi * size + gi) * size + ri) * 3;
  let or = 0, og = 0, ob = 0;
  for (let k = 0; k < 8; k++) {
    const ri = k & 1 ? r1 : r0, gi = k & 2 ? g1 : g0, bi = k & 4 ? b1 : b0;
    const wr = k & 1 ? dr : 1 - dr, wg = k & 2 ? dg : 1 - dg, wb = k & 4 ? db : 1 - db;
    const wgt = wr * wg * wb;
    if (wgt === 0) continue;
    const o = at(ri, gi, bi);
    or += data[o] * wgt; og += data[o + 1] * wgt; ob += data[o + 2] * wgt;
  }
  out.r = or; out.g = og; out.b = ob;
};

/** 把烤好的表攤成 GPU 用的 RGBA 貼圖資料（sampler3D 要 RGBA8） */
export const bakedToTexture = (lut: BakedLut): Uint8Array => {
  const n = lut.size * lut.size * lut.size;
  const tex = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    tex[i * 4] = lut.data[i * 3];
    tex[i * 4 + 1] = lut.data[i * 3 + 1];
    tex[i * 4 + 2] = lut.data[i * 3 + 2];
    tex[i * 4 + 3] = 255;
  }
  return tex;
};
