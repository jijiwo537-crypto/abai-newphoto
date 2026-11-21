import { registerTrim } from './memoryPressure';
/* 文字縮放時的「抖動」：fillText 在不同的縮放倍率下，瀏覽器（尤其 Safari）
   會依「實際顯示字級」重新 hint 字形、把每個字的位置各自吸到像素格上。
   倍率一路連續改變時，每個字吸附的那一格各不相同，整串字就在相鄰像素間跳。

   符號早就改成「同一張高解析度貼圖、只變矩陣」才穩定；一般文字也走同一招：
   用完全相同的字型狀態（font／字距／對齊／描邊）在離屏畫布排一次字，
   之後只用目前矩陣 drawImage —— 位置是連續的，不會再逐幀重新排字。
   貼圖解析度只在倍率跨過 2 的次方時才換一張（清晰度改變，位置不變）。 */

/* 表情符號：iPhone 的 Safari 量字（measureText 的 actualBoundingBox）只照主要字型的
   上下緣算，蘋果的彩色表情符號比那個高、也比較寬一點 —— 照量到的大小開畫布，
   表情符號的頭頂、底部和最右邊就會被切掉。字串裡有表情符號時，墨水範圍至少撐到
   表情符號實際會畫到的大小（約 1em 高，左右各多留一點）。 */
const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
export const hasEmoji = (text: string) => EMOJI_RE.test(text);
/** 量到的墨水範圍（皆為正值，相對於繪製原點）依表情符號撐開。baseline 是目前 textBaseline。 */
/** 依 textAlign 把前進寬度分成原點左、右兩邊 */
export const advanceSplit = (align: CanvasTextAlign, width: number): [number, number] =>
  align === 'center' ? [width / 2, width / 2] : align === 'right' || align === 'end' ? [width, 0] : [0, width];
/** leftAdv／rightAdv：字的前進寬度在原點左邊／右邊各佔多少（看 textAlign）。 */
export const emojiSafeInk = (text: string, fontPx: number, ink: { left: number; right: number; top: number; bottom: number }, leftAdv: number, rightAdv: number, baseline: CanvasTextBaseline = 'alphabetic') => {
  if (!hasEmoji(text)) return ink;
  const mid = baseline === 'middle';
  return {
    left: Math.max(ink.left, leftAdv + fontPx * .12),
    right: Math.max(ink.right, rightAdv + fontPx * .12),
    top: Math.max(ink.top, fontPx * (mid ? .62 : 1.0)),
    bottom: Math.max(ink.bottom, fontPx * (mid ? .62 : .32)),
  };
};

type Entry = { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number; px: number };
const cache = new Map<string, Entry>();
const MAX_ENTRIES = 48;
const MAX_TOTAL_PX = 24e6;
const MAX_ENTRY_PX = 8e6;
const MAX_SIDE = 8192;
let totalPx = 0;
/* document.fonts.check 很耗時（會走過整個字型堆疊），縮放時每一格都會呼叫。字型一旦好了就一直是好的 */
const readyFonts = new Set<string>();
const fontReady = (font: string) => {
  if (readyFonts.has(font)) return true;
  const ok = (document as any).fonts?.check?.(font) ?? true;
  if (ok) readyFonts.add(font);
  return ok;
};

export const textReady = (font: string, text: string) => {
  const key = font + '\u0002' + text;
  if (readyFonts.has(key)) return true;
  let ok = true;
  try { ok = (document as any).fonts?.check?.(font, text) ?? true; } catch { ok = true; }
  if (ok) { readyFonts.add(key); if (readyFonts.size > 4000) readyFonts.clear(); return true; }
  (document as any).fonts?.load?.(font, text).then(() => window.dispatchEvent(new Event('abai-font-ready'))).catch(() => {});
  return false;
};
const evict = () => {
  while (cache.size > MAX_ENTRIES || totalPx > MAX_TOTAL_PX) {
    const key = cache.keys().next().value;
    if (key === undefined) break;
    const old = cache.get(key)!;
    cache.delete(key); totalPx -= old.px;
    old.canvas.width = old.canvas.height = 1;
  }
};

/**
 * 跟 ctx.fillText / ctx.strokeText(text, x, y) 畫出同一個位置、同一種樣式，
 * 但以快取貼圖繪製，縮放時不抖。樣式（漸層等）無法快取時回傳 false，
 * 呼叫端照原本的 fillText 畫。陰影（發光）照常套用在 drawImage 上。
 */
export function drawStableText(ctx: CanvasRenderingContext2D, mode: 'fill' | 'stroke', text: string, x: number, y: number): boolean {
  if (!text) return true;
  /* 描邊不走快取貼圖：描邊的點陣在某些倍率下會被取樣得忽粗忽細（放大後重做才正常），直接畫最穩 */
  if ((mode as string) === 'stroke') return false;
  const e = stableEntry(ctx, mode, text);
  if (!e) return false;
  const hit = e.hit;
  // 點陣最多是螢幕大小的 2 倍（2 的次方級距），一般的雙線性看起來完全一樣；'high' 每格都要做昂貴的多次縮小，
  // 縮放文字時會卡
  const smoothing = ctx.imageSmoothingEnabled, quality = ctx.imageSmoothingQuality;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(hit.canvas, x + hit.x, y + hit.y, hit.w, hit.h);
  ctx.imageSmoothingEnabled = smoothing; ctx.imageSmoothingQuality = quality;
  return true;
}

/** 找（或做出）跟 ctx 目前狀態對應的文字點陣。做不了回傳 null。 */
function stableEntry(ctx: CanvasRenderingContext2D, mode: 'fill' | 'stroke', text: string): { hit: Entry; key: string } | null {
  const style = mode === 'stroke' ? ctx.strokeStyle : ctx.fillStyle;
  if (typeof style !== 'string' || typeof document === 'undefined') return null;
  const m = ctx.getTransform();
  const k = Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
  if (!(k > 0) || !Number.isFinite(k)) return null;
  const level = Math.min(16, Math.max(1, 2 ** Math.ceil(Math.log2(k))));
  const spacing = String((ctx as any).letterSpacing || '0px');
  // 字型還沒載好時排出來的是備用字型；載好後鑰匙不同，自然重排一次。
  /* 中文字體是照 unicode-range 拆成很多小份的：字型「載好了」不代表這幾個字所在的那一份也到了。
     要用這段字本身去問；還沒到就先請瀏覽器載，載到時通知重畫（鑰匙會變，不會留著備用字型的貼圖） */
  const ready = textReady(ctx.font, text);
  // 這幾個字還沒到：不做快取貼圖，直接畫（到齊之後會重畫，不會留下備用字型的貼圖）
  if (!ready) return null;
  const key = [mode, text, ctx.font, spacing, ctx.textAlign, ctx.textBaseline, style,
    mode === 'stroke' ? `${ctx.lineWidth}|${ctx.lineJoin}|${ctx.miterLimit}` : '', level, ready].join('\u0001');
  let hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); }
  else {
    /* 要「新做」一張點陣時一定再問一次字型是不是真的在（不信快取的答案）：iPhone 會在記憶體吃緊時把網頁字型丟掉，
       之前問到的「好了」就不準了 —— 這時做出來的是預設字體，而且會被存起來一直用（縮放時字體突然變掉）。
       字型不在就這一格先直接畫，並請瀏覽器重新載入，到了會通知重畫 */
    let fresh = true;
    try { fresh = (document as any).fonts?.check?.(ctx.font, text) ?? true; } catch { fresh = true; }
    if (!fresh) {
      readyFonts.delete(ctx.font + '\u0002' + text);
      (document as any).fonts?.load?.(ctx.font, text).then(() => window.dispatchEvent(new Event('abai-font-ready'))).catch(() => {});
      return null;
    }
    const canvas = document.createElement('canvas');
    const g = canvas.getContext('2d');
    if (!g) return null;
    const setup = () => {
      g.font = ctx.font; (g as any).letterSpacing = spacing;
      g.textAlign = ctx.textAlign; g.textBaseline = ctx.textBaseline;
      g.fillStyle = style; g.strokeStyle = style;
      g.lineWidth = ctx.lineWidth; g.lineJoin = ctx.lineJoin; g.miterLimit = ctx.miterLimit;
    };
    setup();
    const metrics = g.measureText(text);
    const fontPx = parseFloat(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] || '16');
    const margin = Math.ceil((mode === 'stroke' ? ctx.lineWidth : 0) + fontPx * .15 + 2);
    const ink = emojiSafeInk(text, fontPx, {
      left: Math.max(0, metrics.actualBoundingBoxLeft || 0),
      right: Math.max(0, metrics.actualBoundingBoxRight || metrics.width),
      top: Math.max(0, metrics.actualBoundingBoxAscent || fontPx),
      bottom: Math.max(0, metrics.actualBoundingBoxDescent || fontPx * .3),
    }, ...advanceSplit(ctx.textAlign, metrics.width), ctx.textBaseline);
    const left = ink.left + margin, right = ink.right + margin, top = ink.top + margin, bottom = ink.bottom + margin;
    const w = left + right, h = top + bottom;
    const lv = Math.max(.25, Math.min(level, MAX_SIDE / Math.max(w, h), Math.sqrt(MAX_ENTRY_PX / Math.max(1, w * h))));
    canvas.width = Math.max(1, Math.ceil(w * lv));
    canvas.height = Math.max(1, Math.ceil(h * lv));
    setup();
    g.setTransform(lv, 0, 0, lv, left * lv, top * lv);
    if (mode === 'stroke') g.strokeText(text, 0, 0); else g.fillText(text, 0, 0);
    hit = { canvas, x: -left, y: -top, w: canvas.width / lv, h: canvas.height / lv, px: canvas.width * canvas.height };
    cache.set(key, hit); totalPx += hit.px; evict();
  }
  return { hit, key };
}

/* ── 發光：縮放時不抖 ───────────────────────────────────────────────
   原本的發光是在畫面上即時 shadowBlur 三層。shadowBlur 的單位是螢幕像素，縮放時每一格半徑都在變，
   Safari 會把模糊半徑取整 —— 光的大小、亮度就一格一格跳（抖）。
   改成：用同一張文字點陣，在旁邊的小畫布上把三層光（連同字本身，跟原本一樣）先畫好；
   模糊量用「文字自己的座標」計算，縮放時不會變，所以縮放的每一格都直接重用同一張，
   只是跟著矩陣連續縮放 —— 不會再重新模糊、也就不會抖。內容或發光設定改了才重畫。
   合成結果跟原本逐層畫在畫面上完全相同：三層各一張，畫上去時才套目前的透明度（發光動畫改透明度時不用重做）。 */
/* 光暈圖只有「光」：三層 shadowBlur 疊在同一張上，再把字本身的位置挖掉。
   字由呼叫端另外畫一次（高解析度的那張）——
   ‧ 透明度：原本三層各含一個字、加上最後那次填色，等於同一個字疊了 4 次，字調透明後一開發光就變得很不透明。
     現在字只畫一次，光在字底下也挖空，字的透明度就跟沒開發光時一樣。
   ‧ 清晰度：光暈圖為了省記憶體解析度有上限，以前字也在這張裡，放大就看到鋸齒；現在字不在裡面了。 */
type Glow = { layers: HTMLCanvasElement[]; lv: number[]; x: number; y: number; w: number; h: number; px: number };
const glowCache = new Map<string, Glow>();
let glowBrokenUntil = 0;   // iPhone 畫布記憶體用完時，暫時改用直接畫
let glowPx = 0;
let hiTimer = 0, hiPending: (() => void) | null = null;
/* 記憶體吃緊（系統警告）或存完圖時：文字點陣、光暈圖都是可以重做的快取，全部放掉 */
registerTrim('stable-text', () => {
  for (const e of cache.values()) e.canvas.width = e.canvas.height = 1;
  cache.clear(); totalPx = 0;
  for (const g of glowCache.values()) for (const c of g.layers) c.width = c.height = 1;
  glowCache.clear(); glowPx = 0;
  for (const sc of scratches) if (sc) sc.width = sc.height = 1;
});
const GLOW_HI_ENTRY = 3e6;
const GLOW_MAX_ENTRIES = 24, GLOW_MAX_TOTAL = 12e6, GLOW_MAX_ENTRY = 8e5, GLOW_MAX_SIDE = 4096;
const evictGlow = () => {
  while (glowCache.size > GLOW_MAX_ENTRIES || glowPx > GLOW_MAX_TOTAL) {
    const k0 = glowCache.keys().next().value;
    if (k0 === undefined) break;
    const old = glowCache.get(k0)!;
    glowCache.delete(k0); glowPx -= old.px; for (const c of old.layers) c.width = c.height = 1;
  }
};
function drawStableGlow(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, blurs: number[], color: string, textAlpha?: number): boolean {
  if (ctx.globalCompositeOperation !== 'source-over') return false;
  if (glowBrokenUntil && performance.now() < glowBrokenUntil) return false;
  const e = stableEntry(ctx, 'fill', text);
  if (!e) return false;
  const { hit } = e;
  const m = ctx.getTransform();
  const k = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
  if (!(k > 0) || !Number.isFinite(k)) return false;
  const lv = hit.canvas.width / hit.w;
  const STEP = Math.log(1.004);
  const local = blurs.map(b => Math.exp(Math.round(Math.log(Math.max(1e-6, b / k)) / STEP) * STEP));
  const key = [e.key, color, local.map(v => v.toPrecision(6)).join(',')].join('\u0003');
  const pad = Math.max(...local) * 1.7 + 2 / lv;
  const lw = hit.w + pad * 2, lh = hit.h + pad * 2;
  const BL = 12;
  const fontState = { font: ctx.font, ls: String((ctx as any).letterSpacing || '0px'), align: ctx.textAlign, base: ctx.textBaseline };
  /* 做三層光。gvOf：每層的解析度（每單位幾像素）。模糊量＝b×gv */
  const build = (gvOf: (b: number) => number, maxBlur: number): Glow | null => {
    const layers: HTMLCanvasElement[] = [], lvs: number[] = [];
    let total = 0;
    const drop = () => { for (const c of layers) c.width = c.height = 1; };
    for (const b of local) {
      const gv = gvOf(b);
      const W = Math.ceil(lw * gv), H = Math.ceil(lh * gv);
      if (!(gv > 0) || W < 1 || H < 1) { drop(); return null; }
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      layers.push(c); lvs.push(gv);
      if (c.width !== W || c.height !== H) { drop(); return null; }
      const g = c.getContext('2d');
      if (!g) { drop(); return null; }
      g.clearRect(0, 0, W, H);
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'medium';
      g.shadowColor = color;
      // 只畫影子：字本體畫到畫布外，影子用 offset 移回來（光暈圖裡完全沒有字的銳利邊）
      const OFF = W + 64;
      g.shadowOffsetX = OFF; g.shadowBlur = Math.min(b * gv, maxBlur);
      /* 字直接用向量畫進這張小圖（不從大點陣縮小：縮小會有雜訊，而且雜訊隨倍率改變＝抖） */
      g.font = fontState.font; (g as any).letterSpacing = fontState.ls;
      g.textAlign = fontState.align; g.textBaseline = fontState.base; g.fillStyle = '#000';
      g.setTransform(gv, 0, 0, gv, (pad - hit.x) * gv - OFF, (pad - hit.y) * gv);
      g.fillText(text, 0, 0);
      g.setTransform(1, 0, 0, 1, 0, 0);
      /* iPhone：畫布總記憶體超過上限時，新畫布不報錯、只是畫不出東西。角落放一個看不見的點（透明度 1/255），
         晚一點（不擋這一格畫面）讀回來確認；讀不到就丟掉這組光、改用直接畫，並要求重畫 */
      g.shadowColor = 'transparent'; g.shadowOffsetX = 0; g.shadowBlur = 0;
      g.fillStyle = 'rgba(0,0,0,0.004)'; g.fillRect(W - 1, H - 1, 1, 1);
      total += W * H;
    }
    return { layers, lv: lvs, x: hit.x - pad, y: hit.y - pad, w: lw, h: lh, px: total };
  };
  const store = (kk: string, made: Glow) => {
    glowCache.set(kk, made); glowPx += made.px; evictGlow();
    setTimeout(() => {
      let bad = false;
      for (const c of made.layers) {
        if (c.width <= 1) return;           // 已經被淘汰了
        try { if (c.getContext('2d')!.getImageData(c.width - 1, c.height - 1, 1, 1).data[3] === 0) bad = true; } catch { bad = true; }
      }
      if (!bad) return;
      if (glowCache.get(kk) === made) { glowCache.delete(kk); glowPx -= made.px; }
      for (const c of made.layers) c.width = c.height = 1;
      glowBrokenUntil = performance.now() + 3000;
      window.dispatchEvent(new Event('abai-font-ready'));
    }, 0);
  };
  let gl = glowCache.get(key);
  if (gl) { glowCache.delete(key); glowCache.set(key, gl); }
  else {
    /* 平常（拖滑桿、縮放中）：每層模糊固定 12 像素、解析度最多跟螢幕一樣 —— 便宜，拉滑桿不會一格一格。 */
    const capV = Math.min(GLOW_MAX_SIDE / lw, GLOW_MAX_SIDE / lh, Math.sqrt(GLOW_MAX_ENTRY / (lw * lh)), Math.max(1, k));
    const made = build(b => Math.min(capV, BL / Math.max(1e-3, b)), BL);
    if (!made) return false;
    store(key, made); gl = made;
  }
  /* 放大看時（光圖會被放大超過 2 倍＝看得到一格一格）：停手 0.2 秒後在背景做一份「跟螢幕一樣細」的光，
     做好就換上。拖曳、縮放、拉滑桿的當下照樣用上面那份便宜的，不會卡 */
  const upscale = k * Math.max(...local) / BL;
  if (upscale > 2) {
    const zl = 2 ** Math.ceil(Math.log2(k));
    const hiKey = key + '\u0005' + zl;
    const hi = glowCache.get(hiKey);
    if (hi) { glowCache.delete(hiKey); glowCache.set(hiKey, hi); gl = hi; }
    else {
      hiPending = () => {
        if (glowCache.has(hiKey)) return;
        const cap = Math.min(GLOW_MAX_SIDE / lw, GLOW_MAX_SIDE / lh, Math.sqrt(GLOW_HI_ENTRY / (lw * lh)));
        const made = build(b => Math.min(cap, Math.max(BL / Math.max(1e-3, b), zl)), 1e9);
        if (made) { store(hiKey, made); window.dispatchEvent(new Event('abai-font-ready')); }
      };
      if (hiTimer) clearTimeout(hiTimer);
      hiTimer = window.setTimeout(() => { hiTimer = 0; const f = hiPending; hiPending = null; f?.(); }, 220);
    }
  }
  /* 合成：在螢幕解析度的暫存畫布上放光，再用「清晰的字」把字的位置挖掉，最後才用目前透明度貼上去。
     挖的邊跟呼叫端接著畫的字是同一張點陣、同一個位置，不會有縫也不會有白邊；
     字調透明時，光不會從字後面透上來。 */
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const xs = [x + gl.x, x + gl.x + gl.w], ys = [y + gl.y, y + gl.y + gl.h];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const px of xs) for (const py of ys) {
    const dx = m.a * px + m.c * py + m.e, dy = m.b * px + m.d * py + m.f;
    x0 = Math.min(x0, dx); x1 = Math.max(x1, dx); y0 = Math.min(y0, dy); y1 = Math.max(y1, dy);
  }
  const bx = Math.max(0, Math.floor(x0)), by = Math.max(0, Math.floor(y0));
  const bw = Math.min(cw, Math.ceil(x1)) - bx, bh = Math.min(ch, Math.ceil(y1)) - by;
  if (bw <= 0 || bh <= 0) return true;
  const sc = scratchFor(bw, bh);
  ctx.save();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'low';
  const G = gl;
  const paintLayers = (t: CanvasRenderingContext2D) => G.layers.forEach((c, i) => t.drawImage(c, x + G.x, y + G.y, c.width / G.lv[i], c.height / G.lv[i]));
  if (!sc) { paintLayers(ctx); ctx.restore(); return true; }
  const s2 = sc.getContext('2d')!;
  s2.setTransform(1, 0, 0, 1, 0, 0);
  s2.globalCompositeOperation = 'source-over'; s2.globalAlpha = 1;
  s2.clearRect(0, 0, bw, bh);
  s2.setTransform(m.a, m.b, m.c, m.d, m.e - bx, m.f - by);
  s2.imageSmoothingEnabled = true; s2.imageSmoothingQuality = 'low';
  paintLayers(s2);
  /* 字不透明時完全不挖：字整個蓋住光，挖了反而在字邊留下一圈深色線。
     字半透明時：字的「內部」整個挖掉（光不從字後面透上來）；字的邊緣按比例挖，
     讓邊緣那一像素的「字＋光」跟不透明時一樣連續，不會出現深色線或白邊。 */
  const ta = Math.max(0, Math.min(1, textAlpha ?? ctx.globalAlpha));
  if (ta < 0.999) {
    s2.globalCompositeOperation = 'destination-out';
    /* 邊緣挖的比例：讓「半蓋住的邊緣像素」跟字內、字外一樣亮（不亮也不暗）。
       邊緣像素：字 a·c，加上剩下的光 (1−a·c)·a·(1−k·c)；取 c＝½ 解出 k＝2(1−a)/(2−a)。
       a＝1 時 k＝0（完全不挖），a 越小挖越多。 */
    s2.globalAlpha = 2 * (1 - ta) / (2 - ta);
    s2.drawImage(hit.canvas, x + hit.x, y + hit.y, hit.w, hit.h);
    s2.globalAlpha = 1;
    const inner = scratchFor(bw, bh, 1);
    if (inner) {
      const s3 = inner.getContext('2d')!;
      s3.setTransform(1, 0, 0, 1, 0, 0); s3.globalCompositeOperation = 'source-over'; s3.globalAlpha = 1;
      s3.clearRect(0, 0, bw, bh);
      s3.imageSmoothingEnabled = true; s3.imageSmoothingQuality = 'low';
      s3.setTransform(m.a, m.b, m.c, m.d, m.e - bx, m.f - by);
      s3.drawImage(hit.canvas, x + hit.x, y + hit.y, hit.w, hit.h);
      /* 只留「完全蓋住」的像素：同一張字在同一個位置 destination-in 三次＝覆蓋率的 4 次方
         （全蓋 1→1、半蓋 .5→.06）。不往內縮，字內側不會留下一圈沒挖乾淨的亮線 */
      s3.globalCompositeOperation = 'destination-in';
      for (let i = 0; i < 3; i++) s3.drawImage(hit.canvas, x + hit.x, y + hit.y, hit.w, hit.h);
      s3.setTransform(1, 0, 0, 1, 0, 0); s3.globalCompositeOperation = 'source-over';
      s2.setTransform(1, 0, 0, 1, 0, 0);
      s2.drawImage(inner, 0, 0, bw, bh, 0, 0, bw, bh);
    }
    s2.globalCompositeOperation = 'source-over';
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(sc, 0, 0, bw, bh, bx, by, bw, bh);
  ctx.restore();
  return true;
}

/* 合成用的暫存畫布（兩張共用，只會變大；超過上限就不用） */
const scratches: (HTMLCanvasElement | null)[] = [null, null];
function scratchFor(w: number, h: number, slot = 0): HTMLCanvasElement | null {
  if (w * h > 8e6) return null;
  let sc = scratches[slot];
  if (!sc) sc = scratches[slot] = document.createElement('canvas');
  if (sc.width < w || sc.height < h) {
    sc.width = Math.max(sc.width, Math.ceil(w)); sc.height = Math.max(sc.height, Math.ceil(h));
    if (sc.width < w || sc.height < h) { scratches[slot] = null; return null; }
    // iPhone 記憶體不夠時新畫布會「畫不出來」但不報錯：畫一點讀回來確認
    const g = sc.getContext('2d'); let ok = 0;
    if (g) { g.fillStyle = '#000'; g.fillRect(0, 0, 1, 1); try { ok = g.getImageData(0, 0, 1, 1).data[3]; } catch { ok = 0; } }
    if (ok < 200) { sc.width = sc.height = 1; scratches[slot] = null; return null; }
  }
  return sc;
}

/** 只畫 draw() 的「影子」（發光），不畫本體：本體畫到畫布外面很遠的地方，影子用 shadowOffset 移回原位。
 *  shadowOffset 是螢幕像素、不受矩陣影響，所以旋轉、縮放都對得上。 */
export function shadowOnly(ctx: CanvasRenderingContext2D, draw: () => void) {
  const OFF = 20000;
  const m = ctx.getTransform();
  ctx.save();
  ctx.setTransform(m.a, m.b, m.c, m.d, m.e - OFF, m.f);
  ctx.shadowOffsetX = OFF; ctx.shadowOffsetY = 0;
  try { draw(); } finally { ctx.restore(); }
}

/**
 * 畫一段字的發光（三層光，不含字本身；字由呼叫端照常畫一次）。
 * stable：這段字能不能用快取點陣。能的話走縮放不抖的光暈圖；不行就逐層只畫影子。
 */
export function drawGlowText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number,
  blurs: number[], color: string, stable: boolean, textAlpha?: number) {
  if (!text) return;
  if (stable && typeof document !== 'undefined' && drawStableGlow(ctx, text, x, y, blurs, color, textAlpha)) return;
  ctx.save();
  ctx.shadowColor = color;
  for (const b of blurs) {
    ctx.shadowBlur = b;
    shadowOnly(ctx, () => { if (!(stable && drawStableText(ctx, 'fill', text, x, y))) ctx.fillText(text, x, y); });
  }
  ctx.restore();
}
