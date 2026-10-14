/* 星芒：鏡頭光芒那種會發光的星。不是固定圖片，是照參數畫出來的 ——
   放大不會糊、顏色可以換。全部用 'lighter'（相加）疊上去，跟真的光一樣越疊越亮。
   座標：以中心為原點，R＝框的一半；ray.len 1 就是剛好碰到框邊。
   規則（主人定的）：每一種都要上下左右對稱、不能只是別種轉個角度；
   要高畫質：不能有鋸齒、漸層要自然。

   畫法：不用瀏覽器的漸層與陰影一筆一筆疊（細芒不到 1px 會出鋸齒、陰影模糊精度差、
   很多層淡色疊起來每層都被捨入成 256 階 → 暗處一段一段的）。改成「逐像素算」：
   每個像素直接用公式算出亮度（芒的剖面是高斯曲線、沿長度平滑淡出），全程小數精度，
   最後加一點看不出來的細微雜點（dithering）才轉成 8 位元，接縫就被打散。
   算好的結果快取成一張圖，之後只要貼上去。 */

export type BurstRay = { a: number; len: number; w: number; alpha?: number };
export type StarBurstSpec = {
  id: string;
  name: string;
  /** 光核半徑（R 的比例） */
  core?: number;
  /** 光核外面那圈柔光的半徑與亮度 */
  glow?: number;
  glowAlpha?: number;
  rays?: BurstRay[];
  /** 一大把細芒：n 條平均分佈，長度照 pattern 輪流（所以一定對稱） */
  fine?: { n: number; len: number; pattern: number[]; w: number; alpha: number; off?: number };
  /** 光環：r 半徑、w 光帶寬度（都是 R 的比例） */
  rings?: { r: number; w: number; alpha: number }[];
  /** 穿過中心、兩頭都長出去的光條（橫向光條那種，比芒寬、比較扁） */
  streaks?: { a: number; len: number; w: number; alpha: number }[];
};

/** n 條平均分佈的芒，從 off 度開始 */
const even = (n: number, len: number, w: number, off = 0, alpha = 1): BurstRay[] =>
  Array.from({ length: n }, (_, i) => ({ a: off + (360 / n) * i, len, w, alpha }));
/** 十字：直的、橫的可以不一樣長 */
const cross = (v: number, h: number, w: number, alpha = 1): BurstRay[] =>
  [{ a: -90, len: v, w, alpha }, { a: 90, len: v, w, alpha }, { a: 0, len: h, w, alpha }, { a: 180, len: h, w, alpha }];

export const STAR_BURSTS: StarBurstSpec[] = [
  { id: 'sb-cross-thin', name: '細長十字', core: .05, glow: .24, rays: cross(1, 1, .03) },
  { id: 'sb-cross-tall', name: '長直十字', core: .05, glow: .22, rays: cross(1, .6, .03) },
  { id: 'sb-cross-soft', name: '柔光十字', core: .07, glow: .34, glowAlpha: .8, rays: [...cross(.85, .85, .09, .35), ...cross(1, 1, .026)] },
  { id: 'sb-needle', name: '針芒', core: .035, glow: .15, rays: cross(1, 1, .013) },
  { id: 'sb-cross-short', name: '短芒十字', core: .08, glow: .36, glowAlpha: .85, rays: cross(.55, .55, .055) },
  { id: 'sb-cross-double', name: '雙層十字', core: .06, glow: .26, rays: [...cross(1, 1, .022), ...cross(.42, .42, .07, .7)] },
  { id: 'sb-six', name: '六芒', core: .05, glow: .24, rays: even(6, .95, .03, 90) },
  { id: 'sb-six-ring', name: '六芒光環', core: .05, glow: .22, rays: even(6, .9, .026, 90), rings: [{ r: .5, w: .07, alpha: .55 }] },
  { id: 'sb-eight', name: '八芒', core: .055, glow: .25, rays: [...cross(1, 1, .03), ...even(4, .55, .026, 45, .85)] },
  { id: 'sb-eight-even', name: '均勻八芒', core: .055, glow: .25, rays: even(8, .9, .027) },
  { id: 'sb-diamond', name: '鑽石光', core: .06, glow: .26, rays: [...cross(1, 1, .028), ...even(4, .24, .09, 45, .55)] },
  { id: 'sb-ten', name: '十芒', core: .055, glow: .25, rays: even(10, .85, .025, 90) },
  { id: 'sb-twelve', name: '十二芒', core: .06, glow: .27, rays: [...cross(1, 1, .032), ...even(8, .62, .021, 22.5, .8)] },
  { id: 'sb-twelve-even', name: '均勻十二芒', core: .06, glow: .27, rays: even(12, .8, .022) },
  { id: 'sb-sixteen', name: '十六芒', core: .06, glow: .27, rays: [...cross(1, 1, .028), ...even(4, .7, .022, 45, .85), ...even(8, .45, .017, 22.5, .7)] },
  { id: 'sb-flash', name: '閃光', core: .07, glow: .32, rays: [...cross(1, 1, .036), ...even(4, .6, .026, 45, .8)],
    fine: { n: 32, len: .48, pattern: [1, .55, .8, .6], w: .012, alpha: .4, off: 5.625 } },
  { id: 'sb-fine', name: '細芒放射', core: .06, glow: .27, fine: { n: 48, len: .85, pattern: [1, .62, .82, .55, .9, .6], w: .013, alpha: .55 } },
  { id: 'sb-soft-rays', name: '柔芒放射', core: .08, glow: .34, rays: even(16, .62, .06, 0, .4) },
  { id: 'sb-orb', name: '光球', core: .14, glow: .44, glowAlpha: .95, fine: { n: 48, len: .66, pattern: [1, .7, .85, .62], w: .015, alpha: .38 } },
  { id: 'sb-orb-cross', name: '光球十字', core: .1, glow: .38, rays: cross(1, 1, .028), fine: { n: 32, len: .52, pattern: [1, .65, .8, .6], w: .014, alpha: .38, off: 5.625 } },
  { id: 'sb-sun', name: '放射球', core: .12, glow: .4, rays: even(24, .62, .018, 0, .7) },
  { id: 'sb-burst', name: '星爆', core: .09, glow: .38, rays: [...cross(1, 1, .036), ...even(4, .72, .028, 45, .9), ...even(8, .5, .018, 22.5, .7)],
    fine: { n: 48, len: .4, pattern: [1, .7, .85, .6], w: .011, alpha: .35, off: 3.75 } },
  { id: 'sb-dot', name: '光點', core: .09, glow: .42, glowAlpha: .9, rays: cross(.4, .4, .028, .8) },
  { id: 'sb-ring', name: '光環十字', core: .045, glow: .18, rays: cross(1, 1, .02), rings: [{ r: .46, w: .075, alpha: .6 }] },
  { id: 'sb-ring-eight', name: '光環八芒', core: .05, glow: .22, rays: [...cross(1, 1, .026), ...even(4, .5, .02, 45, .8)], rings: [{ r: .58, w: .07, alpha: .5 }] },
  { id: 'sb-double-ring', name: '雙環', core: .045, glow: .2, rays: cross(.95, .95, .022), rings: [{ r: .3, w: .055, alpha: .55 }, { r: .64, w: .065, alpha: .4 }] },
  { id: 'sb-ring-orb', name: '光環光球', core: .11, glow: .36, glowAlpha: 1.4, rings: [{ r: .62, w: .08, alpha: .5 }] },
  { id: 'sb-halo-wide', name: '大光暈', core: .06, glow: .26, rays: even(8, .78, .022), rings: [{ r: .45, w: .13, alpha: .28 }] },
  { id: 'sb-anamorphic', name: '橫向光條', core: .06, glow: .26, streaks: [{ a: 0, len: 1, w: .05, alpha: .85 }], rays: cross(.32, .2, .028, .8) },
  { id: 'sb-streak-cross', name: '光條十字', core: .065, glow: .28, streaks: [{ a: 0, len: 1, w: .045, alpha: .6 }], rays: cross(1, .7, .028) },
];


const rgb = (hex: string) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

type Ray = { ux: number; uy: number; L: number; sig: number; a: number };

/** 把一種星芒算成 N×N 的圖（N＝框的邊長，實際像素）。回傳的是黑底不透明的光，用 'lighter' 貼上去。 */
const renderSprite = (spec: StarBurstSpec, N: number, color: string): HTMLCanvasElement => {
  const R = N / 2, c = rgb(color);
  const rays: Ray[] = [];
  /* 芒的剖面：高斯，σ 從根部往尖端收細。太細的芒 σ 至少留 0.55px —— 再細就一定鋸齒，
     亮度照比例調低，看起來一樣細但邊緣是柔的。 */
  const addRay = (deg: number, len: number, w: number, a: number) => {
    if (len <= 0 || w <= 0 || a <= 0) return;
    const t = (deg * Math.PI) / 180, raw = (w * R) / 2;
    const sig = Math.max(raw, .55);
    rays.push({ ux: Math.cos(t), uy: Math.sin(t), L: len * R, sig, a: a * Math.min(1, Math.sqrt(raw / sig) * 1.05) });
  };
  for (const r of spec.rays || []) addRay(r.a, r.len, r.w, r.alpha ?? 1);
  if (spec.fine) {
    const f = spec.fine;
    const step = 360 / f.n;
    for (let i = 0; i < f.n; i++) {
      const deg = (f.off ?? 0) + step * i;
      /* 長短照「離最近的軸線幾度」決定，不照編號輪流 —— 這樣上下、左右、斜對角都一定對稱 */
      const m = ((deg % 90) + 90) % 90, fold = Math.min(m, 90 - m);
      const k = f.pattern[Math.round(fold / step) % f.pattern.length];
      addRay(deg, f.len * k, f.w, f.alpha * (.55 + .45 * k));
    }
  }
  for (const s of spec.streaks || []) { addRay(s.a, s.len, s.w * 1.25, s.alpha); addRay(s.a + 180, s.len, s.w * 1.25, s.alpha); }
  const rings = (spec.rings || []).map(r => ({ r: r.r * R, w: Math.max(.8, r.w * R), a: r.alpha }));
  const hasGlow = !!(spec.core || spec.glow);
  const core = Math.max(.6, (spec.core ?? .05) * R), G = (spec.glow ?? .22) * R, GA = spec.glowAlpha ?? 1;
  // 光環內緣偏暖、外緣偏冷一點點
  const warm = [c[0], c[1] * .96, c[2] * .9], cool = [c[0] * .9, c[1] * .96, c[2]];

  const out = new ImageData(N, N), d = out.data;
  for (let i = 3; i < d.length; i += 4) d[i] = 255;
  let seed = 12345;
  const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  /* 像底片那樣平滑地「接近」全白：0.6 以下原樣（暗部、中間調亮度不變），
     再亮就越來越慢地逼近全白 —— 光核還是亮白的，但不會變成一塊邊緣很硬的白餅 */
  const tone = (v: number) => v < .6 ? v : .6 + .4 * (1 - Math.exp(-(v - .6) / .4));
  /* 每一種都上下、左右對稱，所以只算左上四分之一，再鏡像到另外三塊（快四倍） */
  const H = Math.ceil(N / 2);
  for (let py = 0; py < H; py++) {
    const y = py + .5 - R;
    for (let px = 0; px < H; px++) {
      const x = px + .5 - R;
      let lr = 0, lg = 0, lb = 0, white = 0;
      for (let i = 0; i < rays.length; i++) {
        const ry = rays[i];
        const along = x * ry.ux + y * ry.uy;
        if (along > ry.L || along < -ry.sig * 14) continue;
        /* 根部是圓頭：中心後面那一段用「到中心的距離」算，平滑淡掉。
           以前在根部後面直接切一刀，寬的芒（柔光十字、光條）兩側柔光散得開，
           切口就成了一條直直的硬邊，中心附近看起來像色塊。 */
        const side = -x * ry.uy + y * ry.ux;
        const perp = along >= 0 ? Math.abs(side) : Math.sqrt(side * side + along * along);
        const tp = Math.max(0, 1 - Math.max(0, along) / ry.L);           // 1＝根部、0＝尖端
        const s = ry.sig * (.35 + .65 * tp);
        if (perp > s * 14) continue;
        const q = perp / s;
        const lat = Math.exp(-.5 * q * q) + .28 * Math.exp(-.5 * (q / 3.2) * (q / 3.2));
        const fall = Math.pow(tp, 1.6) * (1 - .25 * (1 - tp));
        const v = ry.a * fall * lat;
        lr += v * c[0]; lg += v * c[1]; lb += v * c[2];
      }
      if (rings.length || hasGlow) {
        const r = Math.sqrt(x * x + y * y);
        for (const rg of rings) {
          const dd = (r - rg.r) / rg.w;
          if (dd <= -3.2 || dd >= 3.2) continue;
          const win = Math.cos((Math.abs(dd) / 3.2) * Math.PI / 2) ** 2;
          const v = rg.a * win * (Math.exp(-1.2 * dd * dd) * .8 + Math.exp(-.3 * dd * dd) * .25);
          const k = Math.max(0, Math.min(1, dd / 2 + .5));
          lr += v * (warm[0] * (1 - k) + cool[0] * k); lg += v * (warm[1] * (1 - k) + cool[1] * k); lb += v * (warm[2] * (1 - k) + cool[2] * k);
        }
        if (hasGlow) {
          if (r < G) { const v = GA * .55 * Math.pow(1 - r / G, 2.4); lr += v * c[0]; lg += v * c[1]; lb += v * c[2]; }
          const q = r / core;
          if (q < 4) white += GA * Math.exp(-q * q * 1.1);
        }
      }
      // 光核那一點偏白（真的光最亮的地方都是白的）
      lr = tone(lr + white); lg = tone(lg + white); lb = tone(lb + white);
      if (lr <= 0 && lg <= 0 && lb <= 0) continue;
      /* 存成「黑底、不透明」的光：用 'lighter' 貼上去，黑色（0）等於什麼都不加。
         以前存成「透明度＝亮度」，暗的地方透明度只剩 1～2 階，手機瀏覽器內部預乘時
         把顏色算歪 → 一小塊一小塊的彩色雜點。三個通道共用同一個雜點，也不會有彩色雜訊。 */
      for (const [qx, qy] of [[px, py], [N - 1 - px, py], [px, N - 1 - py], [N - 1 - px, N - 1 - py]]) {
        const o = (qy * N + qx) * 4, n = noise();
        d[o] = Math.min(255, Math.floor(lr * 255 + n));
        d[o + 1] = Math.min(255, Math.floor(lg * 255 + n));
        d[o + 2] = Math.min(255, Math.floor(lb * 255 + n));
      }
    }
  }
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  cv.getContext('2d')!.putImageData(out, 0, 0);
  return cv;
};

const spriteCache = new Map<string, HTMLCanvasElement>();
const keyOf = (spec: StarBurstSpec, N: number, color: string) => `${spec.id}|${N}|${color}`;
/** 這種星芒、這個大小（實際像素）的圖；算過就直接拿 */
export const starBurstSprite = (spec: StarBurstSpec, sizePx: number, color = '#ffffff') => {
  const N = Math.max(8, Math.min(2400, Math.round(sizePx)));
  const k = keyOf(spec, N, color);
  let cv = spriteCache.get(k);
  if (!cv) {
    cv = renderSprite(spec, N, color);
    spriteCache.set(k, cv);
    if (spriteCache.size > 80) spriteCache.delete(spriteCache.keys().next().value!);
  }
  return cv;
};
/** 已經算好的、最接近這個大小的圖（拖滑桿時先拿它放大縮小頂著，停下來再算精確的） */
export const nearestStarBurstSprite = (spec: StarBurstSpec, sizePx: number, color = '#ffffff') => {
  let best: HTMLCanvasElement | null = null, bd = Infinity;
  for (const [k, cv] of spriteCache) {
    if (!k.startsWith(spec.id + '|') || !k.endsWith('|' + color)) continue;
    const dd = Math.abs(Math.log(cv.width / sizePx));
    if (dd < bd) { bd = dd; best = cv; }
  }
  return best;
};

/** 在 (cx,cy) 畫一顆星芒，size 是外框的邊長（實際像素）。color 是光的顏色（光核永遠偏白，像真的光）。
    fast：只用已經算好的圖縮放頂著（拖曳中用），沒有的話才現算。 */
export const drawStarBurst = (g: CanvasRenderingContext2D, spec: StarBurstSpec, cx: number, cy: number, size: number, color = '#ffffff', alpha = 1, fast = false) => {
  const cv = (fast && nearestStarBurstSprite(spec, size, color)) || starBurstSprite(spec, size, color);
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = alpha;
  g.imageSmoothingEnabled = true;
  (g as any).imageSmoothingQuality = 'high';
  g.drawImage(cv, cx - size / 2, cy - size / 2, size, size);
  g.restore();
};
