import { paintGlow } from './glowSprite';
import { textReady } from './stableText';
/* 文字的陰影與背景（創意拼圖、跨頁拼圖的預覽與匯出共用同一支）。
   數值都跟字級等比：字放大縮小，陰影、背景跟著一起縮放。
   陰影：強度 0～100（0＝沒有陰影）、模糊 0～100、距離 0～100、角度 0～360°（0°＝往右，順時針）。
   背景：開／關、顏色；圓角色塊包住每一行字。 */
export type TextDeco = {
  shadowAmt?: number; shadowColor?: string; shadowBlur?: number; shadowDist?: number; shadowAngle?: number;
  bgOn?: boolean; bgColor?: string; bgAlpha?: number;
  underline?: boolean;
  /** 字卡用的進階效果：外描邊（第二圈）、漸層（下半部的顏色）、立體厚度、上下裝飾線 */
  stroke2Width?: number; stroke2Color?: string; color2?: string;
  depth?: number; depthColor?: string; deco?: 'none' | 'lines';
  strokeWidth?: number; color?: string;
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
  // 文字背景功能已移除（舊作品裡留著的設定也不畫）
  if (o || !o) return;
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
      if (chars.length) lines.push([x + size * .6, top, x + size * .6, top + len]);
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
      lines.push([x0, y + size * .6, x0 + widths[i], y + size * .6]);
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
    const rf = !stroke && (ctx as any).__runFill;
    if (rf) { ctx.fillStyle = rf(r.y); ctx.fillText(r.t, r.x, r.y); continue; }
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
export const paintTextShadow = (ctx: CanvasRenderingContext2D, o: TextDeco, size: number,
  drawFill: (g: CanvasRenderingContext2D) => void, box: { w: number; h: number }, key: string | null = null) => {
  const amt = Math.max(0, Math.min(100, o.shadowAmt || 0)) / 100;
  if (amt <= 0) return;
  const m = ctx.getTransform(), k = Math.hypot(m.a, m.b) || 1;
  const dist = (o.shadowDist ?? TEXT_SHADOW_DEFAULTS.shadowDist) / 100 * size * .3 * k;
  const ang = (o.shadowAngle ?? TEXT_SHADOW_DEFAULTS.shadowAngle) * Math.PI / 180;
  const blur = (o.shadowBlur ?? TEXT_SHADOW_DEFAULTS.shadowBlur) / 100 * size * .45 * k;
  /* 位移是螢幕方向（不跟著字旋轉，跟以前一樣）：換成目前座標系裡的向量 */
  const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist;
  const det = m.a * m.d - m.b * m.c || 1;
  const lx = (m.d * dx - m.c * dy) / det, ly = (-m.b * dx + m.a * dy) / det;
  ctx.save();
  ctx.translate(lx, ly);
  const bw = box.w * .75, bh = box.h * .75;
  /* 影子跟發光一樣畫成平滑的光暈圖再貼回來（見 utils/glowSprite）：放大不會有像素感、縮放不會抖。
     沒有模糊（0）的影子就照舊直接畫，邊緣才會是銳利的。 */
  if (blur > .5) paintGlow(ctx, { x: -bw, y: -bh, w: bw * 2, h: bh * 2 }, [blur],
    rgba(o.shadowColor || TEXT_SHADOW_DEFAULTS.shadowColor, amt), drawFill,
    key === null ? null : `shadow|${key}|${o.shadowBlur ?? ''}`);
  else {
    ctx.shadowColor = rgba(o.shadowColor || TEXT_SHADOW_DEFAULTS.shadowColor, amt);
    ctx.shadowBlur = blur;
    const far = 100000;
    ctx.shadowOffsetX = far * m.a; ctx.shadowOffsetY = far * m.b;
    ctx.translate(-far, 0);
    drawFill(ctx);
  }
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

/** 逐字動畫（果凍ll、淡入ll 這類一個字一個字動的）：照段落排版拆成一個一個字，
    每個字交給 anim 在自己的中心做動畫。index／count 是第幾個字／總共幾個字（決定先後）。 */
export const drawTextRunsAnimated = (ctx: CanvasRenderingContext2D, L: TextLayout, stroke: boolean, size: number, spacing: number,
  anim: (paint: (g: CanvasRenderingContext2D) => void, index: number, count: number, w: number, h: number) => void) => {
  type U = { ch: string; cx: number; y: number; w: number };
  const units: U[] = [];
  const prevAlign = ctx.textAlign, prevLs = (ctx as any).letterSpacing;
  for (const r of L.runs) {
    if (!r.t) continue;
    if (L.vertical) { const w = ctx.measureText(r.t).width; units.push({ ch: r.t, cx: r.x, y: r.y, w: Math.max(1, w) }); continue; }
    const chars = Array.from(r.t);
    const rowW = Math.max(0, ctx.measureText(r.t).width - spacing);
    let left = r.align === 'left' ? r.x : r.align === 'right' ? r.x - spacing - rowW : r.x - spacing / 2 - rowW / 2;
    let acc = '';
    for (const ch of chars) {
      const x0 = left + (acc ? ctx.measureText(acc).width : 0);
      const cw = Math.max(1, ctx.measureText(ch).width - spacing);
      units.push({ ch, cx: x0 + cw / 2, y: r.y, w: cw });
      acc += ch;
    }
  }
  ctx.textAlign = 'center'; (ctx as any).letterSpacing = '0px';
  units.forEach((u, i) => {
    textReady(ctx.font, u.ch);
    ctx.save();
    ctx.translate(u.cx, u.y);
    anim(g => { g.textAlign = 'center'; if (stroke) g.strokeText(u.ch, 0, 0); else g.fillText(u.ch, 0, 0); }, i, units.length, u.w, size);
    ctx.restore();
  });
  ctx.textAlign = prevAlign; (ctx as any).letterSpacing = prevLs;
};

/* ── 字卡效果 ───────────────────────────────────────────────────────────── */
/** 填色：有 color2 就是上→下的漸層（以這一行字的高度為範圍），否則就是單色 */
export const textFillStyle = (ctx: CanvasRenderingContext2D, o: TextDeco, size: number, y = 0): string | CanvasGradient => {
  // 漸層已移除：一律單色（舊作品留著的 color2 也不畫）
  if (o || !o) return o.color || '#FFFFFF';
  const g = ctx.createLinearGradient(0, y - size * .5, 0, y + size * .5);
  g.addColorStop(0, o.color || '#FFFFFF'); g.addColorStop(1, o.color2);
  return g;
};
/** 多行／排過版的漸層：每一行各自從上到下（drawTextRuns 會看這個） */
export const setRunGradient = (ctx: CanvasRenderingContext2D, o: TextDeco, size: number) => {
  (ctx as any).__runFill = null; void o; void size;
};
/** 外描邊：在第一圈描邊外面再包一圈（寬度＝兩圈加起來），畫在最底下 */
export const paintOuterStroke = (ctx: CanvasRenderingContext2D, o: TextDeco, unit: number, drawStroke: () => void) => {
  // 這個效果已移除（舊作品裡留著的設定也不畫）
  if (o || !o) return;
  const w2 = Math.max(0, o.stroke2Width || 0);
  if (w2 <= 0) return;
  ctx.save();
  ctx.lineJoin = 'round'; ctx.miterLimit = 2;
  ctx.strokeStyle = o.stroke2Color || '#000000';
  ctx.lineWidth = ((o.strokeWidth || 0) + w2) * 2 * unit;
  drawStroke();
  ctx.restore();
};
/** 立體厚度：同一個字形（含描邊外框）往右下一層一層疊，厚度跟字級等比。depth 0～100 */
export const paintTextDepth = (ctx: CanvasRenderingContext2D, o: TextDeco, size: number, unit: number, drawFill: () => void, drawStroke: () => void) => {
  // 這個效果已移除（舊作品裡留著的設定也不畫）
  if (o || !o) return;
  const d = Math.max(0, Math.min(100, o.depth || 0));
  if (d <= 0) return;
  const len = d / 100 * size * .14;
  const m = ctx.getTransform(), k = Math.hypot(m.a, m.b) || 1;
  const steps = Math.max(1, Math.min(48, Math.ceil(len * k / 1.2)));
  const outline = ((o.strokeWidth || 0) + (o.stroke2Width || 0)) * 2 * unit;
  ctx.save();
  ctx.fillStyle = o.depthColor || '#000000'; ctx.strokeStyle = o.depthColor || '#000000';
  ctx.lineJoin = 'round'; ctx.lineWidth = outline;
  for (let i = steps; i >= 1; i--) {
    const t = len * i / steps;
    ctx.save(); ctx.translate(t * .72, t);
    if (outline > 0) drawStroke(); drawFill();
    ctx.restore();
  }
  ctx.restore();
};
/** 上下裝飾線（電影片名、品牌字常見）：比字寬一點的兩條細線 */
export const paintDecoLines = (ctx: CanvasRenderingContext2D, o: TextDeco, w: number, h: number, size: number) => {
  // 這個效果已移除（舊作品裡留著的設定也不畫）
  if (o || !o) return;
  if (o.deco !== 'lines') return;
  const t = Math.max(.5, size * .035), half = w / 2 + size * .3, gap = size * .32;
  ctx.save(); ctx.shadowColor = 'transparent';
  ctx.fillStyle = o.color2 || o.color || '#FFFFFF';
  ctx.fillRect(-half, -h / 2 - gap - t, half * 2, t);
  ctx.fillRect(-half, h / 2 + gap, half * 2, t);
  ctx.restore();
};
/** 字卡效果會多佔的空間（選中框要包住）：立體往右下、裝飾線往上下 */
export const textEffectPad = (o: TextDeco, size: number) => {
  // 立體、裝飾線已移除：不再多佔空間
  if (o || !o) return { w: 0, h: 0 * size };
  const d = Math.max(0, Math.min(100, o.depth || 0)) / 100 * size * .14;
  return { w: d * .72, h: d + (o.deco === 'lines' ? (size * .32 + size * .035) * 2 : 0) };
};
