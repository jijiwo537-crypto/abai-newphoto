/* 花式排列「一顆一顆分開動」的動畫：測試網站的動畫實驗室與兩個拼圖共用這一份。
   App 裡的做法：動畫進度接在圖形 kind 後面（'fancy-halo!fx-in-seq:0.4200'，見 scoreKindOf），
   畫路徑時（fancyPathD）照這個進度把每一顆星星搬、轉、縮放。一條路徑只能是一個顏色，
   所以「透明度」在 App 裡換成「大小」（變淡＝變小一點），完全透明就不畫。 */
import type { FancyStar } from './fancyShapes';

/* ───────── 每一顆的樣子 ───────── */
export type U = { dx: number; dy: number; s: number; rot: number; a: number; sx?: number;
  /** 吊飾：掛這顆星星的線長出來多少（0～1，從上往下長；沒有＝整條） */
  line?: number };
export const ID: U = { dx: 0, dy: 0, s: 1, rot: 0, a: 1 };
export type Ctx = { stars: FancyStar[]; w: number; h: number; cx: number; cy: number; maxD: number; order: number[]; rank: number[]; kind?: string };
export const clamp = (v: number) => Math.max(0, Math.min(1, v));
const cubic = (p: number) => 1 - Math.pow(1 - clamp(p), 3);
export const smooth = (p: number) => { p = clamp(p); return p * p * (3 - 2 * p); };
const backOut = (p: number) => { p = clamp(p); const c = 1.9; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };
const hash = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
/** 每顆在 0～1 的總進度裡，從 start 開始、花 span 長度跑完自己的那一段 */
const local = (p: number, start: number, span: number) => clamp((p - start) / Math.max(1e-6, span));

export type Anim = { id: string; name: string; kind: 'entry' | 'idle'; fresh: boolean; desc: string;
  /** 新設計的：每一顆各自的樣子 */
  unit?: (i: number, c: Ctx, p: number, t: number) => U;
  /** App 原本就有的：整組一起動（照 App 的 objectMotionFrame） */
  group?: string };

export const ENTRY_DUR = 1.8, HOLD = 1.3, GAP = 0.35;   // 測試網站預覽用的節奏

/* ───────── 新設計：進場 ───────── */
export const ENTRIES: Anim[] = [
  { id: 'fx-in-seq', name: '點亮', kind: 'entry', fresh: true, desc: '照排列的順序一顆接一顆彈出來，每顆帶一點回彈',
    unit: (i, c, p) => { const q = local(p, c.rank[i] / Math.max(1, c.stars.length) * 0.72, 0.28); return { ...ID, s: backOut(q), a: clamp(q * 3) }; } },
  { id: 'fx-in-burst', name: '綻放', kind: 'entry', fresh: true, desc: '全部從中心飛出去，離中心越遠的越晚到、邊飛邊轉',
    unit: (i, c, p) => {
      const st = c.stars[i], d = Math.hypot(st.x - c.cx, st.y - c.cy) / c.maxD, q = cubic(local(p, d * 0.35, 0.65));
      return { dx: (c.cx - st.x) * (1 - q), dy: (c.cy - st.y) * (1 - q), s: 0.3 + 0.7 * q, rot: (1 - q) * 2.4, a: clamp(q * 2.5) };
    } },
  { id: 'fx-in-gather', name: '聚合', kind: 'entry', fresh: true, desc: '從四面八方散落的位置慢慢收攏、歸位',
    unit: (i, c, p) => {
      const ang = hash(i) * Math.PI * 2, dist = (0.45 + hash(i + 9) * 0.5) * Math.max(c.w, c.h), q = smooth(local(p, hash(i + 3) * 0.25, 0.75));
      return { dx: Math.cos(ang) * dist * (1 - q), dy: Math.sin(ang) * dist * (1 - q), s: 1, rot: (1 - q) * (hash(i + 5) - 0.5) * 6, a: clamp(q * 1.6) };
    } },
  { id: 'fx-in-sweep', name: '掃描', kind: 'entry', fresh: true, desc: '一道光從左上掃到右下，掃到的星星先亮一下再縮回原本大小',
    unit: (i, c, p) => {
      const st = c.stars[i], k = (st.x / c.w + st.y / c.h) / 2, q = local(p, k * 0.75, 0.25);
      const s = q <= 0 ? 0 : q < 0.55 ? 1.45 * cubic(q / 0.55) : 1.45 - 0.45 * smooth((q - 0.55) / 0.45);
      return { ...ID, s, a: clamp(q * 4) };
    } },
  { id: 'fx-in-rain', name: '下墜', kind: 'entry', fresh: true, desc: '每顆從上方落下、著地彈一下，左到右錯開',
    unit: (i, c, p) => {
      const st = c.stars[i], q = local(p, (st.x / c.w) * 0.45 + hash(i) * 0.15, 0.4);
      const fall = q < 0.7 ? 1 - Math.pow(q / 0.7, 2) : 0, b = q >= 0.7 ? Math.sin((q - 0.7) / 0.3 * Math.PI) * 0.08 : 0;
      return { dx: 0, dy: -(fall * (st.y + c.h * 0.4)) - b * c.h, s: 1, rot: 0, a: clamp(q * 5) };
    } },
  { id: 'fx-in-twirl', name: '旋轉', kind: 'entry', fresh: true, desc: '每顆在自己的位置從小轉一圈開出來，隨機錯開',
    unit: (i, c, p) => { const q = local(p, hash(i) * 0.55, 0.45), e = backOut(q); return { ...ID, s: e, rot: (1 - cubic(q)) * Math.PI * 2, a: clamp(q * 3) }; } },
  { id: 'fx-in-vortex', name: '螺旋', kind: 'entry', fresh: true, desc: '每顆從中心沿著螺旋轉出去、一圈半後剛好落到自己的位置',
    unit: (i, c, p) => {
      const st = c.stars[i], q = cubic(local(p, c.rank[i] / Math.max(1, c.stars.length) * 0.45, 0.55));
      const R0 = Math.hypot(st.x - c.cx, st.y - c.cy), A0 = Math.atan2(st.y - c.cy, st.x - c.cx), ang = A0 - (1 - q) * Math.PI * 3, rr = R0 * q;
      return { dx: c.cx + Math.cos(ang) * rr - st.x, dy: c.cy + Math.sin(ang) * rr - st.y, s: 0.4 + 0.6 * q, rot: (1 - q) * 3, a: clamp(q * 2.5) };
    } },
  { id: 'fx-in-flip', name: '翻轉', kind: 'entry', fresh: true, desc: '像翻牌一樣，一顆接一顆從側面翻正，由左上翻到右下',
    unit: (i, c, p) => {
      const st = c.stars[i], k = (st.x / c.w + st.y / c.h) / 2, q = local(p, k * 0.6, 0.4);
      return { ...ID, sx: q <= 0 ? 0 : Math.max(0.04, Math.abs(Math.cos((1 - smooth(q)) * Math.PI))), s: 0.85 + 0.15 * smooth(q), a: q <= 0 ? 0 : q < 0.5 ? 0.55 : 1 };
    } },
];
/* ───────── 新設計：常駐 ───────── */
export const IDLES: Anim[] = [
  { id: 'fx-idle-twinkle', name: '閃爍', kind: 'idle', fresh: true, desc: '每顆各自隨機地忽明忽暗、微微縮放，像真的星星',
    unit: (i, _c, _p, t) => { const w = Math.pow((Math.sin(t * (1.6 + hash(i) * 1.8) + hash(i + 7) * 6.28) + 1) / 2, 3); return { ...ID, s: 1 - w * 0.28, a: 1 - w * 0.65 }; } },
  { id: 'fx-idle-ripple', name: '漣漪', kind: 'idle', fresh: true, desc: '一圈一圈從中心往外擴散，經過的星星放大一下',
    unit: (i, c, _p, t) => { const st = c.stars[i], d = Math.hypot(st.x - c.cx, st.y - c.cy) / c.maxD; const w = Math.pow(Math.max(0, Math.cos((d * 1.6 - t * 0.9) * Math.PI * 2)), 6); return { ...ID, s: 1 + w * 0.32 }; } },
  { id: 'fx-idle-shimmer', name: '掃描', kind: 'idle', fresh: true, desc: '一道斜斜的光帶反覆掃過，掃到的星星變大變亮',
    /* 常駐一開始第一道光就從左上角出發；之後每隔一半的距離（0.8）再出發一道（間隔是原本的一半），
       所以畫面上可能同時有兩道 */
    unit: (i, c, _p, t) => {
      const st = c.stars[i], k = (st.x / c.w + st.y / c.h) / 2, q = t * 0.42, last = Math.floor(q / 0.8);
      let w = 0;
      for (let n = Math.max(0, last - 2); n <= last; n++) w = Math.max(w, Math.exp(-Math.pow((k - (q - n * 0.8 - 0.06)) / 0.09, 2)));
      return { ...ID, s: 1 + w * 0.35, rot: w * 0.5, a: 0.72 + w * 0.28 };
    } },
  { id: 'fx-idle-spin', name: '旋轉', kind: 'idle', fresh: true, desc: '每顆在原地自轉，大小不同轉速不同、方向也不一樣',
    unit: (i, _c, _p, t) => ({ ...ID, rot: t * (0.6 + hash(i) * 1.1) * (hash(i + 2) > 0.5 ? 1 : -1) }) },
  { id: 'fx-idle-drift', name: '浮游', kind: 'idle', fresh: true, desc: '每顆各自輕輕繞小圈，大的動得多、小的動得少，有前後層次',
    unit: (i, c, _p, t) => { const st = c.stars[i], amp = st.r * 0.55, w = t * (0.8 + hash(i) * 0.5) + hash(i + 4) * 6.28; return { ...ID, dx: Math.cos(w) * amp, dy: Math.sin(w * 1.3) * amp }; } },
  { id: 'fx-idle-chase', name: '接力', kind: 'idle', fresh: true, desc: '一個亮點照排列順序一直往前跑，像跑馬燈',
    unit: (i, c, _p, t) => { const n = c.stars.length, pos = (t * Math.max(4, n * 0.35)) % n; let d = Math.abs(c.rank[i] - pos); d = Math.min(d, n - d); const w = Math.exp(-d * d / 3); return { ...ID, s: 1 + w * 0.3, a: 0.45 + w * 0.55 }; } },
  { id: 'fx-idle-sway', name: '擺盪', kind: 'idle', fresh: true, desc: '每顆像掛著一樣左右擺，彼此錯開（吊飾最適合）',
    unit: (i, c, _p, t) => { const st = c.stars[i], len = Math.max(st.y, c.h * 0.25), ang = Math.sin(t * 1.6 + hash(i) * 6.28) * 0.12; return { ...ID, dx: Math.sin(ang) * len, dy: (Math.cos(ang) - 1) * len, rot: ang }; } },
  { id: 'fx-idle-wave', name: '律動', kind: 'idle', fresh: true, desc: '星星的大小像波浪一樣從左往右一波一波推過去，位置不動',
    unit: (i, c, _p, t) => { const st = c.stars[i]; return { ...ID, s: 1 + Math.sin((st.x / c.w) * Math.PI * 2 - t * 2.4) * 0.22 }; } },
  { id: 'fx-idle-firefly', name: '螢火', kind: 'idle', fresh: true, desc: '平常是暗暗的，每顆不定時突然亮起來一下再慢慢暗回去，像螢火蟲',
    unit: (i, _c, _p, t) => {
      const per = 2.6 + hash(i) * 2.2, q = ((t + hash(i + 11) * per) % per) / per;
      const w = q < 0.08 ? q / 0.08 : Math.exp(-(q - 0.08) * 7);
      return { ...ID, s: 0.88 + w * 0.3, a: 0.4 + w * 0.6 };
    } },
];

export const ctxOf = (stars: FancyStar[], w: number, h: number, kind?: string): Ctx => {
  const cx = w / 2, cy = h / 2, maxD = Math.max(1, ...stars.map(s => Math.hypot(s.x - cx, s.y - cy)));
  const order = stars.map((_, i) => i), rank = order.slice();
  return { stars, w, h, cx, cy, maxD, order, rank, kind: kind ? kind.split('!')[0].split('@')[0] : undefined };
};
const BY_ID = new Map([...ENTRIES, ...IDLES].map(a => [a.id, a]));
export const isFancyMotion = (id?: string) => !!id && BY_ID.has(id);
export const fancyMotionName = (id: string) => BY_ID.get(id)?.name ?? id;
const fancyMotionNameBase = fancyMotionName;
/** 某個動畫在某個進度（進場 0～1）／時間（常駐，秒）時，每一顆的樣子 */
/* ───────── 進場 → 常駐的過渡 ─────────
   常駐不是一瞬間整組開始動，而是每顆星星照「它進場時出現的順序」一顆一顆醒過來：
   點亮、漩渦照排列順序；綻放、果凍、無從中心往外；掃光、翻牌、流星從左上往右下；星雨、翻轉由左到右；
   升起從下往上、落下從上往下；聚合、旋開、淡入隨機。每顆醒來時常駐的幅度從 0 慢慢長到滿，不會跳。 */
const wakeOrder = (entry: string, i: number, c: Ctx) => {
  const st = c.stars[i], n = Math.max(1, c.stars.length - 1);
  const diag = (st.x / c.w + st.y / c.h) / 2, dist = Math.hypot(st.x - c.cx, st.y - c.cy) / c.maxD;
  switch (entry) {
    case 'fx-in-seq': case 'fx-in-vortex': return c.rank[i] / n;
    case 'fx-in-burst': case 'pop': case 'none': case '': return dist;
    case 'fx-in-sweep': case 'fx-in-flip': case 'spring': return diag;
    case 'fx-in-rain': case 'flip': return st.x / c.w;
    case 'rise': return 1 - st.y / c.h;
    case 'drop': return st.y / c.h;
    case 'spin': return (Math.atan2(st.y - c.cy, st.x - c.cx) / (Math.PI * 2) + 1.25) % 1;
    default: return hash(i + 17);   // 聚合、旋開、淡入：隨機
  }
};
const WAKE_SPREAD = 0.55, WAKE_EACH = 0.6;   // 秒：最後一顆比第一顆晚多少醒、每顆花多久醒完
/** 常駐的幅度（1＝預設）乘上去：把「跟靜止不一樣的那部分」放大縮小 */
const scaleU = (u: U, k: number): U => k === 1 ? u : {
  dx: u.dx * k, dy: u.dy * k, rot: u.rot * k, s: Math.max(0, 1 + (u.s - 1) * k), a: Math.max(0, Math.min(1, 1 + (u.a - 1) * k)),
  ...(u.sx !== undefined ? { sx: 1 + (u.sx - 1) * k } : {}),
};
/* 吊飾專用：星星是掛在線上的，變淡會看到線吊著半透明的星星，很怪 ——
   吊飾的動畫全部不變淡，改用位置、大小、轉動表現（出現前是縮成 0、在框外被切掉、或翻成側面）：
   ‧ 點亮：每顆照順序從上面沿著自己的線垂下來，到底再彈一下
   ‧ 閃爍：每顆不定時「亮一下」＝放大一點、轉一下，再回來
   其他（星雨、旋開、翻牌、流光、跑燈、自轉、擺盪）照原本的動作，只是拿掉變淡 */
const MOBILE_UNIT: Record<string, (i: number, c: Ctx, p: number, t: number) => U> = {
  /* 下墜：星星掛在線上往下掉 —— 越掉越快，到底時被線拉住，只在原地小小地上下晃兩下就停（不是像球一樣大彈跳） */
  'fx-in-rain': (i, c, p) => {
    const st = c.stars[i], q = local(p, (st.x / c.w) * 0.45 + hash(i) * 0.12, 0.43);
    if (q <= 0) return { ...ID, s: 0, line: 0 };
    const FALL = 0.62, from = st.y + st.r * 2.2;
    if (q < FALL) { const e = q / FALL; return { ...ID, dy: -from * (1 - e * e) }; }
    const z = (q - FALL) / (1 - FALL);
    return { ...ID, dy: Math.sin(z * Math.PI * 2.5) * Math.exp(-z * 4.5) * st.r * 0.9 };
  },
  /* 漂浮ll（吊飾的「掃描」那一格）：線的頂端固定，每一條各自一伸一縮、彼此錯開，
     像一串吊飾在輕輕上下彈 —— 不是整組一起往上飄（那是漂浮l） */
  'fx-idle-shimmer': (i, c, _p, t) => ({ ...ID, dy: Math.sin(t * 1.5 - c.rank[i] * 0.75) * c.h * 0.06 }),
  /* 翻牌：每條線照左上→右下的順序，從上往下長出來；長到底的那一刻，星星從側面翻出來 */
  'fx-in-flip': (i, c, p) => {
    const dg = (k: number) => c.stars[k].x / c.w + c.stars[k].y / c.h, all = c.stars.map((_, k) => dg(k));
    const lo = Math.min(...all), hi = Math.max(...all), start = (dg(i) - lo) / Math.max(1e-6, hi - lo) * 0.5;   // 第一條馬上開始
    const g = smooth(local(p, start, 0.3)), q = local(p, start + 0.3, 0.2);
    return { ...ID, line: g, sx: q <= 0 ? 0 : Math.max(0.04, Math.abs(Math.cos((1 - smooth(q)) * Math.PI))), s: q <= 0 ? 0 : 0.85 + 0.15 * smooth(q) };
  },
  'fx-in-seq': (i, c, p) => {
    const st = c.stars[i], q = local(p, c.rank[i] / Math.max(1, c.stars.length) * 0.6, 0.4), e = backOut(q);
    return { ...ID, dy: -(1 - e) * (st.y + st.r * 2.2) };
  },
  'fx-idle-twinkle': (i, _c, _p, t) => {
    const w = Math.pow((Math.sin(t * (1.6 + hash(i) * 1.8) + hash(i + 7) * 6.28) + 1) / 2, 3);
    return { ...ID, s: 1 + w * 0.3, rot: w * 0.45 };
  },
};
// 還沒出現的（原本完全透明）就縮成 0 不畫，其他的一律不透明
const noFade = (u: U): U => (u.a === 1 ? u : u.a <= 0.02 ? { ...u, a: 1, s: 0 } : { ...u, a: 1 });
/** 吊飾進場：星星還沒出現（縮成 0）時，線也還沒有；星星長大時線跟著從上往下長出來 */
const lineFollows = (u: U): U => (u.line !== undefined ? u : { ...u, line: Math.max(0, Math.min(1, u.s * (u.sx ?? 1) * 1.6)) });
/** v：進場是進度（0～1）；常駐是「時間,幅度,真實秒數,進場是哪個」（見 fancyMotionTag） */
export const fancyMotionUnits = (id: string, c: Ctx, v: string | number): U[] | null => {
  const a0 = BY_ID.get(id); if (!a0?.unit) return null;
  const mobile = c.kind === 'fancy-mobile';
  const a: Anim = mobile ? { ...a0, unit: (i, cc, p, t) => { const u = noFade((MOBILE_UNIT[id] || a0.unit!)(i, cc, p, t)); return a0.kind === 'entry' ? lineFollows(u) : u; } } : a0;
  if (a.kind === 'entry') { const p = Number(v) || 0; return c.stars.map((_, i) => a.unit!(i, c, p, 0)); }
  const [t = 0, amp = 1, real = 999, entry = ''] = String(v).split(',').map((x, k) => k === 3 ? x : Number(x)) as [number, number, number, string];
  return c.stars.map((_, i) => {
    /* 醒來用「一開始就有速度」的曲線（先快後慢），不是慢慢起步 —— 慢慢起步看起來就像停了一下 */
    const wx = clamp((real - wakeOrder(entry, i, c) * WAKE_SPREAD) / WAKE_EACH), wake = real >= 99 ? 1 : 1 - (1 - wx) * (1 - wx);
    if (id === 'fx-idle-shimmer') {
      // 流光：光帶一開始就全力掃（第一道立刻出發）；只有「其他星星稍微變暗」慢慢淡進來，不會一下子暗掉
      const u = scaleU(a.unit!(i, c, 1, t), amp);
      return { ...u, a: 1 - (1 - u.a) * wake };
    }
    return scaleU(a.unit!(i, c, 1, t), amp * wake);
  });
};

/** 整串動畫字串（'id:值'，進場和常駐重疊時是 '進場:值;常駐:值'）→ 每顆的樣子（兩個疊起來） */
export const fancyMotionUnitsTag = (tag: string, c: Ctx): U[] | null => {
  let out: U[] | null = null;
  for (const part of tag.split(';')) {
    const [id, v = ''] = part.split(':'), us = fancyMotionUnits(id, c, v);
    if (!us) continue;
    out = !out ? us : out.map((a, i) => {
      const b = us[i];
      return { dx: a.dx + b.dx, dy: a.dy + b.dy, rot: a.rot + b.rot, s: a.s * b.s, a: a.a * b.a,
        ...(a.sx !== undefined || b.sx !== undefined ? { sx: (a.sx ?? 1) * (b.sx ?? 1) } : {}),
        ...(a.line !== undefined || b.line !== undefined ? { line: Math.min(a.line ?? 1, b.line ?? 1) } : {}) };
    });
  }
  return out;
};
/* ───────── 每一種花式排列在 App 裡的動畫（照測試網站選的結果） ─────────
   del＝原有的哪些不要；add＝加入哪些新設計的；def＝新增時預設 */
type KCfg = { delIn: string[]; delIdle: string[]; addIn: string[]; addIdle: string[]; defIn: string; defIdle: string };
const K = (delIn: string, delIdle: string, addIn: string, addIdle: string, defIn: string, defIdle: string): KCfg => ({
  delIn: delIn ? delIn.split(' ') : [], delIdle: delIdle ? delIdle.split(' ') : [],
  addIn: addIn.split(' ').map(x => 'fx-in-' + x), addIdle: addIdle.split(' ').map(x => 'fx-idle-' + x), defIn: 'fx-in-' + defIn, defIdle: 'fx-idle-' + defIdle,
});
export const FANCY_MOTION_CFG: Record<string, KCfg> = {
  'fancy-halo': K('fade spin flip spring', 'grid-wave spin orbit jitter', 'seq sweep twirl flip', 'twinkle shimmer spin chase', 'seq', 'twinkle'),
  'fancy-concentric': K('spring', '', 'seq burst sweep twirl flip', 'twinkle shimmer spin wave', 'sweep', 'shimmer'),
  'fancy-spiral': K('', '', 'seq sweep twirl flip', 'twinkle ripple shimmer chase', 'seq', 'twinkle'),
  'fancy-ring': K('', '', 'seq sweep twirl flip', 'twinkle shimmer spin chase', 'sweep', 'twinkle'),
  'fancy-swirl3': K('spring', '', 'seq burst sweep vortex flip', 'twinkle ripple shimmer spin', 'seq', 'twinkle'),
  'fancy-radial': K('', 'jitter', 'seq sweep twirl flip', 'twinkle shimmer spin chase firefly', 'seq', 'twinkle'),
  'fancy-grid': K('spring', 'spin wobble', 'seq burst sweep twirl flip', 'twinkle ripple shimmer spin chase wave', 'sweep', 'shimmer'),
  'fancy-polka': K('spring', 'spin wobble', 'seq burst sweep twirl flip', 'twinkle ripple shimmer spin wave', 'sweep', 'shimmer'),
  'fancy-boxrandom': K('spring', 'spin wobble', 'seq burst sweep twirl flip', 'twinkle ripple shimmer spin drift chase', 'seq', 'twinkle'),
  'fancy-wand': K('', 'spin wobble', 'seq sweep twirl flip', 'twinkle ripple shimmer spin drift chase', 'seq', 'twinkle'),
  'fancy-mobile': K('pop spin flip spring', 'breathe spin wobble orbit jitter', 'seq rain twirl flip', 'twinkle shimmer spin chase sway', 'rain', 'twinkle'),
  'fancy-constellation': K('', 'spin', 'seq sweep twirl flip', 'twinkle ripple spin drift chase', 'seq', 'twinkle'),
};
const baseKind = (k?: string) => String(k || '').split('!')[0].split('@')[0];
export const fancyMotionCfg = (kind?: string): KCfg | undefined => FANCY_MOTION_CFG[baseKind(kind)];
/** 面板上的進場／常駐清單：原有的（拿掉不要的）在前、新設計的在後 */
/** 某一種貼圖自己的名字（同一個動畫在這一種叫別的名字） */
const KIND_NAMES_OVERRIDE: Record<string, Record<string, string>> = {
  'fancy-mobile': { 'fx-idle-chase': '縮放', 'fx-idle-shimmer': '漂浮' },   // 漂浮跟原本的漂浮同名 → 自動變成漂浮l／漂浮ll
};
export const fancyMotionLists = <T extends { id: string }>(kind: string | undefined, inKinds: T[], idleKinds: T[], make: (id: string, name: string) => T) => {
  const c = fancyMotionCfg(kind); if (!c) return null;
  const ov = KIND_NAMES_OVERRIDE[String(kind || '').split('@')[0]] || {};
  const fancyMotionName = (id: string) => ov[id] ?? fancyMotionNameBase(id);
  /* 同一類裡原有的和新設計的同名（例如兩個「旋轉」）：原有的加「l」、新設計的加「ll」 */
  const dedupe = (old: T[], fresh: string[]) => {
    const oldNames = new Set(old.map(k => (k as any).name));
    const clash = new Set(fresh.map(fancyMotionName).filter(n => oldNames.has(n)));
    return [...old.map(k => clash.has((k as any).name) ? make(k.id, (k as any).name + 'l') : k),
      ...fresh.map(id => make(id, fancyMotionName(id) + (clash.has(fancyMotionName(id)) ? 'll' : '')))];
  };
  return {
    kinds: dedupe(inKinds.filter(k => !c.delIn.includes(k.id)), c.addIn),
    idleKinds: dedupe(idleKinds.filter(k => !c.delIdle.includes(k.id)), c.addIdle),
  };
};
/** 動畫設定 → 這一格要接在 kind 後面的字串（沒有就 undefined） */
/* 起伏：滑桿 50＝原本的 100、滑桿 100＝原本的 150（幅度、速度都是）；其他常駐照原本的刻度（幅度 50、速度 40 是預設） */
const waveOldUi = (ui: number) => ui <= 50 ? ui * 2 : ui + 50;
const effAmp = (id: string, amp: number) => id === 'fx-idle-wave' ? waveOldUi(amp) / 50 : amp / 50;
const effSpeed = (id: string, speed: number) => id === 'fx-idle-wave' ? (20 + waveOldUi((speed * 100 - 20) / 1.6) * 1.6) / 100 / 0.84 : Math.max(0.05, speed) / 0.84;
export const fancyMotionTag = (cfg: { in: string; idle: string; delay: number; dur: number; speed: number; amp?: number }, time: number): string | undefined => {
  const fxIn = isFancyMotion(cfg.in), fxIdle = isFancyMotion(cfg.idle);
  if (!fxIn && !fxIdle) return undefined;
  const inDur = Math.max(0.01, fxIn ? fancyEntryDur(cfg.dur) : cfg.dur);
  const introEnd = cfg.in === 'none' ? 0 : cfg.delay + inDur;
  /* 常駐不等進場整個結束才開始：最後一段（進場的四成、最多 0.6 秒）就先開始醒，
     已經到位的星星直接接著動，中間不會停一下 */
  const idleStart = cfg.in === 'none' ? 0 : introEnd - Math.min(0.6, inDur * 0.4);
  const r = (x: number) => (Math.round(x * 120) / 120).toFixed(4);
  const idleTag = () => {
    const real = Math.max(0, time - idleStart), t = real * effSpeed(cfg.idle, cfg.speed);
    return `${cfg.idle}:${r(t)},${effAmp(cfg.idle, cfg.amp ?? 50).toFixed(3)},${real >= 3 ? 999 : r(real)},${cfg.in}`;
  };
  if (cfg.in !== 'none' && time < introEnd) {
    const inTag = fxIn ? `${cfg.in}:${(Math.round(Math.max(0, Math.min(1, (time - cfg.delay) / inDur)) * 600) / 600).toFixed(4)}` : '';
    const both = fxIdle && time >= idleStart ? (inTag ? `${inTag};${idleTag()}` : idleTag()) : inTag;
    return both || undefined;
  }
  if (!fxIdle) return undefined;
  return idleTag();
};
/** 新設計的進場是一顆一顆錯開的，需要比整組進場長一點才看得清楚（預設速度約 1.8 秒） */
export const fancyEntryDur = (dur: number) => dur * 2.8;
/** 整組動畫（App 原本的那套）要用的設定與時間：新設計的那一半換成「無／靜止」交給 fancyMotionTag 畫；
    進場是新設計的話，原本的常駐要等新進場跑完才開始 */
export const fancyGroupMotion = <C extends { in: string; idle: string; delay: number; dur: number }>(cfg: C, time: number): { cfg: C; time: number } => {
  const fxIn = isFancyMotion(cfg.in), fxIdle = isFancyMotion(cfg.idle);
  let c = cfg, t = time;
  if (fxIn) { const end = cfg.delay + Math.max(0.01, fancyEntryDur(cfg.dur)); c = { ...c, in: 'none', delay: 0 }; t = Math.max(0, time - end); }
  if (fxIdle) c = { ...c, idle: 'none' };
  return { cfg: c, time: t };
};
