/* ── 發光類特效在「原始照片」上計算 ────────────────────────────────────
   柔光、光暈、柔光ll、霓虹、變形光斑會先偵測亮部再發光。它們在還沒套
   濾鏡／調節的原圖上算，濾鏡與調節再套在「原圖＋光」整張上 —— 跟底片一樣：
   光暈在拍下去的那一刻就在底片上，後面的沖印調色調的是含光暈的整張。
     · 偵測範圍只看原圖：拉曲線、調曝光、換濾鏡，發光的位置與範圍都不會變
     · 光也一起被調色：壓暗亮部光會一起暗，套黑白光也變黑白，不會有暗處發光
     · 調色時不必重算發光，只重跑顏色那一段
   編輯、創意拼圖、多頁拼圖共用這一份定義。 */
import { FX_DEFS } from './glEffects';

export const GLOW_FX_IDS = ['fxExposureSpill', 'fxY2k', 'fxAnamorphic'];
export const GLOW_PARAM_KEYS = ['soft', 'softThreshold', 'softRadius', 'softColor', 'fringeIntensity', 'fringeSize', 'fringeFeather', 'fringeHue',
  ...GLOW_FX_IDS.flatMap(id => [id, ...(FX_DEFS.find(d => d.id === id)?.params.map(q => q.id) || [])])];
export const hasGlow = (p: any) => !!p && (p.soft > 0 || p.fringeIntensity > 0 || GLOW_FX_IDS.some(id => (p[id] || 0) > 0));
/** 發光那一份的身分：只有這些參數變了才要重算光 */
export const glowSig = (p: any) => hasGlow(p) ? JSON.stringify(GLOW_PARAM_KEYS.map(k => p[k] ?? null)) : '';
/** 顏色之後那一段要套的參數：發光類已經在原圖上算過了，這裡不能再算一次 */
export const stripGlow = <T extends Record<string, any>>(p: T): T =>
  hasGlow(p) ? ({ ...p, soft: 0, fringeIntensity: 0, ...Object.fromEntries(GLOW_FX_IDS.map(id => [id, 0])) }) : p;
/** 只留發光類的參數（沒有的鍵就不放，交給各自的預設值） */
export const pickGlow = (p: Record<string, any>): Record<string, any> =>
  Object.fromEntries(GLOW_PARAM_KEYS.filter(k => p[k] !== undefined).map(k => [k, p[k]]));
