import type { EditorParams } from '../components/ImageEditor';
import { makeToneStage, applyToneStage, applySaturation, makeToneFast } from './photoToneMath';
const HSL_MAX_HUE_SHIFT=15,HSL_MAX_SAT=.5,HSL_MAX_LUM=.1;
const HSL_CENTERS=Float32Array.from([0,30,60,120,180,240,270,300]);
const DEFAULT_HSL=Array.from({length:8},()=>({h:0,s:0,l:0}));
const isHslIdentity=(x:any)=>!x||x.every((b:any)=>b.h===0&&b.s===0&&b.l===0);
const ditherTable=Float32Array.from({length:4096},()=> (Math.random()-.5)*.75);
export const copyPixelDither=()=>ditherTable.slice();
export const setPixelDither=(value:Float32Array)=>ditherTable.set(value);
const masterLUT_R=new Float32Array(32768),masterLUT_G=new Float32Array(32768),masterLUT_B=new Float32Array(32768);

/** Per-channel exposure → brightness → contrast as an 8-bit table.
 *  processPixels no longer reads it (it evaluates photoToneMath directly at
 *  full precision); kept for callers that still pass one in. */
export function generateBaseCorrectionLut(exposure: number, contrast: number, brightness: number, output: Uint8Array): void {
    const stage = makeToneStage({ exposure, contrast, brightness, shadows: 0, highlights: 0, temp: 0, tint: 0, sat: 0 });
    const c = new Float32Array(3);
    for (let i = 0; i < 256; i++) { applyToneStage(stage, i, i, i, c); output[i] = Math.round(c[0]); }
}

/** Expose the existing full-precision master directly: no second resampling,
 * no 8-bit intermediate and no additional full pixel loop. */
export function bakePixelMaster(p:EditorParams,film:{data:Uint8ClampedArray;size:number}|null){
 const base=new Uint8Array(256);generateBaseCorrectionLut(p.exposure,p.contrast,p.brightness,base);
 const curve=Uint8Array.from({length:256},(_,i)=>i),curves={rgb:curve,r:curve,g:curve,b:curve};
 const empty=new Uint8ClampedArray(0);
 processPixels(empty,empty,0,0,p,film?.data||null,film?.size||0,base,null,false,curves);
 const result=new Float32Array(32768*4);
 for(let i=0;i<32768;i++){result[i*4]=masterLUT_R[i]/255;result[i*4+1]=masterLUT_G[i]/255;result[i*4+2]=masterLUT_B[i]/255;result[i*4+3]=1;}
 return result;
}

export const processPixels = (
  sourceData: Uint8ClampedArray,
  destData: Uint8ClampedArray,
  w: number,
  h: number,
  p: EditorParams,
  lutData: Uint8ClampedArray | null,
  lutSize: number,
  baseCorrectionLut: Uint8Array, 
  sharpenDetail: Int8Array | null,
  useNearestLut: boolean,
  curveLuts: { rgb: Uint8Array, r: Uint8Array, g: Uint8Array, b: Uint8Array }
) => {
  if (!sourceData || !destData || sourceData.length !== destData.length) return;

  const cLutM = curveLuts.rgb;
  const cLutR = curveLuts.r;
  const cLutG = curveLuts.g;
  const cLutB = curveLuts.b;
  
  const hasCurves = p.curves.rgb.length > 2 || p.curves.r.length > 2 || p.curves.g.length > 2 || p.curves.b.length > 2 ||
                    p.curves.rgb.some((pt: any) => pt.y !== pt.x) || p.curves.r.some((pt: any) => pt.y !== pt.x) || 
                    p.curves.g.some((pt: any) => pt.y !== pt.x) || p.curves.b.some((pt: any) => pt.y !== pt.x);

  const stage = makeToneStage(p);
  const tc = new Float32Array(3);
  const toneFast = makeToneFast(stage);
  // The master grid has only 32 input levels per channel: precompute them.
  const wbM = toneFast.wb;
  const gridLin = new Float32Array(32), gridTone = new Float32Array(32);
  for (let i = 0; i < 32; i++) { const v = (i * 255) / 31; gridLin[i] = toneFast.toLinear(v); toneFast(v, v, v, tc); gridTone[i] = tc[0]; }
  const curveAt = (t: Uint8Array, v: number) => { const f = v < 0 ? 0 : v > 255 ? 255 : v, i = f | 0; return i >= 255 ? t[255] : t[i] + (t[i + 1] - t[i]) * (f - i); };
  const hasTempTint = !!stage.wb;

  // Saturation & Vibrance Constants
  const satMult = stage.sat;
  const vibVal = (p.vib * 0.5) / 100;
  const hasVib = vibVal !== 0;

  // Film LUT Constants
  const lutAmount = p.lutAmount / 100;
  const hasLut = !!lutData && lutAmount > 0;
  const lutSizeSq = lutSize * lutSize;
  const lutMax = lutSize - 1;
  
  // HSL Constants —— 八個色帶先攤平成三個小陣列，內迴圈就不用一直走物件
  const hslArr = p.hsl && p.hsl.length === 8 ? p.hsl : DEFAULT_HSL;
  const hasHsl = !isHslIdentity(hslArr);
  const hslCenters = HSL_CENTERS;
  const hslH = new Float32Array(8), hslS = new Float32Array(8), hslL = new Float32Array(8);
  for (let k = 0; k < 8; k++) {
    hslH[k] = hslArr[k].h / 100;
    hslS[k] = hslArr[k].s / 100 * HSL_MAX_SAT;
    hslL[k] = hslArr[k].l / 100 * HSL_MAX_LUM;
  }

  // Sharpen Constants (Multiply amount since Int8 is halved)
  const hasSharpen = p.sharpen > 0 && !!sharpenDetail;
  const sharpenAmount = p.sharpen > 0 ? ((p.sharpen / 100) * 0.59) * 2.0 : 0;
  
  // --- SMART OPTIMIZATION: MASTER 3D LUT BAKING ---
  // In order to process 2.56M pixels at 60fps within a single CPU thread without losing resolution,
  // we adopt the DaVinci Resolve proxy pattern: we bake the ENTIRE math-heavy color pipeline 
  // into an interim 32x32x32 3D Master LUT (takes < 2ms to generate).
  
  const MASTER_DIM = 32;
  const MASTER_MAX = 31;
  let masterIdx = 0;

  for (let l_b = 0; l_b < MASTER_DIM; l_b++) {
      for (let l_g = 0; l_g < MASTER_DIM; l_g++) {
          for (let l_r = 0; l_r < MASTER_DIM; l_r++) {
              let r = (l_r * 255.0) / 31.0;
              let g = (l_g * 255.0) / 31.0;
              let b = (l_b * 255.0) / 31.0;

              // 1–3. White balance → exposure → tone curve (utils/photoToneMath).
              //      The legacy 8-bit base table is no longer used here.
              if (wbM) {
                  const x = gridLin[l_r], y = gridLin[l_g], z = gridLin[l_b];
                  r = toneFast.encode(wbM[0] * x + wbM[1] * y + wbM[2] * z);
                  g = toneFast.encode(wbM[3] * x + wbM[4] * y + wbM[5] * z);
                  b = toneFast.encode(wbM[6] * x + wbM[7] * y + wbM[8] * z);
              } else { r = gridTone[l_r]; g = gridTone[l_g]; b = gridTone[l_b]; }

              // 4. Curves — exactly what the curve editor draws (no partial mix),
              //    interpolated between the 256 table entries.
              if (hasCurves) {
                  r = curveAt(cLutR, curveAt(cLutM, r)); g = curveAt(cLutG, curveAt(cLutM, g)); b = curveAt(cLutB, curveAt(cLutM, b));
              }

              // 5. Saturation around luminance; −100 is exact monochrome.
              if (stage.sat !== 1) { tc[0] = r; tc[1] = g; tc[2] = b; applySaturation(stage.sat, tc); r = tc[0]; g = tc[1]; b = tc[2]; }
              const avg = (r + g + b) * 0.33333;

              // 6. Vibrance
              if (hasVib) {
                  let max = r > g ? (r > b ? r : b) : (g > b ? g : b);
                  let min = r < g ? (r < b ? r : b) : (g < b ? g : b);
                  const curSat = max === 0 ? 0 : (max - min) / max;
                  const boost = vibVal > 0 ? vibVal * (1 - curSat * curSat) : vibVal;
                  const b1 = 1 + boost;
                  r = avg + (r - avg) * b1; g = avg + (g - avg) * b1; b = avg + (b - avg) * b1;
              }

              r = r < 0 ? 0 : r > 255 ? 255 : r; g = g < 0 ? 0 : g > 255 ? 255 : g; b = b < 0 ? 0 : b > 255 ? 255 : b;

              // 7. LUT (Film)
              if (hasLut && lutData) {
                  const s = 0.00392156862 * lutMax;
                  const rf = r * s; const gf = g * s; const bf = b * s;
                  const r0 = rf | 0; const r1 = r0 + 1 > lutMax ? lutMax : r0 + 1;
                  const g0 = gf | 0; const g1 = g0 + 1 > lutMax ? lutMax : g0 + 1;
                  const b0 = bf | 0; const b1 = b0 + 1 > lutMax ? lutMax : b0 + 1;
                  const dr = rf - r0; const dg = gf - g0; const db = bf - b0;
                  const b0sz = b0 * lutSizeSq; const b1sz = b1 * lutSizeSq;
                  const g0sz = g0 * lutSize; const g1sz = g1 * lutSize;
                  const i000 = (b0sz + g0sz + r0) * 3; const i100 = (b0sz + g0sz + r1) * 3;
                  const i010 = (b0sz + g1sz + r0) * 3; const i110 = (b0sz + g1sz + r1) * 3;
                  const i001 = (b1sz + g0sz + r0) * 3; const i101 = (b1sz + g0sz + r1) * 3;
                  const i011 = (b1sz + g1sz + r0) * 3; const i111 = (b1sz + g1sz + r1) * 3;
                  const r_00 = lutData[i000] + (lutData[i100] - lutData[i000]) * dr;
                  const r_01 = lutData[i001] + (lutData[i101] - lutData[i001]) * dr;
                  const r_10 = lutData[i010] + (lutData[i110] - lutData[i010]) * dr;
                  const r_11 = lutData[i011] + (lutData[i111] - lutData[i011]) * dr;
                  const r_0 = r_00 + (r_10 - r_00) * dg; const r_1 = r_01 + (r_11 - r_01) * dg;
                  const lr = r_0 + (r_1 - r_0) * db;
                  const g_00 = lutData[i000+1] + (lutData[i100+1] - lutData[i000+1]) * dr;
                  const g_01 = lutData[i001+1] + (lutData[i101+1] - lutData[i001+1]) * dr;
                  const g_10 = lutData[i010+1] + (lutData[i110+1] - lutData[i010+1]) * dr;
                  const g_11 = lutData[i011+1] + (lutData[i111+1] - lutData[i011+1]) * dr;
                  const g_0 = g_00 + (g_10 - g_00) * dg; const g_1 = g_01 + (g_11 - g_01) * dg;
                  const lg = g_0 + (g_1 - g_0) * db;
                  const b_00 = lutData[i000+2] + (lutData[i100+2] - lutData[i000+2]) * dr;
                  const b_01 = lutData[i001+2] + (lutData[i101+2] - lutData[i001+2]) * dr;
                  const b_10 = lutData[i010+2] + (lutData[i110+2] - lutData[i010+2]) * dr;
                  const b_11 = lutData[i011+2] + (lutData[i111+2] - lutData[i011+2]) * dr;
                  const b_0 = b_00 + (b_10 - b_00) * dg; const b_1 = b_01 + (b_11 - b_01) * dg;
                  const lb = b_0 + (b_1 - b_0) * db;
                  r += (lr - r) * lutAmount; g += (lg - g) * lutAmount; b += (lb - b) * lutAmount;
              }

              // 8. HSL —— 放在最後，所以使用者看到什麼顏色就是在調什麼顏色
              if (hasHsl) {
                  const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
                  const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
                  const chroma = mx - mn;
                  // 彩度太低的時候色相是雜訊，權重淡出，灰牆才不會冒出色斑
                  const gt = chroma * 0.00392156862;   // /255
                  const tg = gt <= 0.03 ? 0 : gt >= 0.12 ? 1 : (gt - 0.03) / 0.09;
                  const gate = tg * tg * (3 - 2 * tg);
                  if (gate > 0) {
                      let hue: number;
                      if (mx === r) hue = 60 * (((g - b) / chroma) % 6);
                      else if (mx === g) hue = 60 * ((b - r) / chroma + 2);
                      else hue = 60 * ((r - g) / chroma + 4);
                      if (hue < 0) hue += 360;
                      const lgt = (mx + mn) * 0.00196078431;   // /2/255
                      const sat = chroma / (255 - Math.abs(mx + mn - 255));

                      // 落在哪兩個色帶中心之間，用 smoothstep 內插（兩顆權重加起來 = 1）
                      let i0 = 7;
                      for (let k = 0; k < 7; k++) { if (hue < hslCenters[k + 1]) { i0 = k; break; } }
                      const c0 = hslCenters[i0];
                      const c1 = i0 === 7 ? 360 : hslCenters[i0 + 1];
                      const i1 = i0 === 7 ? 0 : i0 + 1;
                      const tt = c1 === c0 ? 0 : (hue - c0) / (c1 - c0);
                      const wb = tt * tt * (3 - 2 * tt);
                      const wa = 1 - wb;

                      const dh = (hslH[i0] * wa + hslH[i1] * wb) * gate;
                      const ds = (hslS[i0] * wa + hslS[i1] * wb) * gate;
                      const dl = (hslL[i0] * wa + hslL[i1] * wb) * gate;

                      let h2 = hue + dh * HSL_MAX_HUE_SHIFT;
                      if (h2 < 0) h2 += 360; else if (h2 >= 360) h2 -= 360;
                      let s2 = sat * (1 + ds);
                      s2 = s2 < 0 ? 0 : s2 > 1 ? 1 : s2;
                      let l2 = dl >= 0 ? lgt + (1 - lgt) * dl : lgt * (1 + dl);
                      l2 = l2 < 0 ? 0 : l2 > 1 ? 1 : l2;

                      // HSL → RGB
                      const cc = (1 - Math.abs(2 * l2 - 1)) * s2;
                      const hp = h2 / 60;
                      const xx = cc * (1 - Math.abs((hp % 2) - 1));
                      let r2 = 0, g2 = 0, b2 = 0;
                      if (hp < 1) { r2 = cc; g2 = xx; }
                      else if (hp < 2) { r2 = xx; g2 = cc; }
                      else if (hp < 3) { g2 = cc; b2 = xx; }
                      else if (hp < 4) { g2 = xx; b2 = cc; }
                      else if (hp < 5) { r2 = xx; b2 = cc; }
                      else { r2 = cc; b2 = xx; }
                      const mm = l2 - cc * 0.5;
                      r = (r2 + mm) * 255; g = (g2 + mm) * 255; b = (b2 + mm) * 255;
                      r = r < 0 ? 0 : r > 255 ? 255 : r;
                      g = g < 0 ? 0 : g > 255 ? 255 : g;
                      b = b < 0 ? 0 : b > 255 ? 255 : b;
                  }
              }

              masterLUT_R[masterIdx] = r; masterLUT_G[masterIdx] = g; masterLUT_B[masterIdx] = b;
              masterIdx++;
          }
      }
  }

  // --- APPLY MASTER LUT TO PIXELS ---
  const len = sourceData.length;
  const sLUT = 0.12156862745; // 31 / 255
  let ditherIdx = 0;

  // With independent channel corrections, tetrahedral interpolation reduces
  // exactly to three 1D tables. Keep the same master LUT and dithering, but do
  // not recompute RGB tetrahedra for millions of pixels on every slider tick.
  // Tone, exposure, brightness, contrast, shadows and highlights are all
  // per-channel now; only white balance and saturation mix channels.
  if (!useNearestLut && !hasLut && !hasHsl && !hasCurves && !hasTempTint &&
      !hasVib && satMult === 1 && !hasSharpen) {
    const rr=new Float64Array(256),gg=new Float64Array(256),bb=new Float64Array(256);
    for(let v=0;v<256;v++){
      const f=v*sLUT,a=f|0,b=a===31?31:a+1,t=f-a;
      rr[v]=masterLUT_R[a]*(1-t)+masterLUT_R[b]*t;
      gg[v]=masterLUT_G[a<<5]*(1-t)+masterLUT_G[b<<5]*t;
      bb[v]=masterLUT_B[a<<10]*(1-t)+masterLUT_B[b<<10]*t;
    }
    for(let i=0;i<len;i+=4){
      const d=ditherTable[(i>>>2)&4095];
      destData[i]=rr[sourceData[i]]+d;destData[i+1]=gg[sourceData[i+1]]+d;
      destData[i+2]=bb[sourceData[i+2]]+d;destData[i+3]=255;
    }
    return;
  }

  // Split into explicit loops to guarantee CPU JIT vectorization and no block de-opts
  if (useNearestLut) {
      // Nearest-neighbor sampling: extremely fast for high-res previews during interaction (~60fps)
      for (let i = 0; i < len; i += 4) {
          const r = sourceData[i], g = sourceData[i+1], b = sourceData[i+2];

          // Quantize to 32x32x32 master LUT index (branchless)
          const r_idx = (r * 0.12156862745 + 0.5) | 0;
          const g_idx = (g * 0.12156862745 + 0.5) | 0;
          const b_idx = (b * 0.12156862745 + 0.5) | 0;

          const masterIdx = (b_idx << 10) | (g_idx << 5) | r_idx;

          const dither = ditherTable[ditherIdx & 4095];
          ditherIdx++;

          destData[i] = masterLUT_R[masterIdx] + dither;
          destData[i+1] = masterLUT_G[masterIdx] + dither;
          destData[i+2] = masterLUT_B[masterIdx] + dither;
          destData[i+3] = 255;
      }
  } else if (hasSharpen) {
      for (let i = 0; i < len; i += 4) {
          let r = sourceData[i], g = sourceData[i+1], b = sourceData[i+2];

          const rf = r * sLUT; const gf = g * sLUT; const bf = b * sLUT;
          const r0 = rf | 0; const g0 = gf | 0; const b0 = bf | 0;
          const r1 = r0 === 31 ? 31 : r0 + 1;
          const g1 = g0 === 31 ? 31 : g0 + 1;
          const b1 = b0 === 31 ? 31 : b0 + 1;
          
          const dr = rf - r0; const dg = gf - g0; const db = bf - b0;

          const b0_O = b0 << 10; const b1_O = b1 << 10;
          const g0_O = g0 << 5; const g1_O = g1 << 5;

          const i000 = b0_O | g0_O | r0;
          const i111 = b1_O | g1_O | r1;
          let iA, iB, w0, w1, w2, w3;

          if (dr > dg) {
              if (dg > db) {
                  iA = b0_O | g0_O | r1; iB = b0_O | g1_O | r1; w0 = 1.0 - dr; w1 = dr - dg; w2 = dg - db; w3 = db;
              } else if (dr > db) {
                  iA = b0_O | g0_O | r1; iB = b1_O | g0_O | r1; w0 = 1.0 - dr; w1 = dr - db; w2 = db - dg; w3 = dg;
              } else {
                  iA = b1_O | g0_O | r0; iB = b1_O | g0_O | r1; w0 = 1.0 - db; w1 = db - dr; w2 = dr - dg; w3 = dg;
              }
          } else {
              if (db > dg) {
                  iA = b1_O | g0_O | r0; iB = b1_O | g1_O | r0; w0 = 1.0 - db; w1 = db - dg; w2 = dg - dr; w3 = dr;
              } else if (db > dr) {
                  iA = b0_O | g1_O | r0; iB = b1_O | g1_O | r0; w0 = 1.0 - dg; w1 = dg - db; w2 = db - dr; w3 = dr;
              } else {
                  iA = b0_O | g1_O | r0; iB = b0_O | g1_O | r1; w0 = 1.0 - dg; w1 = dg - dr; w2 = dr - db; w3 = db;
              }
          }

          r = masterLUT_R[i000] * w0 + masterLUT_R[iA] * w1 + masterLUT_R[iB] * w2 + masterLUT_R[i111] * w3;
          g = masterLUT_G[i000] * w0 + masterLUT_G[iA] * w1 + masterLUT_G[iB] * w2 + masterLUT_G[i111] * w3;
          b = masterLUT_B[i000] * w0 + masterLUT_B[iA] * w1 + masterLUT_B[iB] * w2 + masterLUT_B[i111] * w3;

          const detail = sharpenDetail![i]; 
          r += detail * sharpenAmount; g += detail * sharpenAmount; b += detail * sharpenAmount;

          const dither = ditherTable[ditherIdx & 4095];
          ditherIdx++;

          destData[i] = r + dither; destData[i+1] = g + dither; destData[i+2] = b + dither; destData[i+3] = 255;
      }
  } else {
      for (let i = 0; i < len; i += 4) {
          let r = sourceData[i], g = sourceData[i+1], b = sourceData[i+2];

          const rf = r * sLUT; const gf = g * sLUT; const bf = b * sLUT;
          const r0 = rf | 0; const g0 = gf | 0; const b0 = bf | 0;
          const r1 = r0 === 31 ? 31 : r0 + 1;
          const g1 = g0 === 31 ? 31 : g0 + 1;
          const b1 = b0 === 31 ? 31 : b0 + 1;
          
          const dr = rf - r0; const dg = gf - g0; const db = bf - b0;

          const b0_O = b0 << 10; const b1_O = b1 << 10;
          const g0_O = g0 << 5; const g1_O = g1 << 5;

          const i000 = b0_O | g0_O | r0;
          const i111 = b1_O | g1_O | r1;
          let iA, iB, w0, w1, w2, w3;

          if (dr > dg) {
              if (dg > db) {
                  iA = b0_O | g0_O | r1; iB = b0_O | g1_O | r1; w0 = 1.0 - dr; w1 = dr - dg; w2 = dg - db; w3 = db;
              } else if (dr > db) {
                  iA = b0_O | g0_O | r1; iB = b1_O | g0_O | r1; w0 = 1.0 - dr; w1 = dr - db; w2 = db - dg; w3 = dg;
              } else {
                  iA = b1_O | g0_O | r0; iB = b1_O | g0_O | r1; w0 = 1.0 - db; w1 = db - dr; w2 = dr - dg; w3 = dg;
              }
          } else {
              if (db > dg) {
                  iA = b1_O | g0_O | r0; iB = b1_O | g1_O | r0; w0 = 1.0 - db; w1 = db - dg; w2 = dg - dr; w3 = dr;
              } else if (db > dr) {
                  iA = b0_O | g1_O | r0; iB = b1_O | g1_O | r0; w0 = 1.0 - dg; w1 = dg - db; w2 = db - dr; w3 = dr;
              } else {
                  iA = b0_O | g1_O | r0; iB = b0_O | g1_O | r1; w0 = 1.0 - dg; w1 = dg - dr; w2 = dr - db; w3 = db;
              }
          }

          r = masterLUT_R[i000] * w0 + masterLUT_R[iA] * w1 + masterLUT_R[iB] * w2 + masterLUT_R[i111] * w3;
          g = masterLUT_G[i000] * w0 + masterLUT_G[iA] * w1 + masterLUT_G[iB] * w2 + masterLUT_G[i111] * w3;
          b = masterLUT_B[i000] * w0 + masterLUT_B[iA] * w1 + masterLUT_B[iB] * w2 + masterLUT_B[i111] * w3;

          const dither = ditherTable[ditherIdx & 4095];
          ditherIdx++;

          destData[i] = r + dither; destData[i+1] = g + dither; destData[i+2] = b + dither; destData[i+3] = 255;
      }
  }
};
