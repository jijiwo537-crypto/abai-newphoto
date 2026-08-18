/**
 * 「圖案」的畫法：路徑、字符、去背圖，全部收在這裡。
 *
 * 這一份原本長在創意拼圖裡面。經典拼圖要能用同一批圖形（那 16 顆從圖案借過來
 * 的），就不能再各畫各的 —— 兩邊都吃這一支，形狀、抗鋸齒、上色方式、
 * 墨水置中的校正才不可能有差。
 *
 * 這裡只做「畫」這件事：沒有 React、沒有任何工具自己的狀態。
 */
import { SHAPE_IMAGES } from './shapeImages';

export const getHoleNumber = (h: any) => {
  if (h && h.randomNumber !== undefined) return h.randomNumber;
  const hash = h && h.id ? h.id.split('').reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0) : 0;
  return hash % 10;
};

/**
 * 用文字畫出來的洞：id → 實際要畫的那個字。
 * 'love'（<3）、'text'（使用者自己打的字）、'random-num'（編號）不是固定的字，
 * 所以不放在這張表裡，由 holeGlyph() 另外處理。
 */

export const GLYPH_HOLES: Record<string, string> = {
  flower:   '❋',   // ❋ 原本就有
  snow:     '\u2744\uFE0E',   // ❄︎ 雪花（後面那個字是「用文字樣式畫」，不要變成彩色 emoji）
  vortex:   '🌀',   // 🌀 原本就有
  seagrass: '𓇼',   // 𓇼 海草
  darkstar: '𖤐',   // 𖤐 暗星
  sparkle:  '⊹',   // ⊹ 小閃
  aster:    '᯽',   // ᯽ 星花
  theta:    '𝝑𝝔',  // 𝝑𝝔
  yaya:     'ॽ͙ॽ͙ॽ͙',  // ॽ͙ॽ͙ॽ͙
  zzz:      '☡zᶻ',  // ☡zᶻ
};

/** 這個洞是用文字畫的（而不是用路徑畫的）嗎 */

export const GLYPH_BTN: Record<string, { size?: number; dx?: number; dy?: number }> = {
  flower:   { size: 19.8 },                     // 18 × 1.1
  snow:     { size: 21.6 },                     // 18 × 1.2
  seagrass: { dx: 0.3, dy: -0.7 },
  darkstar: { size: 19.8, dx: 0.1 },            // 18 × 1.1
  // ⊹ 的字身在字框裡本來就偏小，放大 1.5 倍（18 → 27）才看得清楚
  sparkle:  { size: 27 },
  // 下面這幾顆是多個字組成的，照 18px 畫會撐出格子
  theta:    { size: 15, dx: 0.2, dy: -0.3 },
  yaya:     { size: 13, dx: 0.5, dy: -1 },
  zzz:      { size: 13, dx: 0.3 },
};

/* ── 用圖片當形狀的圖案 ─────────────────────────────────────────────
   有些圖案打不出來（字型裡根本沒有那個字），所以改成用去背的 PNG。
   圖裡**只有形狀**（RGB 全塗黑、只留 alpha）—— 真正畫出來的顏色跟其他圖案
   一樣，是由拼圖的遮罩／顏色決定的，跟原圖是什麼顏色完全無關。
   它走的是跟文字圖案完全同一條管線（量墨水 → 畫進暫存畫布 → source-in 上色），
   所以選取框、命中判定、發光、匯出全部自動比照辦理。 */
const holeImgCache = new Map<string, HTMLImageElement>();
export const getHoleImg = (t: string): HTMLImageElement | null => {
  const src = SHAPE_IMAGES[t];
  if (!src) return null;
  let im = holeImgCache.get(t);
  if (!im) {
    im = new Image();
    im.decoding = 'async';
    im.src = src;
    holeImgCache.set(t, im);
  }
  return im;
};
export const isImageHole = (t: string) => !!SHAPE_IMAGES[t];
/** 圖片形狀的長寬比（寬 / 高）。還沒解碼完先給個合理值，解碼完自然會校正。 */
export const holeImgRatio = (t: string) => {
  const im = getHoleImg(t);
  return im && im.naturalWidth && im.naturalHeight ? im.naturalWidth / im.naturalHeight : 1.476;
};

/** 這個洞是用文字或圖片畫的（而不是用路徑畫的）嗎 */
export const isTextHole = (t: string) => t === 'text' || t === 'love' || t === 'love3' || t === 'random-num'
  || t in GLYPH_HOLES || isImageHole(t);

/** 這個洞實際上要畫出來的字串 */
export const holeGlyph = (holeType: string, customText: string, h?: any) =>
  GLYPH_HOLES[holeType]
  ?? (holeType === 'love' ? '<3'
    : holeType === 'love3' ? '<333'
    : holeType === 'random-num' ? `(${getHoleNumber(h)})`
    : customText);

/** 字符圖案要用的字型 —— 畫、量、選取框、命中判定全部共用這一支，
 *  不然「畫的是這支字型、量的是另一支」，框跟圖案就對不起來。 */
export const glyphFont = (holeType: string, sz: number) =>
  (holeType === 'love' || holeType === 'love3')
    ? `bold ${sz * 1.05}px "Inter", "Segoe UI", sans-serif`
    : `500 ${sz}px "Inter", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;

/* ── 字符圖案「看得見的那一塊」 ───────────────────────────────────────
   textAlign:'center' 對的是**前進寬度**、textBaseline:'middle' 對的是
   **em 方框**，兩個都不是墨水。一般的字差不多，但像 ᯽、𓇼、𖤐 這些冷門的
   Unicode 字，退回系統字型之後左右留白常常差很多 —— 畫出來就整個偏到一邊，
   而選取框與命中判定都是以中心點、以前進寬度算的，於是框框不到它、
   也很難點到（主人說的「倒數第二個圖案嚴重偏右」）。

   上一版是用 measureText 的 actualBoundingBox* 來校正。那是「字型宣告的」
   墨水框 —— 在有些系統字型（尤其是後備字型接手的冷門字、彩色 emoji）上
   根本對不上真正畫出來的東西，所以主人的手機上還是偏。

   這一版改成**直接畫一次、掃一次 alpha**：畫出來的像素不會騙人。
   量出來的框拿來做三件事，三邊完全一致，框就一定框得到它：
     ① 畫的時候把墨水中心平移到圖案的中心（＝框的中心，框本身不動）
     ② 選取框的大小
     ③ 點擊命中的範圍
   一種字只量一次（字級 100，其他尺寸等比換算），成本可以忽略。 */
const GLYPH_INK_REF = 100;
/** 探測畫布的半徑：字級 100 的字放進 400×400 綽綽有餘；不夠就換 1600×1600 */
const GLYPH_PROBES = [200, 800];
export type GlyphBox = { ox: number; oy: number; w: number; h: number; r: number; ok: boolean };
const glyphBoxCache = new Map<string, GlyphBox>();
/** 量字專用的小畫布（只量不畫，不會被任何人看到） */
let glyphMeasCtx: CanvasRenderingContext2D | null = null;
const measureCtx = () => {
  if (!glyphMeasCtx) {
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    glyphMeasCtx = c.getContext('2d');
  }
  return glyphMeasCtx!;
};
export const glyphBox = (holeType: string, str: string): GlyphBox => {
  /* 圖片形狀不用探測：圖本身已經裁到墨水的外框了。
     長邊當成「大小」、短邊照長寬比換算 —— 跟圓形／方形的 size 定義一致。 */
  if (isImageHole(holeType)) {
    const ar = holeImgRatio(holeType);
    const w = ar >= 1 ? GLYPH_INK_REF : GLYPH_INK_REF * ar;
    const h = ar >= 1 ? GLYPH_INK_REF / ar : GLYPH_INK_REF;
    return { ox: 0, oy: 0, w, h, r: Math.hypot(w, h) / 2, ok: true };
  }
  const key = holeType + '|' + str;
  const hit = glyphBoxCache.get(key);
  if (hit) return hit;

  // ① 先用 measureText 粗抓一個偏移，讓待會兒畫下去的時候不會超出探測畫布
  let ox = 0, oy = 0, w = GLYPH_INK_REF, h = GLYPH_INK_REF, ok = false;
  try {
    const g0 = measureCtx();
    g0.font = glyphFont(holeType, GLYPH_INK_REF);
    g0.textAlign = 'center';
    g0.textBaseline = 'middle';
    const m = g0.measureText(str);
    const L = m.actualBoundingBoxLeft, R = m.actualBoundingBoxRight;
    const A = m.actualBoundingBoxAscent, D = m.actualBoundingBoxDescent;
    if ([L, R, A, D].every(v => typeof v === 'number' && isFinite(v)) && L + R > 0.5 && A + D > 0.5) {
      ox = -(R - L) / 2; oy = -(D - A) / 2; w = L + R; h = A + D; ok = true;
    } else if (m.width > 0.5) {
      w = m.width;
    }
  } catch { /* 量不到就當作沒有偏移，下面那一步才是真正的準頭 */ }

  /* ② 真的畫一次，用畫出來的像素把中心與大小訂死。
     探測畫布先用小的；如果墨水碰到邊（代表字比畫布大，或者上面那個粗估
     根本不準、整個字被推到邊上去了），就換一張大的再量一次。
     兩次都碰到邊才放棄 —— 那通常是很長的自訂文字，維持原本的畫法。 */
  let r = 0;
  for (const P of GLYPH_PROBES) {
    try {
      const S = P * 2;
      const c = document.createElement('canvas');
      c.width = c.height = S;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.fillStyle = '#000000';
      g.font = glyphFont(holeType, GLYPH_INK_REF);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(str, P + ox, P + oy);
      const d = g.getImageData(0, 0, S, S).data;
      let x0 = S, y0 = S, x1 = -1, y1 = -1;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          if (d[(y * S + x) * 4 + 3] !== 0) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 >= 0 && x0 > 0 && y0 > 0 && x1 < S - 1 && y1 < S - 1) {
        ox += P - (x0 + x1 + 1) / 2;
        oy += P - (y0 + y1 + 1) / 2;
        w = x1 - x0 + 1;
        h = y1 - y0 + 1;
        r = Math.hypot(w, h) / 2;   // 置中之後，任何角度轉過去都還在這個半徑內
        ok = true;
        break;
      }
      if (x1 < 0) break;           // 整張都是空的：這個字在這台裝置上畫不出來
    } catch { break; /* 讀不到像素（極少見）就用上面那組 */ }
  }

  const box: GlyphBox = { ox, oy, w, h, r, ok };
  glyphBoxCache.set(key, box);
  return box;
};
/** 換算到指定字級 */
export const glyphInk = (holeType: string, str: string, sz: number) => {
  const b = glyphBox(holeType, str);
  const k = sz / GLYPH_INK_REF;
  return { w: b.w * k, h: b.h * k, ox: b.ox * k, oy: b.oy * k, r: b.r * k, ok: b.ok };
};


/* 字符圖案的暫存畫布池。以前每畫一顆就開一張新的 —— 一格畫面裡幾十顆、
   左右兩側都要畫，實測拖一顆字符圖案時每秒開 398 張畫布。
   同一顆圖案每一格用的尺寸都一樣，所以照「邊長」收在池子裡就幾乎都命中。
   刻意做成「尺寸剛好」而不是共用一張大的：大小一樣、drawImage 也用原本
   那個三參數的寫法，畫出來才跟以前一個位元都不差。
   匯出那種特別大的尺寸不入池，免得一直佔著幾十 MB。 */
const TEXT_TMP_MAX = 1024;
const TEXT_TMP_KEEP = 48;
const textTmpPool = new Map<number, HTMLCanvasElement>();

export const drawTextShape = (
  targetCtx: CanvasRenderingContext2D,
  holeType: string,
  text: string,
  cx: number,
  cy: number,
  sz: number,
  fillStyle: any,
  isDestinationOut: boolean = false,
  holeAngle: number = 0
) => {
  const str = holeType === 'love' ? '<3'
    : holeType === 'love3' ? '<333'
    : (GLYPH_HOLES[holeType] ?? text);
  const ink = glyphInk(holeType, str, sz);
  /* 暫存畫布只要「這個字轉一圈都還在裡面」就夠了。以前一律開 sz×3 見方，
     像 ᯽ 這種字有九成面積是空的，卻每一顆、每一格都要被 drawImage 合成一次
     （實測合成佔掉拖曳字符圖案時將近三成的時間）。
     半徑用 glyphRadius 實際量出來的，而且只縮不放（跟舊的取小的那個）——
     所以畫出來跟以前一個像素都不差，連原本會被裁掉的長文字也照樣裁在同一個地方。 */
  const oldPad = Math.ceil(sz * 1.5);
  const pad = ink.r > 0.5
    ? Math.max(2, Math.min(oldPad, Math.ceil(ink.r) + 2))
    : oldPad;
  const side = Math.max(2, pad * 2);
  let tempCanvas: HTMLCanvasElement | undefined;
  let reused = false;
  if (side <= TEXT_TMP_MAX) {
    tempCanvas = textTmpPool.get(side);
    if (tempCanvas) reused = true;
    else {
      tempCanvas = document.createElement('canvas');
      tempCanvas.width = side; tempCanvas.height = side;
      textTmpPool.set(side, tempCanvas);
      while (textTmpPool.size > TEXT_TMP_KEEP) {
        const oldest = textTmpPool.keys().next().value as number | undefined;
        if (oldest === undefined) break;
        textTmpPool.delete(oldest);
      }
    }
  } else {
    tempCanvas = document.createElement('canvas');
    tempCanvas.width = side; tempCanvas.height = side;
  }
  const tempCtx = tempCanvas.getContext('2d')!;
  if (reused) {
    /* 剛開的畫布狀態本來就是乾淨的；重複用的就得自己收乾淨。 */
    tempCtx.setTransform(1, 0, 0, 1, 0, 0);
    tempCtx.globalAlpha = 1;
    tempCtx.globalCompositeOperation = 'source-over';
    tempCtx.clearRect(0, 0, side, side);
  }

  // 1. 在 tempCanvas 上畫純黑色的文字形狀
  tempCtx.fillStyle = '#000000';
  tempCtx.save();
  tempCtx.translate(pad, pad);
  tempCtx.rotate(holeAngle * Math.PI / 180);
  /* 把字真正的「墨水」對到中心 —— 說明見上面 glyphInk。
     選取框與命中判定用的是同一支 glyphInk，所以框一定框得到它。 */
  const o = ink;
  tempCtx.font = glyphFont(holeType, sz);
  tempCtx.textAlign = 'center';
  tempCtx.textBaseline = 'middle';
  if (isImageHole(holeType)) {
    /* 圖片形狀：把去背的圖貼上去。貼的是**形狀**，
       顏色下一步才由 source-in 決定，所以原圖是什麼顏色都無所謂。 */
    const im = getHoleImg(holeType);
    if (im && im.complete && im.naturalWidth) {
      tempCtx.drawImage(im, -ink.w / 2, -ink.h / 2, ink.w, ink.h);
    }
  } else {
    tempCtx.fillText(str, o.ox, o.oy);
  }
  tempCtx.restore();

  // 2. 如果是填充照片或顏色
  if (!isDestinationOut && fillStyle) {
    tempCtx.save();
    tempCtx.globalCompositeOperation = 'source-in';
    tempCtx.fillStyle = fillStyle;
    tempCtx.translate(pad - cx, pad - cy);
    tempCtx.fillRect(cx - pad, cy - pad, side, side);
    tempCtx.restore();
  }

  // 3. 繪製到 targetCtx
  targetCtx.save();
  if (isDestinationOut) {
    targetCtx.globalCompositeOperation = 'destination-out';
  }
  targetCtx.drawImage(tempCanvas, cx - pad, cy - pad);
  targetCtx.restore();
};

export const drawShapePath = (ctx: CanvasRenderingContext2D, type: string, cx: number, cy: number, size: number) => {
  ctx.beginPath();
  const r = size / 2;
  switch (type) {
    case 'circle': ctx.arc(cx, cy, r, 0, Math.PI * 2); break;
    case 'square': ctx.rect(cx - r, cy - r, size, size); break;
    case 'heart':
      ctx.moveTo(cx, cy - r * 0.25);
      ctx.bezierCurveTo(cx + r * 0.6, cy - r * 1.0, cx + r * 1.3, cy - r * 0.1, cx, cy + r * 0.9);
      ctx.bezierCurveTo(cx - r * 1.3, cy - r * 0.1, cx - r * 0.6, cy - r * 1.0, cx, cy - r * 0.25);
      break;
    case 'star':
      const spikes = 5;
      const step = Math.PI / spikes;
      let rot = (Math.PI / 2) * 3;
      ctx.moveTo(cx, cy - r);
      for (let i = 0; i < spikes; i++) {
        ctx.lineTo(cx + Math.cos(rot) * r, cy + Math.sin(rot) * r); 
        rot += step;
        ctx.lineTo(cx + Math.cos(rot) * (r / 2.2), cy + Math.sin(rot) * (r / 2.2)); 
        rot += step;
      }
      break;
    case 'cross-star':
      const stepCross = Math.PI / 4;
      let rotCross = (Math.PI / 2) * 3;
      ctx.moveTo(cx, cy - r);
      for (let i = 0; i < 4; i++) {
        ctx.lineTo(cx + Math.cos(rotCross) * r, cy + Math.sin(rotCross) * r); 
        rotCross += stepCross;
        ctx.lineTo(cx + Math.cos(rotCross) * (r * 0.25), cy + Math.sin(rotCross) * (r * 0.25)); 
        rotCross += stepCross;
      }
      break;
    default: ctx.rect(cx - r, cy - r, size, size);
  }
  ctx.closePath();
};

/* ── 圖形上的「點點」 ────────────────────────────────────────────────
   兩個拼圖工具、預覽與匯出都吃這一支，密度與大小才不可能有差。
     dsz  = (5 + 大小/100 × 15) × 單位
     dgap = (40 + 間距) × 單位            單位 = 長邊 / 600
   網格是交錯的三角格：偶數列不位移、奇數列往右半格，列距 = 間距 × √3/2。 */
export const dotGridOf = (unitW: number, unitH: number, size = 50, gap = 20) => {
  const unit = Math.max(unitW, unitH) / 600;
  const dsz = (5 + (size / 100) * 15) * unit;
  const dgap = (40 + gap) * unit;
  return { r: dsz / 2, dx: dgap, dy: dgap * Math.sqrt(3) / 2 };
};

/**
 * 把點點鋪滿一塊區域（原點在**中心**）。呼叫端負責先剪裁在圖形裡面。
 * unitW/unitH 決定點點的大小與間距（＝圖形本身的框），covW/covH 決定要鋪
 * 多大一塊 —— 字符類會畫在比框更大的暫存畫布上，兩個才要分開給。
 */
export const paintDots = (
  c: CanvasRenderingContext2D,
  unitW: number, unitH: number, covW: number, covH: number,
  size = 50, gap = 20, color = '#FFFFFF',
) => {
  const { r, dx, dy } = dotGridOf(unitW, unitH, size, gap);
  c.fillStyle = color;
  const rx = Math.ceil(covW / dx) + 2, ry = Math.ceil(covH / dy) + 2;
  for (let j = -ry; j <= ry; j++) {
    const shiftX = Math.abs(j) % 2 === 1 ? dx / 2 : 0;
    for (let i = -rx; i <= rx; i++) {
      c.beginPath();
      c.arc(i * dx + shiftX, j * dy, r, 0, Math.PI * 2);
      c.fill();
    }
  }
};

/**
 * 畫一顆「從圖案借過來的圖形」。原點是圖形的**中心**。
 *
 * 兩個拼圖工具都呼叫這一支，所以形狀、發光、描邊、點點、上色方式一定一樣。
 * 字符／去背圖那幾種沒有路徑可以剪裁，點點改成畫在暫存畫布上再用
 * source-atop 蓋上去 —— 只有原本有墨水的地方會留下點點，結果跟路徑剪裁一樣。
 *
 * blurs 是發光的三段模糊半徑，由呼叫端給（兩個工具本來就用同一支算）。
 */
export const drawHoleShape = (
  ctx: CanvasRenderingContext2D,
  o: {
    hole: string; text?: string; filled?: boolean; color?: string; lineW?: number;
    glow?: number | boolean; glowColor?: string;
    strokeW?: number; strokeColor?: string;
    dots?: boolean; dotSize?: number; dotGap?: number; dotColor?: string;
    id?: string; randomNumber?: number;
    /** 線寬的單位。不給就照外框的長邊 / 160 —— 那會讓「圖形拉大」連框線
     *  也跟著變粗，所以呼叫端想要「粗細固定」時就把不含縮放的那個值傳進來。 */
    lineUnit?: number;
  },
  bw: number, bh: number,
  blurs: number[],
) => {
  const col = o.color || '#FFFFFF';
  const size = Math.min(bw, bh);
  const unit = (o.lineUnit && o.lineUnit > 0) ? o.lineUnit : Math.max(bw, bh) / 160;
  const lw = Math.max(0.4, (o.lineW ?? 6) * unit);
  const solid = o.filled !== false;
  const gcol = o.glowColor || col;
  const sw = (o.strokeW || 0) * unit;

  if (isTextHole(o.hole)) {
    const gly = holeGlyph(o.hole, o.text || '', o);
    /* 發光：drawTextShape 最後是一次 drawImage，所以直接開 canvas 的陰影，
       光就會沿著字（或去背圖）真正的輪廓散出去。 */
    if (o.glow) {
      ctx.save();
      ctx.shadowColor = gcol;
      for (const r of blurs) {
        ctx.shadowBlur = r;
        drawTextShape(ctx, o.hole, gly, 0, 0, size, col, false, 0);
      }
      ctx.restore();
    }
    /* 描邊：字沒有路徑可以描，改成把同一個形狀往外八個方向各畫一次當底 ——
       疊出來就是一圈等寬的外框，本體再蓋回中間。 */
    if (sw > 0) {
      ctx.save();
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        drawTextShape(ctx, o.hole, gly, Math.cos(a) * sw, Math.sin(a) * sw, size, o.strokeColor || '#000000', false, 0);
      }
      ctx.restore();
    }
    if (o.dots) {
      /* 暫存畫布開大一點（長邊 ×1.6），字的墨水比框大時也不會被切掉。
         「長邊」要連墨水一起算 —— 像 `<333` 的墨水有外框的 2.9 倍寬，
         只看外框的話點點會在框的邊緣就被切斷。 */
      const inkD = glyphInk(o.hole, gly, size);
      const side = Math.max(2, Math.ceil(Math.max(bw, bh, inkD.w, inkD.h) * 1.6));
      const tmp = document.createElement('canvas');
      tmp.width = side; tmp.height = side;
      const tc = tmp.getContext('2d');
      if (tc) {
        tc.translate(side / 2, side / 2);
        drawTextShape(tc, o.hole, gly, 0, 0, size, col, false, 0);
        tc.globalCompositeOperation = 'source-atop';
        paintDots(tc, bw, bh, side, side, o.dotSize ?? 50, o.dotGap ?? 20, o.dotColor || '#FFFFFF');
        ctx.drawImage(tmp, -side / 2, -side / 2);
        return;
      }
    }
    drawTextShape(ctx, o.hole, gly, 0, 0, size, col, false, 0);
    return;
  }

  drawShapePath(ctx, o.hole, 0, 0, size);
  if (o.glow) {
    ctx.save();
    ctx.shadowColor = gcol;
    ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = lw;
    for (const r of blurs) {
      ctx.shadowBlur = r;
      if (solid) ctx.fill(); else ctx.stroke();
    }
    ctx.restore();
  }
  // 描邊畫在本體底下、寬度加倍，本體蓋住內半邊就只剩外面那一圈
  if (sw > 0) {
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = o.strokeColor || '#000000';
    ctx.lineWidth = (solid ? 0 : lw) + sw * 2;
    ctx.stroke();
    ctx.restore();
  }
  if (solid) { ctx.fillStyle = col; ctx.fill(); }
  else { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke(); }
  if (o.dots) {
    // 路徑還在，直接拿來當剪裁範圍
    ctx.save();
    ctx.clip();
    paintDots(ctx, bw, bh, bw, bh, o.dotSize ?? 50, o.dotGap ?? 20, o.dotColor || '#FFFFFF');
    ctx.restore();
  }
};

/**
 * 這顆圖案畫出來會超出外框多少（單邊，跟外框同一個座標系）。
 *
 * 好幾種圖案的墨水本來就比外框大 —— 像 `<333` 的寬度是外框的 2.9 倍、
 * `zzz` 是 1.2 倍，路徑類的則是描邊有一半長在框外面。匯出是直接畫在整張
 * 頁面上，所以是完整的；預覽與縮圖卻是畫在一張「跟外框一樣大」的畫布上，
 * 超出去的部分被畫布邊緣切掉 —— 於是只看得到方框裡面那一截。
 *
 * 呼叫端拿這個值把畫布往外撐開就好：畫的內容、原點、大小全部不動
 * （drawHoleShape 收到的還是原本的外框），只是多留了不會被切掉的餘地。
 */
export const holeOverflow = (
  o: {
    hole: string; text?: string; lineW?: number;
    glow?: number | boolean; strokeW?: number; id?: string; randomNumber?: number;
    lineUnit?: number;
  },
  bw: number, bh: number,
  blurs: number[],
) => {
  // 下面這三行跟 drawHoleShape 開頭是同一組算式，不能各算各的
  const size = Math.min(bw, bh);
  const unit = (o.lineUnit && o.lineUnit > 0) ? o.lineUnit : Math.max(bw, bh) / 160;
  const lw = Math.max(0.4, (o.lineW ?? 6) * unit);
  const sw = (o.strokeW || 0) * unit;
  /* 發光是 canvas 的 shadowBlur：模糊半徑 r 大約散到 1.5r 才看不見 */
  const glow = o.glow ? Math.max(0, ...blurs) * 1.5 : 0;
  // 中心到墨水外緣：字符／去背圖量墨水，路徑類的半徑就是 size/2
  let ix = size / 2, iy = size / 2;
  if (isTextHole(o.hole)) {
    const ink = glyphInk(o.hole, holeGlyph(o.hole, o.text || '', o), size);
    ix = ink.w / 2; iy = ink.h / 2;
  }
  // 描邊往外加寬一圈，發光再往外散
  const ex = ix + lw / 2 + sw + glow;
  const ey = iy + lw / 2 + sw + glow;
  /* 收在外框長邊的 3 倍以內 —— 再大就只是白白多開像素了 */
  const cap = Math.max(bw, bh) * 3;
  return {
    x: Math.min(cap, Math.max(0, ex - bw / 2)),
    y: Math.min(cap, Math.max(0, ey - bh / 2)),
  };
};

/* ── 從圖案借過來的那幾種圖形 ─────────────────────────────────────
   kind 一律是 'hole'，真正畫哪一種看 hole 欄位。兩個拼圖工具的
   「新增圖形」清單都吃這一份，所以順序與內容不可能各走各的。 */
export type HoleShapeItem = { id: string; kind: 'hole'; hole: string; filled: boolean };
/** 實心那一排要插在倒數第二的那一顆（第三個圖案） */
export const HOLE_ITEM_CROSS: HoleShapeItem = { id: 'hole-cross-star-f', kind: 'hole', hole: 'cross-star', filled: true };
/** 邊框那一排倒數第二的那一顆（同一個形狀的空心版） */
export const HOLE_ITEM_CROSS_O: HoleShapeItem = { id: 'hole-cross-star-o', kind: 'hole', hole: 'cross-star', filled: false };
/** 第六個圖案到倒數第二個，照原本的順序接在實心那一排後面（不做空心版） */
export const HOLE_ITEMS_EXTRA: HoleShapeItem[] =
  /* random-num（那顆「(9)」）拿掉了 —— 圖形不需要一顆會變的編號 */
  ['flower', 'snow', 'love', 'love3', 'pic333', 'vortex',
   'seagrass', 'darkstar', 'sparkle', 'aster', 'theta', 'yaya', 'zzz']
    .map(h => ({ id: `hole-${h}`, kind: 'hole' as const, hole: h, filled: true }));

/**
 * 圖形發光的強度換算。面板上是一根 0～100 的滑桿，畫的時候拿它去乘發光的半徑。
 *
 * 舊資料相容：以前發光只有開／關，經典拼圖存的是 true／false、創意拼圖存的是
 * 1／0。所以 true 與「剛好等於 1」都當成 100（滿），不然舊的草稿打開來
 * 會變成幾乎看不見的 1%。真的想要 1% 的人看到的跟 0% 也沒有差別。
 */
export const glowAmount = (g: number | boolean | undefined): number => {
  if (g === true) return 1;
  if (!g) return 0;
  const v = Number(g);
  if (!isFinite(v) || v <= 0) return 0;
  return (v === 1 ? 100 : Math.min(100, v)) / 100;
};
