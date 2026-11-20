import { textReady } from './stableText';
/* 文字的陰影與背景（創意拼圖、跨頁拼圖的預覽與匯出共用同一支）。
   數值都跟字級等比：字放大縮小，陰影、背景跟著一起縮放。
   陰影：強度 0～100（0＝沒有陰影）、模糊 0～100、距離 0～100、角度 0～360°（0°＝往右，順時針）。
   背景：開／關、顏色；圓角色塊包住每一行字。 */
export type TextDeco = {
  shadowAmt?: number; shadowColor?: string; shadowBlur?: number; shadowDist?: number; shadowAngle?: number;
  bgOn?: boolean; bgColor?: string; bgAlpha?: number;
  underline?: boolean;
  /** 排列：橫排的左／中／右對齊；直排（由右往左一行一行、每行由上往下）的上／中／下對齊 */
  textAlign?: 'left' | 'center' | 'right'; vertical?: boolean; vAlign?: 'top' | 'center' | 'bottom';
};
export const TEXT_SHADOW_DEFAULTS = { shadowColor: '#000000', shadowBlur: 30, shadowDist: 25, shadowAngle: 45 };
export const TEXT_BG_DEFAULT = '#000000';
const rgba = (hex: string, a: number) => {
  const h = hex.replace('#', ''), f = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
  const n = parseInt(f, 16) || 0;
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
};
/** 背景：剛好填滿選中框（直角、不超出框）。box＝目前座標下框的寬高，框心在 (0,0)。
    bgAlpha 0～100（沒設過＝100）。 */
export const paintTextBg = (ctx: CanvasRenderingContext2D, o: TextDeco, boxW: number, boxH: number) => {
  if (!o.bgOn) return;
  const a = Math.max(0, Math.min(100, o.bgAlpha ?? 100)) / 100;
  if (a <= 0) return;
  ctx.save();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
  ctx.globalAlpha *= a;
  ctx.fillStyle = o.bgColor || TEXT_BG_DEFAULT;
  ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
  ctx.restore();
};
/* ── 排列 ───────────────────────────────────────────────────────────────
   把文字拆成一段一段（橫排＝一行一段；直排＝一個字一段），每段各自有位置與對齊方式。
   描邊、發光、陰影、填色都照同一份段落畫，所以樣式疊起來位置一定對得上。
   量寬度時用目前 ctx 的字型與字距（measureText 會把最後一個字後面的字距也算進去，扣掉）。 */
export type TextRun = { t: string; x: number; y: number; align: CanvasTextAlign };
export type TextLayout = { runs: TextRun[]; w: number; h: number; vertical: boolean;
  /** 底線（直排是每一行右側的側線）：[x0, y0, x1, y1]，中心線座標 */
  lines: [number, number, number, number][] };
export const layoutText = (ctx: CanvasRenderingContext2D, o: TextDeco, text: string, size: number, lineH: number, spacing: number): TextLayout => {
  const rows = text.split('\n');
  if (o.vertical) {
    const pitch = size + spacing;
    const cols = rows.map(r => Array.from(r));
    const lens = cols.map(c => Math.max(0, c.length * pitch - spacing));
    const maxLen = Math.max(size, ...lens), n = cols.length;
    const runs: TextRun[] = [], lines: TextLayout['lines'] = [];
    cols.forEach((chars, i) => {
      const x = (n - 1) / 2 * lineH - i * lineH;
      const len = lens[i];
      const top = o.vAlign === 'top' ? -maxLen / 2 : o.vAlign === 'bottom' ? maxLen / 2 - len : -len / 2;
      chars.forEach((ch, j) => runs.push({ t: ch, x, y: top + j * pitch + size / 2, align: 'center' }));
      if (chars.length) lines.push([x + size * .66, top, x + size * .66, top + len]);
    });
    return { runs, w: (n - 1) * lineH + size, h: maxLen, vertical: true, lines };
  }
  const widths = rows.map(r => r ? Math.max(0, ctx.measureText(r).width - spacing) : 0);
  const w = Math.max(...widths, 0), startY = -((rows.length - 1) * lineH) / 2;
  const al = o.textAlign || 'center';
  const runs: TextRun[] = [], lines: TextLayout['lines'] = [];
  rows.forEach((r, i) => {
    const y = startY + i * lineH;
    // canvas 在每個字後面都加字距：置中時補半個、靠右時補一整個，字才真的貼齊
    const x = al === 'left' ? -w / 2 : al === 'right' ? w / 2 + spacing : spacing / 2;
    runs.push({ t: r, x, y, align: al });
    if (r) {
      const x0 = al === 'left' ? -w / 2 : al === 'right' ? w / 2 - widths[i] : -widths[i] / 2;
      lines.push([x0, y + size * .68, x0 + widths[i], y + size * .68]);
    }
  });
  return { runs, w, h: (rows.length - 1) * lineH + size, vertical: false, lines };
};
/** 照段落畫字（stroke＝描邊）。直排逐字畫，暫時不加字距（字距已經算進位置裡） */
export const drawTextRuns = (ctx: CanvasRenderingContext2D, L: TextLayout, stroke: boolean, draw?: (t: string, x: number, y: number) => boolean) => {
  const prevAlign = ctx.textAlign, prevLs = (ctx as any).letterSpacing;
  if (L.vertical) (ctx as any).letterSpacing = '0px';
  for (const r of L.runs) {
    if (!r.t) continue;
    textReady(ctx.font, r.t);  // 這幾個字所在的字型分包還沒到的話先去載，到了會通知重畫
    ctx.textAlign = r.align;
    if (draw && draw(r.t, r.x, r.y)) continue;
    if (stroke) ctx.strokeText(r.t, r.x, r.y); else ctx.fillText(r.t, r.x, r.y);
  }
  ctx.textAlign = prevAlign;
  if (L.vertical) (ctx as any).letterSpacing = prevLs;
};
/** 底線：用目前的填色畫（跟字同色），粗細跟字級等比 */
export const drawUnderline = (ctx: CanvasRenderingContext2D, o: TextDeco, L: TextLayout, size: number) => {
  if (!o.underline) return;
  const t = Math.max(.4, size * .04);
  for (const [x0, y0, x1, y1] of L.lines) {
    if (x0 === x1) ctx.fillRect(x0 - t / 2, y0, t, y1 - y0); else ctx.fillRect(x0, y0 - t / 2, x1 - x0, t);
  }
};
/** 需要走「段落」畫法的文字（不是置中的單純橫排就要） */
export const needsTextLayout = (o: TextDeco, text: string) =>
  !!o.vertical || (o.textAlign && o.textAlign !== 'center') || !!o.underline || text.includes('\n');
/** 陰影：用填色的字形投一次影子（字本身之後會再正常畫在上面）。
    canvas 的陰影位移、模糊是螢幕像素，不吃變換矩陣，所以照目前矩陣的倍率換算；
    方向固定在畫面上（像同一盞燈），字旋轉時影子方向不跟著轉。 */
export const paintTextShadow = (ctx: CanvasRenderingContext2D, o: TextDeco, size: number, drawFill: () => void) => {
  const amt = Math.max(0, Math.min(100, o.shadowAmt || 0)) / 100;
  if (amt <= 0) return;
  const m = ctx.getTransform(), k = Math.hypot(m.a, m.b) || 1;
  const dist = (o.shadowDist ?? TEXT_SHADOW_DEFAULTS.shadowDist) / 100 * size * .3 * k;
  const ang = (o.shadowAngle ?? TEXT_SHADOW_DEFAULTS.shadowAngle) * Math.PI / 180;
  ctx.save();
  ctx.shadowColor = rgba(o.shadowColor || TEXT_SHADOW_DEFAULTS.shadowColor, amt);
  ctx.shadowBlur = (o.shadowBlur ?? TEXT_SHADOW_DEFAULTS.shadowBlur) / 100 * size * .45 * k;
  // 字本身畫在很遠的地方，只讓影子位移回來：影子不會被字的半透明邊緣蓋出一圈雜色
  const far = 100000;
  ctx.shadowOffsetX = Math.cos(ang) * dist + far * m.a; ctx.shadowOffsetY = Math.sin(ang) * dist + far * m.b;
  ctx.translate(-far, 0);
  drawFill();
  ctx.restore();
};

/** 字的墨水（真正畫出來的部分）上下置中要往上／往下移多少。
    textBaseline 'middle' 對齊的是字體的 em 方框中線，不是字的墨水：每一款字體的上下留白不一樣，
    換字體時字就在框裡忽上忽下。量出第一行墨水的頂、最後一行墨水的底，回傳讓兩者對稱的位移。 */
export const textInkShift = (ctx: CanvasRenderingContext2D, text: string, lineH: number) => {
  const rows = text.split('\n');
  const first = ctx.measureText(rows[0] || ' '), last = ctx.measureText(rows[rows.length - 1] || ' ');
  const startY = -((rows.length - 1) * lineH) / 2;
  const top = startY - (first.actualBoundingBoxAscent || 0), bottom = -startY + (last.actualBoundingBoxDescent || 0);
  const mid = (top + bottom) / 2;
  return Number.isFinite(mid) ? -mid : 0;
};
