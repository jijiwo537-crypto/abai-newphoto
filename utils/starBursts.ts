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

/** gap：芒的中間淡掉一段（斷層）。pos 在芒的哪裡（0＝根部、1＝尖端）、w 斷層多寬、depth 淡掉多少（1＝完全斷開） */
export type BurstGap = { pos: number; w: number; depth: number };
export type BurstRay = { a: number; len: number; w: number; alpha?: number; gap?: BurstGap };
export type StarBurstSpec = {
  id: string;
  name: string;
  /** 光核半徑（R 的比例） */
  core?: number;
  /** 光核外面那圈柔光的半徑與亮度 */
  glow?: number;
  glowAlpha?: number;
  /** 柔光集中度 0～1：越大越集中在光核附近（細細一圈），越小越平、散得越開（沒給＝0.2） */
  glowConc?: number;
  rays?: BurstRay[];
  /** 一大把細芒：n 條平均分佈，長度照 pattern 輪流（所以一定對稱） */
  fine?: { n: number; len: number; pattern: number[]; w: number; alpha: number; off?: number };
  /** 光環：r 半徑、w 光帶寬度（都是 R 的比例） */
  rings?: { r: number; w: number; alpha: number }[];
  /** 穿過中心、兩頭都長出去的光條（橫向光條那種，比芒寬、比較扁） */
  streaks?: { a: number; len: number; w: number; alpha: number }[];
  /** 整體發光：把整顆星芒糊開一份再疊回去（r＝糊開的範圍，R 的比例；a＝強度） */
  bloom?: { r: number; a: number };
};

/** n 條平均分佈的芒，從 off 度開始 */
const even = (n: number, len: number, w: number, off = 0, alpha = 1): BurstRay[] =>
  Array.from({ length: n }, (_, i) => ({ a: off + (360 / n) * i, len, w, alpha }));
/** 十字：直的、橫的可以不一樣長 */
const cross = (v: number, h: number, w: number, alpha = 1): BurstRay[] =>
  [{ a: -90, len: v, w, alpha }, { a: 90, len: v, w, alpha }, { a: 0, len: h, w, alpha }, { a: 180, len: h, w, alpha }];

/* 主人從 31 種裡挑剩的 4 種，加上主人自己調的 6 種（「我的星芒」轉成正式的）。
   排列：越像的放越近 —— 十字類 → 六芒 → 八芒 */
export const STAR_BURSTS: StarBurstSpec[] = [
  { id: 'sb-cross-thin', name: '細長十字', core: .05, glow: .24, rays: cross(1, 1, .03) },
  { id: 'sb-tiny-cross',name: '小十字',core: 0,glow: 0.03,glowAlpha: 0.28,glowConc: 0.6,rays: [{a: -90,len: 0.5,w: 0.015,alpha: 1},{a: 0,len: 0.35,w: 0.015,alpha: 1},{a: 90,len: 0.5,w: 0.015,alpha: 1},{a: 180,len: 0.35,w: 0.015,alpha: 1}],rings: []},
  { id: 'sb-ring-cross',name: '光環十字',core: 0.05,glow: 0.24,glowAlpha: 1,glowConc: 0.2,rays: [{a: -90,len: 1,w: 0.03,alpha: 1},{a: 0,len: 1,w: 0.03,alpha: 1},{a: 90,len: 1,w: 0.03,alpha: 1},{a: 180,len: 1,w: 0.03,alpha: 1}],rings: [{r: 0.37,w: 0.087,alpha: 0.51}]},
  { id: 'sb-ring-soft-cross',name: '光環柔光十字',core: 0,glow: 0.35,glowAlpha: 0.59,glowConc: 0.2,rays: [{a: -90,len: 1,w: 0.028,alpha: 1},{a: 0,len: 0.7,w: 0.028,alpha: 1},{a: 90,len: 1,w: 0.028,alpha: 1},{a: 180,len: 0.7,w: 0.028,alpha: 1}],rings: [{r: 0.24,w: 0.055,alpha: 0.42}]},
  { id: 'sb-six', name: '六芒', core: .05, glow: .24, rays: even(6, .95, .03, 90) },
  { id: 'sb-flat-six',name: '扁六芒',core: 0.05,glow: 0.24,glowAlpha: 1,glowConc: 0.2,rays: [{a: -90,len: 0.95,w: 0.03,alpha: 1},{a: -30,len: 0.6284,w: 0.03,alpha: 1},{a: 30,len: 0.6284,w: 0.03,alpha: 1},{a: 90,len: 0.95,w: 0.03,alpha: 1},{a: 150,len: 0.6284,w: 0.03,alpha: 1},{a: 210,len: 0.6284,w: 0.03,alpha: 1}],rings: []},
  { id: 'sb-ring-six',name: '光環六芒',core: 0.05,glow: 0.24,glowAlpha: 1,glowConc: 0.2,rays: [{a: -90,len: 0.95,w: 0.03,alpha: 1},{a: -30,len: 0.95,w: 0.03,alpha: 1},{a: 30,len: 0.95,w: 0.03,alpha: 1},{a: 90,len: 0.95,w: 0.03,alpha: 1},{a: 150,len: 0.95,w: 0.03,alpha: 1},{a: 210,len: 0.95,w: 0.03,alpha: 1}],rings: [{r: 0.37,w: 0.087,alpha: 0.5}]},
  { id: 'sb-ring-flat-six',name: '光環扁六芒',core: 0.05,glow: 0.24,glowAlpha: 1,glowConc: 0.2,rays: [{a: -90,len: 0.95,w: 0.03,alpha: 1},{a: -30,len: 0.6284,w: 0.03,alpha: 1},{a: 30,len: 0.6284,w: 0.03,alpha: 1},{a: 90,len: 0.95,w: 0.03,alpha: 1},{a: 150,len: 0.6284,w: 0.03,alpha: 1},{a: 210,len: 0.6284,w: 0.03,alpha: 1}],rings: [{r: 0.26,w: 0.047,alpha: 0.43}]},
  { id: 'sb-eight', name: '八芒', core: .055, glow: .25, rays: [...cross(1, 1, .03), ...even(4, .55, .026, 45, .85)] },
  { id: 'sb-eight-even', name: '均勻八芒', core: .055, glow: .25, rays: even(8, .9, .027) },
  { id: 'sb-ring-star8',name: '光環米字',core: 0.055,glow: 0.25,glowAlpha: 1,glowConc: 0.2,rays: [{a: -90,len: 1,w: 0.03,alpha: 1},{a: 0,len: 1,w: 0.03,alpha: 1},{a: 90,len: 1,w: 0.03,alpha: 1},{a: 180,len: 1,w: 0.03,alpha: 1},{a: -45,len: 0.55,w: 0.026,alpha: 0.85},{a: 45,len: 0.55,w: 0.026,alpha: 0.85},{a: 135,len: 0.55,w: 0.026,alpha: 0.85},{a: 225,len: 0.55,w: 0.026,alpha: 0.85}],rings: [{r: 0.37,w: 0.087,alpha: 0.5}]},
  { id: 'sb-halo-eight',name: '光環八芒',core: 0.055,glow: 0.25,glowAlpha: 1,glowConc: 0.2,rays: [{a: -90,len: 0.9,w: 0.027,alpha: 1},{a: -45,len: 0.9,w: 0.027,alpha: 1},{a: 0,len: 0.9,w: 0.027,alpha: 1},{a: 45,len: 0.9,w: 0.027,alpha: 1},{a: 90,len: 0.9,w: 0.027,alpha: 1},{a: 135,len: 0.9,w: 0.027,alpha: 1},{a: 180,len: 0.9,w: 0.027,alpha: 1},{a: 225,len: 0.9,w: 0.027,alpha: 1}],rings: [{r: 0.37,w: 0.087,alpha: 0.5}]},
];


const rgb = (hex: string) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

type Ray = { ux: number; uy: number; L: number; sig: number; a: number; gp: number; gw: number; gd: number };

/** 芒（含細芒、光條）換算成像素座標：R＝框的一半（像素） */
const buildRays = (spec: StarBurstSpec, R: number): Ray[] => {
  const rays: Ray[] = [];
  /* 芒的剖面：高斯，σ 從根部往尖端收細。太細的芒 σ 至少留 0.55px —— 再細就一定鋸齒，
     亮度照比例調低，看起來一樣細但邊緣是柔的。 */
  const addRay = (deg: number, len: number, w: number, a: number, gap?: BurstGap) => {
    if (len <= 0 || w <= 0 || a <= 0) return;
    const t = (deg * Math.PI) / 180, raw = (w * R) / 2;
    const sig = Math.max(raw, .55);
    const gd = gap && gap.depth > 0 && gap.w > 0 ? Math.min(1, gap.depth) : 0;
    rays.push({ ux: Math.cos(t), uy: Math.sin(t), L: len * R, sig, a: a * Math.min(1, Math.sqrt(raw / sig) * 1.05),
      gp: gap?.pos ?? 0, gw: Math.max(.01, gap?.w ?? .1), gd });
  };
  for (const r of spec.rays || []) addRay(r.a, r.len, r.w, r.alpha ?? 1, r.gap);
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
  return rays;
};

/** 這一點 (x,y)（以中心為原點的像素座標）所有芒加起來的亮度 */
const raysAt = (rays: Ray[], x: number, y: number): number => {
  let sum = 0;
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
    let fall = Math.pow(tp, 1.6) * (1 - .25 * (1 - tp));
    // 斷層：在芒的某一段平滑地淡下去再亮回來
    if (ry.gd > 0) { const u = (1 - tp - ry.gp) / ry.gw; fall *= 1 - ry.gd * Math.exp(-u * u); }
    const v = ry.a * fall * lat;
    sum += v;
  }
  return sum;
};

/** 把一種星芒算成 N×N 的圖（N＝框的邊長，實際像素）。回傳的是黑底不透明的光，用 'lighter' 貼上去。 */
const renderSprite = (spec: StarBurstSpec, N: number, color: string): HTMLCanvasElement => {
  const R = N / 2, c = rgb(color);
  const rays = buildRays(spec, R);
  const rings = (spec.rings || []).map(r => ({ r: r.r * R, w: Math.max(.8, r.w * R), a: r.alpha }));
  const hasGlow = !!(spec.core || spec.glow);
  const core = Math.max(.6, (spec.core ?? .05) * R), G = (spec.glow ?? .22) * R, GA = spec.glowAlpha ?? 1;
  // 柔光的衰減指數：集中度 0 → 1（平平地散開），1 → 8（緊貼光核）
  const GP = 1 + 7 * Math.max(0, Math.min(1, spec.glowConc ?? .2));
  // 光環內緣偏暖、外緣偏冷一點點
  const warm = [c[0], c[1] * .96, c[2] * .9], cool = [c[0] * .9, c[1] * .96, c[2]];

  const out = new ImageData(N, N), d = out.data;
  for (let i = 3; i < d.length; i += 4) d[i] = 255;
  /* 先把光用小數存起來（還沒壓高光），整體發光要拿這份糊開再疊回去，最後才一次轉成 8 位元 */
  const LR = new Float32Array(N * N), LG = new Float32Array(N * N), LB = new Float32Array(N * N);
  let seed = 12345;
  const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  /* 像底片那樣平滑地「接近」全白：0.5 以下原樣（暗部、中間調亮度不變），
     再亮就越來越慢地逼近全白 —— 光芯與柔光疊在一起也還分得出層次，
     不會整片死白、把光核撐得很大（亮度 1 → 0.82、2 → 0.98） */
  const tone = (v: number) => v < .5 ? v : .5 + .5 * (1 - Math.exp(-(v - .5) / .5));
  /* 每一種都上下、左右對稱，所以只算左上四分之一，再鏡像到另外三塊（快四倍） */
  const H = Math.ceil(N / 2);
  for (let py = 0; py < H; py++) {
    const y = py + .5 - R;
    for (let px = 0; px < H; px++) {
      const x = px + .5 - R;
      let lr = 0, lg = 0, lb = 0, white = 0;
      const rv = raysAt(rays, x, y);
      lr += rv * c[0]; lg += rv * c[1]; lb += rv * c[2];
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
          if (r < G) { const v = GA * .5 * Math.pow(1 - r / G, GP); lr += v * c[0]; lg += v * c[1]; lb += v * c[2]; }
          const q = r / core;
          if (q < 4) white += GA * Math.exp(-q * q * 1.1);
        }
      }
      // 光核那一點偏白（真的光最亮的地方都是白的）
      lr += white; lg += white; lb += white;
      if (lr <= 0 && lg <= 0 && lb <= 0) continue;
      for (const [qx, qy] of [[px, py], [N - 1 - px, py], [px, N - 1 - py], [N - 1 - px, N - 1 - py]]) {
        const o = qy * N + qx;
        LR[o] = lr; LG[o] = lg; LB[o] = lb;
      }
    }
  }
  /* 整體發光：三次方框模糊（近似高斯）把整顆星芒糊開，乘上強度疊回去 —— 芒的四周會帶一層柔光 */
  if (spec.bloom && spec.bloom.a > 0 && spec.bloom.r > 0) {
    const rad = Math.max(1, Math.round((spec.bloom.r * R) / 2.2));
    const tmp = new Float32Array(N * N);
    const blur = (src: Float32Array) => {
      const a = Float32Array.from(src);
      for (let pass = 0; pass < 3; pass++) {
        for (let y = 0; y < N; y++) {           // 橫向
          let acc = 0; const row = y * N;
          for (let x = -rad; x <= rad; x++) acc += a[row + Math.min(N - 1, Math.max(0, x))];
          for (let x = 0; x < N; x++) {
            tmp[row + x] = acc / (2 * rad + 1);
            acc += a[row + Math.min(N - 1, x + rad + 1)] - a[row + Math.max(0, x - rad)];
          }
        }
        for (let x = 0; x < N; x++) {           // 直向
          let acc = 0;
          for (let y = -rad; y <= rad; y++) acc += tmp[Math.min(N - 1, Math.max(0, y)) * N + x];
          for (let y = 0; y < N; y++) {
            a[y * N + x] = acc / (2 * rad + 1);
            acc += tmp[Math.min(N - 1, y + rad + 1) * N + x] - tmp[Math.max(0, y - rad) * N + x];
          }
        }
      }
      return a;
    };
    /* 糊開之前先把超亮的地方壓到 1：光核本來就過曝，不壓的話它的亮度會被糊成一大片白，
       看起來像光核變大；壓了之後發光只是一層柔柔的光暈 */
    const k = spec.bloom.a * 1.3;
    for (const ch of [LR, LG, LB]) {
      const src = ch.map(v => Math.min(1, v));
      const b = blur(src); for (let i = 0; i < ch.length; i++) ch[i] += b[i] * k;
    }
  }
  /* 存成「黑底、不透明」的光：用 'lighter' 貼上去，黑色（0）等於什麼都不加。
     以前存成「透明度＝亮度」，暗的地方透明度只剩 1～2 階，手機瀏覽器內部預乘時
     把顏色算歪 → 一小塊一小塊的彩色雜點。三個通道共用同一個雜點，也不會有彩色雜訊。 */
  for (let i = 0, o = 0; i < LR.length; i++, o += 4) {
    if (LR[i] <= 0 && LG[i] <= 0 && LB[i] <= 0) continue;
    const n = noise();
    d[o] = Math.min(255, Math.floor(tone(LR[i]) * 255 + n));
    d[o + 1] = Math.min(255, Math.floor(tone(LG[i]) * 255 + n));
    d[o + 2] = Math.min(255, Math.floor(tone(LB[i]) * 255 + n));
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
    mode：'exact' 算精確大小那張；'fast' 拿已經算好、大小最接近的那張縮放頂著（拖大小滑桿時）；
    'draft' 先算三分之一解析度的放大頂著（拖參數滑桿時，每格都是新的星芒，算全尺寸來不及）。 */
export const drawStarBurst = (g: CanvasRenderingContext2D, spec: StarBurstSpec, cx: number, cy: number, size: number, color = '#ffffff', alpha = 1, mode: 'exact' | 'fast' | 'draft' = 'exact') => {
  const cv = (mode === 'fast' && nearestStarBurstSprite(spec, size, color))
    || (mode === 'draft' && size > 120 ? starBurstSprite(spec, size / 3, color) : starBurstSprite(spec, size, color));
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = alpha;
  g.imageSmoothingEnabled = true;
  (g as any).imageSmoothingQuality = 'high';
  g.drawImage(cv, cx - size / 2, cy - size / 2, size, size);
  g.restore();
};

/** 星芒當成 App 裡的「圖片形狀」用：白光的亮度直接變成透明度，RGB 全黑（顏色由圖形自己的顏色上），
    存成 PNG 的 data URL。N 是邊長（像素）。 */
/** 整顆星芒等比例放大／縮小 k 倍（所有長度、粗細、半徑一起乘） */
const scaleSpec = (s: StarBurstSpec, k: number): StarBurstSpec => ({
  ...s,
  ...(s.core !== undefined ? { core: s.core * k } : {}),
  ...(s.glow !== undefined ? { glow: s.glow * k } : {}),
  rays: s.rays?.map(r => ({ ...r, len: r.len * k, w: r.w * k })),
  ...(s.fine ? { fine: { ...s.fine, len: s.fine.len * k, w: s.fine.w * k } } : {}),
  rings: s.rings?.map(r => ({ ...r, r: r.r * k, w: r.w * k })),
  streaks: s.streaks?.map(r => ({ ...r, len: r.len * k, w: r.w * k })),
  ...(s.bloom ? { bloom: { ...s.bloom, r: s.bloom.r * k } } : {}),
});

/** 亮度低過這個就當作看不到了（8 位元的 6 階） */
const EDGE_LEVEL = 6 / 255;
/** 每一顆星芒「整顆」（連淡淡的芒尖、柔光）都收在框的這麼多以內，最外面那一點點再平滑淡到 0 */
const FIT_TARGET = 0.95;
const fitCache = new Map<string, number>();
/** 這顆星芒（原本大小）在 (x,y) 的亮度，座標以框的一半＝R 像素 */
const sampler = (spec: StarBurstSpec, R: number, G?: number) => {
  const rays = buildRays(spec, R);
  const rings = (spec.rings || []).map(r => ({ r: r.r * R, w: Math.max(.8, r.w * R), a: r.alpha }));
  const g = (G ?? (spec.glow ?? .22)) * R;
  const hasGlow = !!(spec.core || g > 0);
  const core = Math.max(.6, (spec.core ?? .05) * R), GA = spec.glowAlpha ?? 1;
  const GP = 1 + 7 * Math.max(0, Math.min(1, spec.glowConc ?? .2));
  return (x: number, y: number) => {
    let v = raysAt(rays, x, y);
    const r = Math.sqrt(x * x + y * y);
    for (const rg of rings) {
      const dd = (r - rg.r) / rg.w;
      if (dd <= -3.2 || dd >= 3.2) continue;
      const win = Math.cos((Math.abs(dd) / 3.2) * Math.PI / 2) ** 2;
      v += rg.a * win * (Math.exp(-1.2 * dd * dd) * .8 + Math.exp(-.3 * dd * dd) * .25);
    }
    if (hasGlow) {
      if (r < g) v += GA * .5 * Math.pow(1 - r / g, GP);
      const q = r / core;
      if (q < 4) v += GA * Math.exp(-q * q * 1.1);
    }
    return v;
  };
};
/** 星芒有長有短（小十字、光環那種看起來就很小），放進 App 時先量「整顆連芒尖」有多大，
   再等比例放大／縮小到剛好收進框裡 —— 每一顆看起來一樣大，選取框也一定整顆包住。 */
const fitScale = (spec: StarBurstSpec): number => {
  let k = fitCache.get(spec.id);
  if (k === undefined) {
    // 在比框大三倍的範圍裡量（框的一半＝60px），找最外面還看得到的那一點
    const R = 60, at = sampler(spec, R);
    let ext = 0;
    for (let y = 0; y < R * 3; y++) for (let x = 0; x < R * 3; x++) {
      const px = x + .5, py = y + .5;
      if (Math.max(px, py) <= ext) continue;
      if (at(px, py) > EDGE_LEVEL) ext = Math.max(px, py);
    }
    k = ext > 0 ? FIT_TARGET / (ext / R) : 1;
    fitCache.set(spec.id, k);
  }
  return k;
};
export const fitStarBurst = (spec: StarBurstSpec): StarBurstSpec => {
  const k = fitScale(spec);
  return Math.abs(k - 1) < 1e-3 ? spec : scaleSpec(spec, k);
};

/** App 裡星芒圖的四周多留這麼多（框的倍數）：芒尖、柔光散到框外也不會被切掉 */
export const GLINT_PAD = 1;

/* App 用的星芒遮罩分兩步：
   ① 芒與光環（調「發光」時不會變的部分）算一次就存起來（只存左上四分之一，其餘鏡像）；
   ② 每次「發光」變了，只重算柔光、光核與壓高光這一步 —— 一個像素只要幾個加減乘除，
      拉滑桿時每一格都跟得上，不必整顆星芒從頭算。 */
type GlintField = { spec: StarBurstSpec; N: number; M: number; F: Float32Array; Fr: Float32Array };
const fieldCache = new Map<string, GlintField>();
const glintField = (base: StarBurstSpec, N: number): GlintField => {
  const key = base.id + '|' + N;
  const hit = fieldCache.get(key);
  if (hit) return hit;
  const spec = scaleSpec(base, fitScale(base));
  const R = N / 2, M = Math.ceil(N * GLINT_PAD / 2) * 2, H = M / 2;
  const rays = buildRays(spec, R);
  const rings = (spec.rings || []).map(r => ({ r: r.r * R, w: Math.max(.8, r.w * R), a: r.alpha }));
  // F：芒＋光環；Fr：只有芒（「縮放II」把芒和其餘部分分成兩層畫）
  const F = new Float32Array(H * H), Fr = new Float32Array(H * H);
  for (let py = 0; py < H; py++) {
    const y = py + .5 - H;
    for (let px = 0; px < H; px++) {
      const x = px + .5 - H;
      let v = raysAt(rays, x, y);
      Fr[py * H + px] = v;
      if (rings.length) {
        const r = Math.sqrt(x * x + y * y);
        for (const rg of rings) {
          const dd = (r - rg.r) / rg.w;
          if (dd <= -3.2 || dd >= 3.2) continue;
          const win = Math.cos((Math.abs(dd) / 3.2) * Math.PI / 2) ** 2;
          v += rg.a * win * (Math.exp(-1.2 * dd * dd) * .8 + Math.exp(-.3 * dd * dd) * .25);
        }
      }
      F[py * H + px] = v;
    }
  }
  const f = { spec, N, M, F, Fr };
  fieldCache.set(key, f);
  return f;
};

/** App 裡星芒遮罩的框邊長（像素） */
export const GLINT_N = 640;
/** 先把這顆星芒「不會變的部分」算好（閒置時呼叫）：點了新增時就只剩最後一步，馬上出現 */
export const warmGlint = (spec: StarBurstSpec) => { if (typeof document !== 'undefined') glintField(spec, GLINT_N); };

/** App 用的遮罩（畫布，rgb 0、亮度當透明度）。框是中間的 N×N，四周多留 GLINT_PAD 倍。
   glow：App 裡「發光」調過的柔光範圍（跟排序工具的「柔光範圍」同一個數，0～80）；沒給＝星芒原本的。
   撐大的倍數一律照原本那顆量 —— 調發光時星芒本身的大小不會跟著跳。 */
/** 柔光最多散到框的這麼多 */
const GLOW_CAP = 0.96;
/* layer：'all' 整顆；'rays' 只有芒；'core' 芒以外的部分（光核、柔光、光環）。
   「縮放II」時把 rays 縮放、core 不動，兩層疊起來就是芒忽長忽短。 */
export const glintMaskCanvas = (base: StarBurstSpec, N = GLINT_N, glow?: number, layer: 'all' | 'rays' | 'core' = 'all'): HTMLCanvasElement => {
  const { spec, M, F: Fall, Fr } = glintField(base, N);
  let F = Fall;
  if (layer === 'rays') F = Fr;
  else if (layer === 'core') { F = new Float32Array(Fall.length); for (let i = 0; i < F.length; i++) F[i] = Fall[i] - Fr[i]; }
  const R = N / 2, H = M / 2, k = fitScale(base);
  /* 調大「發光」時柔光不能散到框外（選取框要整顆包住）：小的時候照原值，
     越接近框邊越慢地逼近框邊（tanh），不會在哪一格突然停住 */
  const G0 = glow === undefined ? (spec.glow ?? .22 * k) : (glow / 100) * k;
  const G = GLOW_CAP * Math.tanh(G0 / GLOW_CAP) * R;
  const hasGlow = layer !== 'rays' && !!(spec.core || G > 0);
  const core = Math.max(.6, (spec.core ?? .05) * R), GA = spec.glowAlpha ?? 1;
  const GP = 1 + 7 * Math.max(0, Math.min(1, spec.glowConc ?? .2));
  const out = new ImageData(M, M), d = out.data;
  let seed = 12345;
  const tone = (v: number) => v < .5 ? v : .5 + .5 * (1 - Math.exp(-(v - .5) / .5));
  for (let py = 0; py < H; py++) {
    const y = py + .5 - H;
    for (let px = 0; px < H; px++) {
      let v = F[py * H + px];
      if (hasGlow) {
        const x = px + .5 - H, r = Math.sqrt(x * x + y * y);
        if (r < G) v += GA * .5 * Math.pow(1 - r / G, GP);
        const q = r / core;
        if (q < 4) v += GA * Math.exp(-q * q * 1.1);
      }
      if (v <= 0) continue;
      /* 最外面那一圈（框的 90%～100%）平滑淡到 0：就算還有一點點光，也不會在框邊被切出一條硬邊 */
      const e = Math.max(Math.abs(px + .5 - H), Math.abs(y)) / R;
      if (e >= 1) continue;
      if (e > .9) { const t = (1 - e) / .1; v *= t * t * (3 - 2 * t); }
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const a = Math.min(255, Math.floor(tone(v) * 255 + seed / 4294967296));
      if (a <= 0) continue;
      const qx = M - 1 - px, qy = M - 1 - py;
      d[(py * M + px) * 4 + 3] = a; d[(py * M + qx) * 4 + 3] = a;
      d[(qy * M + px) * 4 + 3] = a; d[(qy * M + qx) * 4 + 3] = a;
    }
  }
  const cv = document.createElement('canvas');
  cv.width = cv.height = M;
  cv.getContext('2d')!.putImageData(out, 0, 0);
  return cv;
};

export const starBurstMaskURL = (spec0: StarBurstSpec, N = 640): string => {
  const spec = fitStarBurst(spec0);
  const src = renderSprite(spec, N, '#ffffff');
  const g = src.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D;
  const img = g.getImageData(0, 0, N, N), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const a = Math.max(d[i], d[i + 1], d[i + 2]); d[i] = d[i + 1] = d[i + 2] = 0; d[i + 3] = a; }
  const out = document.createElement('canvas'); out.width = out.height = N;
  out.getContext('2d')!.putImageData(img, 0, 0);
  const url = out.toDataURL('image/png');
  src.width = src.height = out.width = out.height = 1;
  return url;
};

/** 這顆星芒有沒有光環（有光環的預設常駐動畫是旋轉，其他是縮放） */
export const glintHasRing = (id: string) => !!STAR_BURSTS.find(b => b.id === id)?.rings?.length;
