/* 專業字卡：一組一組設計好的文字造型（綜藝、YouTube、Vlog、電影、廣告）。
   字卡只是「一組起始設定」：套用後字體、顏色、描邊、陰影…都還能在文字編輯頁繼續微調。
   描邊、外描邊的單位跟面板一樣（以 40px 字為基準的 px），立體厚度、陰影都是 0～100。 */
import { ensureFont, fontStack } from './fonts';
import { paintTextShadow, paintTextDepth, paintOuterStroke, paintDecoLines, textFillStyle, layoutText, drawUnderline, type TextDeco } from './textDeco';

export type TextCard = {
  id: string; name: string; group: string;
  /** 預覽要用什麼底色（深色字卡在淺底上才看得出來） */
  bg?: string;
  style: TextDeco & {
    fontFamily: string; bold?: boolean; italic?: boolean; letterSpacing?: number;
    strokeColor?: string; glow?: number; glowColor?: string;
  };
};

export const TEXT_CARD_GROUPS = ['綜藝', 'YouTube', 'Vlog', '電影', '廣告'];

const HEI = 'Noto Sans TC', SONG = 'Noto Serif TC', KAI = 'LXGW WenKai TC', ROUND = 'Zen Maru Gothic', POP = 'Huninn';

export const TEXT_CARDS: TextCard[] = [
  // ── 綜藝：厚實的雙層描邊＋立體厚度，顏色飽和
  { id: 'v-gold', name: '綜藝金黃', group: '綜藝', style: { fontFamily: HEI, bold: true, color: '#FFF27A', color2: '#FF9E1B', strokeWidth: 1.3, strokeColor: '#3B1C00', stroke2Width: 1.1, stroke2Color: '#FFFFFF', depth: 34, depthColor: '#3B1C00' } },
  { id: 'v-pink', name: '粉紅泡泡', group: '綜藝', style: { fontFamily: POP, bold: true, color: '#FFFFFF', strokeWidth: 1.2, strokeColor: '#FF4F9A', stroke2Width: 1, stroke2Color: '#FFFFFF', depth: 26, depthColor: '#B3125F' } },
  { id: 'v-red', name: '爆點紅', group: '綜藝', style: { fontFamily: HEI, bold: true, italic: true, color: '#FF5A4E', color2: '#B30012', strokeWidth: 1, strokeColor: '#FFFFFF', stroke2Width: 1.2, stroke2Color: '#1A0B0B', depth: 38, depthColor: '#1A0B0B' } },
  { id: 'v-blue', name: '吐槽藍', group: '綜藝', style: { fontFamily: ROUND, bold: true, color: '#FFFFFF', strokeWidth: 1.4, strokeColor: '#2F6BFF', depth: 22, depthColor: '#13308A' } },
  { id: 'v-green', name: '驚喜綠', group: '綜藝', style: { fontFamily: POP, bold: true, color: '#E9FF70', color2: '#4CD964', strokeWidth: 1.2, strokeColor: '#0D3B1E', stroke2Width: 1, stroke2Color: '#FFFFFF', depth: 28, depthColor: '#0D3B1E' } },
  // ── YouTube：高對比，縮圖遠看也清楚
  { id: 'y-title', name: '頻道標題', group: 'YouTube', style: { fontFamily: HEI, bold: true, color: '#FFFFFF', strokeWidth: 1.6, strokeColor: '#000000', shadowAmt: 70, shadowColor: '#000000', shadowBlur: 0, shadowDist: 38, shadowAngle: 45 } },
  { id: 'y-thumb', name: '縮圖黃', group: 'YouTube', style: { fontFamily: HEI, bold: true, color: '#FFE600', strokeWidth: 1.8, strokeColor: '#000000', depth: 42, depthColor: '#000000' } },
  { id: 'y-neon', name: '霓虹粉', group: 'YouTube', style: { fontFamily: HEI, color: '#FFFFFF', strokeWidth: .5, strokeColor: '#FF6BE6', glow: 12, glowColor: '#FF2BD6' } },
  { id: 'y-cyan', name: '電光藍', group: 'YouTube', style: { fontFamily: HEI, bold: true, italic: true, color: '#FFFFFF', color2: '#7FE7FF', strokeWidth: 1.2, strokeColor: '#002B5C', glow: 7, glowColor: '#00C2FF' } },
  // ── Vlog：輕、乾淨、有溫度
  { id: 'l-hand', name: '日常手寫', group: 'Vlog', style: { fontFamily: KAI, color: '#FFFFFF', shadowAmt: 38, shadowColor: '#000000', shadowBlur: 45, shadowDist: 10, shadowAngle: 90 } },
  { id: 'l-cream', name: '奶油圓字', group: 'Vlog', style: { fontFamily: ROUND, bold: true, color: '#FFF4E0', strokeWidth: 1, strokeColor: '#C08552', letterSpacing: 2 } },
  { id: 'l-note', name: '底線筆記', group: 'Vlog', style: { fontFamily: HEI, color: '#FFFFFF', underline: true, letterSpacing: 4, shadowAmt: 30, shadowColor: '#000000', shadowBlur: 40, shadowDist: 6, shadowAngle: 90 } },
  { id: 'l-film', name: '底片暖橘', group: 'Vlog', style: { fontFamily: SONG, color: '#FFB25B', letterSpacing: 6, glow: 3, glowColor: '#FF7A00' } },
  // ── 電影：留白、字距、金屬感
  { id: 'm-gold', name: '片名金', group: '電影', style: { fontFamily: SONG, bold: true, color: '#F6E7C1', color2: '#B48A46', letterSpacing: 12, deco: 'lines', shadowAmt: 45, shadowColor: '#000000', shadowBlur: 60, shadowDist: 0, shadowAngle: 90 } },
  { id: 'm-sub', name: '院線字幕', group: '電影', style: { fontFamily: HEI, color: '#FFFFFF', letterSpacing: 1, shadowAmt: 80, shadowColor: '#000000', shadowBlur: 22, shadowDist: 6, shadowAngle: 90 } },
  { id: 'm-cold', name: '冷調預告', group: '電影', style: { fontFamily: SONG, color: '#E6EEF7', letterSpacing: 18, glow: 4, glowColor: '#8EC3FF' } },
  { id: 'm-noir', name: '黑色電影', group: '電影', bg: '#E9E6E0', style: { fontFamily: SONG, bold: true, color: '#141414', letterSpacing: 10, deco: 'lines' } },
  // ── 廣告：品牌感、促銷感
  { id: 'a-brand', name: '品牌大字', group: '廣告', style: { fontFamily: HEI, bold: true, color: '#FFFFFF', letterSpacing: 8, deco: 'lines' } },
  { id: 'a-sale', name: '促銷紅金', group: '廣告', style: { fontFamily: HEI, bold: true, italic: true, color: '#FFE89A', color2: '#E8A400', strokeWidth: 1.2, strokeColor: '#7A0A0A', stroke2Width: 1, stroke2Color: '#FFFFFF', depth: 30, depthColor: '#4A0000' } },
  { id: 'a-luxe', name: '精品極簡', group: '廣告', bg: '#F2EFEA', style: { fontFamily: SONG, color: '#1C1C1C', letterSpacing: 14 } },
  { id: 'a-fresh', name: '清新薄荷', group: '廣告', style: { fontFamily: ROUND, bold: true, color: '#FFFFFF', color2: '#C9FFF0', strokeWidth: 1.1, strokeColor: '#0E8F78', depth: 18, depthColor: '#0A5C4E' } },
];

/** 套用字卡：先把字卡會用到的效果全部歸零，再套這張的設定（之前別的字卡留下的效果不會殘留） */
export const textCardPatch = (c: TextCard) => ({
  bold: false, italic: false, underline: false, letterSpacing: 0,
  color2: undefined, strokeWidth: 0, strokeColor: '#000000', stroke2Width: 0, stroke2Color: '#000000',
  glow: 0, glowColor: '#FFFFFF', shadowAmt: 0, depth: 0, depthColor: '#000000', deco: 'none' as const,
  ...c.style,
});

/** 畫一張字卡預覽（跟兩個拼圖用同一組效果函式，所以看到的就是套上去的樣子） */
export const paintTextCardPreview = (canvas: HTMLCanvasElement, c: TextCard, text: string) => {
  const dpr = Math.min(3, window.devicePixelRatio || 1), W = canvas.clientWidth || 100, H = canvas.clientHeight || 56;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const g = canvas.getContext('2d'); if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  if (c.bg) { g.fillStyle = c.bg; g.fillRect(0, 0, W, H); }
  const s = c.style, spacing = s.letterSpacing || 0;
  let size = 22;
  const font = (px: number) => `${s.italic ? 'italic ' : ''}${s.bold ? 700 : 400} ${px}px ${fontStack(s.fontFamily)}`;
  g.font = font(size); (g as any).letterSpacing = `${spacing * size / 40}px`;
  const tw = g.measureText(text).width;
  const room = W * .78 - (s.deco === 'lines' ? 10 : 0);
  if (tw > room) { size = Math.max(10, size * room / tw); g.font = font(size); (g as any).letterSpacing = `${spacing * size / 40}px`; }
  const unit = size / 40, sp = spacing * size / 40;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.translate(W / 2 - (s.depth ? size * .05 : 0), H / 2 - (s.depth ? size * .06 : 0));
  const L = layoutText(g, s, text, size, size * 1.12, sp);
  const fill = () => g.fillText(text, sp / 2, 0);
  const stroke = () => g.strokeText(text, sp / 2, 0);
  g.fillStyle = s.color || '#fff';
  paintTextShadow(g, s, size, fill);
  paintTextDepth(g, s, size, unit, fill, stroke);
  paintOuterStroke(g, s, unit, stroke);
  if (s.glow) {
    g.save(); g.shadowColor = s.glowColor || '#fff'; g.fillStyle = s.color || '#fff';
    for (const k of [1, 2, 3]) { g.shadowBlur = (Math.min(15, s.glow) / 20) * 14 * k * unit * dpr; fill(); }
    g.restore();
  }
  if (s.strokeWidth) { g.save(); g.lineJoin = 'round'; g.strokeStyle = s.strokeColor || '#000'; g.lineWidth = s.strokeWidth * 2 * unit; stroke(); g.restore(); }
  g.fillStyle = textFillStyle(g, s, size); fill();
  g.fillStyle = s.color || '#fff';
  drawUnderline(g, s, L, size);
  paintDecoLines(g, s, L.w, L.h, size);
};
/** 字卡用到的字型先載好（含預覽那幾個字），好了再畫 */
export const loadTextCardFont = (c: TextCard, text: string) =>
  ensureFont(c.style.fontFamily).then(() => (document as any).fonts?.load?.(`${c.style.italic ? 'italic ' : ''}${c.style.bold ? 700 : 400} 22px "${c.style.fontFamily}"`, text)).catch(() => {});
