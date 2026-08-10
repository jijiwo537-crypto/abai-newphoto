
import { canvasToUrl, revokeUrl } from '../utils/blobUrl';
import { get2dWide } from '../utils/colorSpace';
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { saveDraft as saveToolDraft } from '../utils/toolDraft';
import { Download, RefreshCw, Type, Circle, Heart, Star, Square, Crop, Palette, X, Plus, ChevronLeft, ArrowLeft, RotateCcw, Paintbrush, Eraser, MousePointer, Link, Link2Off, SlidersHorizontal, MoveUp, MoveDown, Copy, Sliders, Trash2, Play, Pause, ImageIcon, Film } from 'lucide-react';
import { Icon } from './Icon';
/* 文字編輯面板直接沿用經典拼圖那一顆 —— 用同一份程式碼，
   才是真正的「100% 一樣」（字體卡片牆、字距、粗體、描邊、發光全都在裡面）。 */
import {
  TextEditorPanel, ImageAdjustPanel,
  /* 圓角／羽化／描邊／發光全部改用經典拼圖那幾支：同一份程式碼，
     連羽化的三次盒狀模糊、發光的距離場都一樣，不會再有兩套外觀。 */
  cornerR, roundRectPath, makeShapeMask, makeGlowCanvas, GLOW_BLUR_UNIT, GLOW_EXTENT,
} from './GridLayoutTool';
import { DEFAULT_FONT, ensureFont, fontStack } from '../utils/fonts';
/* 構圖跟「編輯」「經典拼圖」共用同一個 ComposeStudio */
import { ComposeStudio } from './ComposeStudio';
/* IG 預覽跟經典拼圖共用同一顆元件 —— 同一份程式碼，兩邊不可能有差 */
import { IgPreview } from './IgPreview';
import { DEFAULT_GEO, GeoParams, composeCanvas, isGeoIdentity } from '../utils/compose';
/* 圖片調整走跟「編輯」「經典拼圖」完全同一條像素管線 —— 同一份程式碼，
   所以濾鏡與調節的效果不可能有差。 */
import { PhotoFx, ADJUST_KEYS, applyPhotoFx, hasPhotoFx, loadLut, getLoadedLut } from '../utils/photoFx';
import { SaveButton } from './SaveButton';

// --- 自製極簡單線十字星圖標 ---
const CrossStarIcon = ({ size = 20, strokeWidth = 1.5 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2 Q12 12 2 12 Q12 12 12 22 Q12 12 22 12 Q12 12 12 2" />
  </svg>
);

// --- 自製單線旋渦圖標 ---
const VortexIcon = ({ size = 20, strokeWidth = 2.2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round">
    <path d="M12 2.5a9.5 9.5 0 0 1 9.5 9.5 8.5 8.5 0 0 1-8.5 8.5 7.5 7.5 0 0 1-7.5-7.5 6.5 6.5 0 0 1 6.5-6.5 5.5 5.5 0 0 1 5.5 5.5 4.5 4.5 0 0 1-4.5 4.5 3.5 3.5 0 0 1-3.5-3.5 2.5 2.5 0 0 1 2.5-2.5 1.5 1.5 0 0 1 1.5 1.5" />
  </svg>
);

/** 四周包圍：遮罩把原圖整圈包起來 */
const AROUND = 'mask-around';
/** 四周包圍的預設比例（可以再改，只是一進去先給這個） */
const AROUND_SCALE = 1 / 3;
/** 單邊上限（Safari Mobile 安全值） */
const MAX_FINAL_DIM = 4096;
/** 導出畫布的總像素上限。真正把分頁殺掉的是「面積」不是「邊長」 */
const MAX_EXPORT_PIXELS = 20_000_000;
/** IG 預覽裡「貼文與貼文之間」的間距。頭、尾、中間統一都用這個值 */
const IG_GAP = 14;
/** 動態牆最上面與最下面多留的空間：多一點才滑得舒服 */
const IG_EDGE = 48;
/** 動態影片的長邊上限。1440 已經比手機螢幕還細，再高只是白燒編碼時間 */
const MOTION_MAX_DIM = 1440;
/**
 * 播動畫時「一格」能用掉的像素上限。
 * 靜態時可以放到 56M（反正只烤一次），但動畫一秒要烤 30 次 ——
 * 照那個量級跑，手機的畫布記憶體幾秒內就會被系統回收（閃退回主畫面）。
 * 6M 對應到手機螢幕大約是 2 倍超取樣，正常倍率下完全用得到，
 * 只有「放到很大又同時在播」才會被壓下來。
 */
const MAX_MOTION_PIXELS = 6_000_000;
/**
 * 預覽時「主畫布 + 三張遮罩暫存畫布」加起來的像素預算。
 * 一張畫布是 4 bytes/px，四張加起來就是 ×4 —— 8M 像素等於 128MB，
 * 手機瀏覽器到這個量級就開始被系統回收（就是主人遇到的閃退到主畫面）。
 */
const MAX_PREVIEW_PIXELS = 56_000_000;

/**
 * 這張拼圖在某個「畫布倍率」下，主畫布加三張遮罩暫存畫布總共要幾個像素。
 * 記憶體是四張一起算的 —— 只看主畫布會低估三倍，那正是手機被回收的原因。
 */
const previewPixelsAt = (
  layout: string, bw: number, bh: number, maskScale: number, ps: number, maskCanvases: number,
) => {
  const cs = collageSizeOf(layout, bw, bh, maskScale);
  const md = maskDims(layout, bw, bh, maskScale);
  return (cs.w * cs.h + maskCanvases * md.mw * md.mh) * ps * ps;
};

/** 這個排版下遮罩相對原圖的尺寸；四周包圍時遮罩就是整張輸出畫布 */
const maskDims = (layout: string, bw: number, bh: number, maskScale: number) => {
  if (layout === AROUND) {
    return {
      mw: Math.round(bw * (1 + maskScale * 2)),
      mh: Math.round(bh * (1 + maskScale * 2)),
      padX: Math.round(bw * maskScale),
      padY: Math.round(bh * maskScale),
    };
  }
  return {
    mw: Math.round(bw * (layout.includes('left') || layout.includes('right') ? maskScale : 1)),
    mh: Math.round(bh * (layout.includes('top') || layout.includes('bottom') ? maskScale : 1)),
    padX: 0,
    padY: 0,
  };
};

/** 原圖 w×h 在這個排版下拼完之後，整張畫布有多大 */
const collageSizeOf = (layout: string, w: number, h: number, maskScale: number) => {
  const { mw, mh } = maskDims(layout, w, h, maskScale);
  if (layout === 'mask-bottom' || layout === 'mask-top') return { w, h: h + mh };
  if (layout === 'mask-right' || layout === 'mask-left') return { w: w + mw, h };
  if (layout === AROUND) return { w: mw, h: mh };
  return { w, h };
};

/** 把 id 轉成一個穩定的數字，用來打散順序（同一顆圖案永遠拿同一格，不會閃） */
/** 兩份圖案清單是不是完全一樣（id、位置、所屬側都沒變） */
/* 「畫出來長什麼樣」的指紋：一顆 side:'both' 的圖案跟拆開後的
   image + mask 兩顆畫出來一模一樣，所以要先展開再比。
   對稱鍵按下去只是把同一批圖案換一種存法、畫面完全沒變 ——
   那就不該佔掉一格上一步。 */
const renderKeyOf = (list: any[]) => {
  const out: string[] = [];
  for (const h of list || []) {
    const sides = (h.side || 'both') === 'both' ? ['image', 'mask'] : [h.side];
    for (const sd of sides) out.push(`${sd}|${h.x}|${h.y}|${h.angle ?? ''}|${h.localScale ?? 1}`);
  }
  return out.sort().join(';');
};
const sameHoles = (a: any[], b: any[]) => renderKeyOf(a) === renderKeyOf(b);

/** 物件的指紋。img 是 DOM 元素，不能 JSON —— 用 src 代表它。 */
const objKeyOf = (list: any[]) =>
  (list || []).map(o => JSON.stringify({ ...o, img: undefined, src: o.src || '' })).join(';');

/* ── 連線 ──────────────────────────────────────────────────────────
   只有前六種「單一封閉形狀」的圖案支援：這幾種有明確的中心點，線接上去
   才看得懂。後面那些字符、數字、漩渦連起來只會像亂畫。 */
const LINK_TYPES = ['circle', 'square', 'cross-star', 'heart', 'star', 'flower'];

/**
 * 每個圖案連到「離它最近、而且這一對還沒被連過」的那一個。
 * 例如離 B 最近的是 A，但 A 已經連過 B 了，B 就往下找第二近的 ——
 * 所以同一對不會被連兩次，線也不會疊在一起。
 */
/** 點到線段的最短距離。用來判斷一條連線有沒有壓到別的圖案 */
const segDist = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};

const linkEdges = (list: any[]): [any, any][] => {
  const used = new Set<string>();
  const out: [any, any][] = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const cands = list
      .map((b, j) => ({ b, j, d: Math.hypot(a.x - b.x, a.y - b.y) }))
      .filter(c => c.j !== i)
      .sort((u, v) => u.d - v.d);
    for (const c of cands) {
      const key = i < c.j ? `${i}-${c.j}` : `${c.j}-${i}`;
      if (used.has(key)) continue;
      used.add(key);
      out.push([a, c.b]);
      break;
    }
  }
  return out;
};

const hashId = (id: string) => {
  let x = 0;
  for (let i = 0; i < (id || '').length; i++) x = (x * 31 + id.charCodeAt(i)) >>> 0;
  return x;
};

/* ── 動態 ──────────────────────────────────────────────────────────
   整套動畫是「純函式」：給一個時間 t，算出每個元素當下的
   縮放、位移、旋轉、透明度。畫布只負責照著畫，所以預覽跟輸出
   一定長得一模一樣，也不需要先錄成影片才看得到。 */

/** 動畫的一格：k=縮放倍率，dx/dy=位移（單位是元素自己的大小），rot=角度，a=透明度 */
export type MoFrame = { k: number; dx: number; dy: number; rot: number; a: number };
const FLAT: MoFrame = { k: 1, dx: 0, dy: 0, rot: 0, a: 1 };
const GONE: MoFrame = { k: 0, dx: 0, dy: 0, rot: 0, a: 0 };

const easeOutBack = (p: number) => {
  const c1 = 1.70158, c3 = c1 + 1, q = p - 1;
  return 1 + c3 * q * q * q + c1 * q * q;
};
const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);
const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
const easeOutElastic = (p: number) => {
  if (p <= 0 || p >= 1) return p <= 0 ? 0 : 1;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * c4) + 1;
};
/** 彈跳落地：標準的四段拋物線 */
const easeOutBounce = (p: number) => {
  const n1 = 7.5625, d1 = 2.75;
  if (p < 1 / d1) return n1 * p * p;
  if (p < 2 / d1) return n1 * (p -= 1.5 / d1) * p + 0.75;
  if (p < 2.5 / d1) return n1 * (p -= 2.25 / d1) * p + 0.9375;
  return n1 * (p -= 2.625 / d1) * p + 0.984375;
};

/** 連線的「曲線變速」：同一段時間，線往前長的快慢曲線不一樣 */
export const LINK_EASES: { id: string; name: string; fn: (p: number) => number }[] = [
  { id: 'linear', name: '等速', fn: p => p },
  // 兩頭慢＝中間衝很快、頭尾拖很慢，就是子彈時間那種感覺
  { id: 'ease', name: '子彈時間', fn: easeInOut },
];
export const linkEase = (id: string) => (LINK_EASES.find(e => e.id === id) || LINK_EASES[1]).fn;

/**
 * 進場／離場動畫。第一個是最普通的「淡入」——大部分時候就是要它，
 * 所以放在第一顆，不用每次都往後找。離場用的是同一份清單，只是倒著跑。
 */
export const IN_KINDS: { id: string; name: string }[] = [
  { id: 'none', name: '直接出現' },
  { id: 'pop', name: '果凍' },
  { id: 'fade', name: '淡入' },
  { id: 'rise', name: '由下升起' },
  { id: 'drop', name: '由上落下' },
  { id: 'spin', name: '轉著出現' },
  { id: 'flip', name: '翻轉' },
  // 這兩個是特別做的：一個會落地彈兩下，一個是從側邊甩進來再晃回正
  { id: 'bounce', name: '彈跳落地' },
  { id: 'spring', name: '彈簧' },
];

/** 常駐動畫：進場之後、離場之前一直在動的那一層 */
export const IDLE_KINDS: { id: string; name: string }[] = [
  { id: 'none', name: '靜止' },
  { id: 'float', name: '上下飄' },
  { id: 'sway', name: '左右晃' },
  { id: 'breathe', name: '不規則縮放' },
  { id: 'spin', name: '旋轉' },
  { id: 'wobble', name: '搖擺' },
  { id: 'orbit', name: '繞小圈' },
  // 特別做的：高頻又不規則的細微抖動，像手持鏡頭
  { id: 'jitter', name: '抖動' },
];

/** 進場動畫在進度 p（0～1）時的樣子 */
const inFrame = (kind: string, p: number): MoFrame => {
  if (p <= 0) return GONE;
  if (p >= 1) return FLAT;
  const fade = Math.max(0, Math.min(1, p * 1.6));
  const e = easeOutCubic(p);
  switch (kind) {
    case 'fade':   return { k: 1, dx: 0, dy: 0, rot: 0, a: p };
    case 'rise':   return { k: 1, dx: 0, dy: (1 - e) * 0.9, rot: 0, a: fade };
    case 'drop':   return { k: 1, dx: 0, dy: -(1 - e) * 0.9, rot: 0, a: fade };
    case 'spin':   return { k: e, dx: 0, dy: 0, rot: -(1 - e) * 200, a: fade };
    // 翻轉用「橫向壓扁」模擬（見下面的 inFlipX），不需要真的 3D
    case 'flip':   return { k: 1, dx: 0, dy: 0, rot: 0, a: fade };
    case 'bounce': return { k: 1, dx: 0, dy: -(1 - easeOutBounce(p)) * 1.1, rot: 0, a: Math.min(1, p * 4) };
    /* 彈簧：卡通的壓扁／拉長。前 45% 從上方落下、身體被拉長，
       落地那一下壓扁，再用衰減的振盪彈回原形。
       橫向縮放走 inScaleX，跟縱向反著來 —— 體積看起來才守恆，
       這就是「有彈性」跟「只是縮放」的差別。 */
    case 'spring': {
      const q = 1 - easeOutCubic(Math.min(1, p / 0.45));
      const land = Math.max(0, (p - 0.45) / 0.55);
      const osc = p < 0.45 ? 0 : Math.exp(-land * 4.2) * Math.sin(land * Math.PI * 3);
      const stretch = p < 0.45 ? q * 0.3 : -osc * 0.34;
      return { k: 1 + stretch, dx: 0, dy: -q * 0.75, rot: 0, a: Math.min(1, p * 3) };
    }
    case 'none':   return FLAT;
    default:       return { k: easeOutBack(p), dx: 0, dy: 0, rot: 0, a: fade };   // pop
  }
};
/** 橫向要另外縮放的兩種：翻轉是「只壓 X 軸」，彈簧是「跟 Y 軸反著來」 */
const inFlipX = (kind: string, p: number) => {
  if (p <= 0 || p >= 1) return 1;
  if (kind === 'flip') return Math.max(0.02, Math.abs(Math.cos((1 - easeOutCubic(p)) * Math.PI)));
  if (kind === 'spring') {
    const q = 1 - easeOutCubic(Math.min(1, p / 0.45));
    const land = Math.max(0, (p - 0.45) / 0.55);
    const osc = p < 0.45 ? 0 : Math.exp(-land * 4.2) * Math.sin(land * Math.PI * 3);
    const stretch = p < 0.45 ? q * 0.3 : -osc * 0.34;
    return 1 / Math.max(0.3, 1 + stretch);   // 縱向拉長時橫向就縮，反之亦然
  }
  return 1;
};

/**
 * 常駐動畫在時間 t 的樣子。amp 是幅度（0～100），speed 是快慢倍率。
 * phase 讓每個元素錯開，不然全部一起上下擺會像整片在抖。
 */
const idleFrame = (kind: string, t: number, amp: number, speed: number, phase: number): MoFrame => {
  if (kind === 'none' || amp <= 0) return FLAT;
  const A = amp / 100, w = t * speed + phase;
  switch (kind) {
    case 'float':   return { k: 1, dx: 0, dy: Math.sin(w * 2.0) * A * 0.28, rot: 0, a: 1 };
    case 'sway':    return { k: 1, dx: Math.sin(w * 1.7) * A * 0.28, dy: 0, rot: 0, a: 1 };
    // 兩個不同週期的正弦疊起來 → 縮放看起來不規則、不像節拍器
    case 'breathe': return { k: 1 + (Math.sin(w * 1.9) * 0.62 + Math.sin(w * 3.1 + 1.3) * 0.38) * A * 0.22, dx: 0, dy: 0, rot: 0, a: 1 };
    /* 旋轉是「累積量」不是「來回擺」，所以不能吃 phase ——
       phase 最大 6.28，乘上去等於一開場就先轉掉大半圈，
       那正是主人看到的「開頭莫名其妙轉很多圈」。這裡一律從 0 開始轉。 */
    case 'spin':    return { k: 1, dx: 0, dy: 0, rot: t * speed * A * 90, a: 1 };
    case 'wobble':  return { k: 1, dx: 0, dy: 0, rot: Math.sin(w * 2.4) * A * 22, a: 1 };
    case 'orbit':   return { k: 1, dx: Math.cos(w * 1.6) * A * 0.2, dy: Math.sin(w * 1.6) * A * 0.2, rot: 0, a: 1 };
    /* 抖動：三個互為無理數比的高頻正弦疊起來，永遠不會回到同一個位置，
       所以看起來是真的在抖，不是在打拍子。 */
    case 'jitter':  return {
      k: 1,
      dx: (Math.sin(w * 7.3) + Math.sin(w * 11.72)) * A * 0.05,
      dy: (Math.sin(w * 9.13 + 2.1) + Math.sin(w * 13.31)) * A * 0.05,
      rot: (Math.sin(w * 8.7 + 1.3) + Math.sin(w * 15.1)) * A * 2.4,
      a: 1,
    };
    default:        return FLAT;
  }
};

/* ── 速度 ──────────────────────────────────────────────────────
   面板上調的是「速度 0～100」，內部存的還是秒數。
   用指數對應而不是線性：線性的話中段幾乎感覺不到差別，
   而兩端又變化太劇烈。0 → 10 秒、50 → 1.7 秒、100 → 0.3 秒。 */
/* 滑桿還是 0～100，只是最慢端整個往上收：
   以前 0 對應 10 秒，慢到幾乎看不出在動；現在 0 對應 3.49 秒
   （＝舊刻度的 30 那一格），整條滑桿都落在真的有用的區間裡。 */
const SPEED_SLOW = 3.49, SPEED_FAST = 0.3;
export const durFromSpeed = (sp: number) =>
  SPEED_SLOW * Math.pow(SPEED_FAST / SPEED_SLOW, Math.max(0, Math.min(100, sp)) / 100);
export const speedFromDur = (d: number) =>
  Math.max(0, Math.min(100, Math.round(100 * Math.log(Math.max(1e-4, d) / SPEED_SLOW) / Math.log(SPEED_FAST / SPEED_SLOW))));

/** 一個元素的動態設定 */
export type MoCfg = {
  /** 進場 */
  delay: number; dur: number; in: string;
  /** 常駐 */
  idle: string; amp: number; speed: number;
};
export const MO_DEFAULT: MoCfg = {
  delay: 0, dur: durFromSpeed(70), in: 'pop',
  idle: 'none', amp: 50, speed: 0.9,
};
export const moOf = (o: any): MoCfg => ({ ...MO_DEFAULT, ...(o && o.mo ? o.mo : null) });

/**
 * 把進場 → 常駐 → 離場疊起來。
 * 交棒處用 0.35 秒淡入接上常駐，不然從進場切到常駐會跳一下。
 */
const composeMo = (cfg: MoCfg, t: number, phase: number): MoFrame & { fx: number } => {
  const p = cfg.dur > 0 ? (t - cfg.delay) / cfg.dur : (t >= cfg.delay ? 1 : 0);
  const f = inFrame(cfg.in, Math.max(0, Math.min(1, p)));
  const fx = inFlipX(cfg.in, Math.max(0, Math.min(1, p)));
  if (p < 1) return { ...f, fx };
  const after = t - (cfg.delay + cfg.dur);
  const blend = Math.max(0, Math.min(1, after / 0.35));
  const g = idleFrame(cfg.idle, after, cfg.amp, cfg.speed, phase);
  return {
    k: 1 + (g.k - 1) * blend,
    dx: g.dx * blend, dy: g.dy * blend, rot: g.rot * blend,
    a: 1, fx: 1,
  };
};

/** 這個元素整段動畫在什麼時候結束（排時間軸用） */
const moEnd = (cfg: MoCfg) => cfg.delay + cfg.dur;

const getHoleNumber = (h: any) => {
  if (h && h.randomNumber !== undefined) return h.randomNumber;
  const hash = h && h.id ? h.id.split('').reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0) : 0;
  return hash % 10;
};

/**
 * 用文字畫出來的洞：id → 實際要畫的那個字。
 * 'love'（<3）、'text'（使用者自己打的字）、'random-num'（編號）不是固定的字，
 * 所以不放在這張表裡，由 holeGlyph() 另外處理。
 */
const GLYPH_HOLES: Record<string, string> = {
  flower:   '❋',   // ❋ 原本就有
  vortex:   '🌀',   // 🌀 原本就有
  seagrass: '𓇼',   // 𓇼 海草
  darkstar: '𖤐',   // 𖤐 暗星
  sparkle:  '⊹',   // ⊹ 小閃
  aster:    '᯽',   // ᯽ 星花
};

/** 這個洞是用文字畫的（而不是用路徑畫的）嗎 */
const isTextHole = (t: string) => t === 'text' || t === 'love' || t === 'love3' || t === 'random-num' || t in GLYPH_HOLES;

/** 這個洞實際上要畫出來的字串 */
const holeGlyph = (holeType: string, customText: string, h?: any) =>
  GLYPH_HOLES[holeType]
  ?? (holeType === 'love' ? '<3'
    : holeType === 'love3' ? '<333'
    : holeType === 'random-num' ? `(${getHoleNumber(h)})`
    : customText);

// --- 工具：HSV to HEX 轉換 ---
const hsvToHex = (h: number, s: number, v: number) => {
  s /= 100; v /= 100;
  let f = (n: number, k = (n + h / 60) % 6) => v - v * s * Math.max(Math.min(k, 4 - k, 1), 0);
  const toHex = (x: number) => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(f(5))}${toHex(f(3))}${toHex(f(1))}`.toUpperCase();
};

const hexToHsv = (hex: string) => {
  if (!hex || hex.length < 7) return { h: 0, s: 0, v: 100 };
  let r = parseInt(hex.slice(1, 3), 16) / 255;
  let g = parseInt(hex.slice(3, 5), 16) / 255;
  let b = parseInt(hex.slice(5, 7), 16) / 255;
  let max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, v = max;
  let d = max - min;
  s = max === 0 ? 0 : d / max;
  if (max === min) h = 0;
  else {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), v: Math.round(v * 100) };
};

const drawTextShape = (
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
  const tempCanvas = document.createElement('canvas');
  const pad = Math.ceil(sz * 1.5);
  tempCanvas.width = pad * 2;
  tempCanvas.height = pad * 2;
  const tempCtx = tempCanvas.getContext('2d')!;

  // 1. 在 tempCanvas 上畫純黑色的文字形狀
  tempCtx.fillStyle = '#000000';
  tempCtx.save();
  tempCtx.translate(pad, pad);
  tempCtx.rotate(holeAngle * Math.PI / 180);
  if (holeType === 'love' || holeType === 'love3') {
    // 跟 <3 同一套字體與比例，只是字串長一點
    tempCtx.font = `bold ${sz * 1.05}px "Inter", "Segoe UI", sans-serif`;
    tempCtx.textAlign = 'center';
    tempCtx.textBaseline = 'middle';
    tempCtx.fillText(holeType === 'love3' ? '<333' : '<3', 0, 0);
  } else {
    const renderStr = GLYPH_HOLES[holeType] ?? text;
    tempCtx.font = `500 ${sz}px "Inter", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    tempCtx.textAlign = 'center';
    tempCtx.textBaseline = 'middle';
    tempCtx.fillText(renderStr, 0, 0);
  }
  tempCtx.restore();

  // 2. 如果是填充照片或顏色
  if (!isDestinationOut && fillStyle) {
    tempCtx.save();
    tempCtx.globalCompositeOperation = 'source-in';
    tempCtx.fillStyle = fillStyle;
    tempCtx.translate(pad - cx, pad - cy);
    tempCtx.fillRect(cx - pad, cy - pad, tempCanvas.width, tempCanvas.height);
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

const drawShapePath = (ctx: CanvasRenderingContext2D, type: string, cx: number, cy: number, size: number) => {
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

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  onClose: () => void;
  title: string;
}

// --- 下方內嵌選色器元件 (支援手動輸入色號) ---
/** 韓系拼貼常見的柔和底色，與經典拼圖同一組 */
// 跟經典拼圖用同一組色票（相近的顏色排在一起）：
// 白 → 暖白 → 暖灰 → 奶油 → 米 → 粉 → 黃 → 綠／薄荷／淺青 → 藍 → 紫
const KOREAN_PRESETS = [
  '#FFFFFF', '#FAF6F0', '#EAE6DF', '#F1E7DB', '#E7DACB',
  '#F6DCD8', '#F4C2C2',
  '#F7E9C8', '#FFF1A5',
  '#DCE7DB', '#CBEAD6', '#9BD4C3', '#B8E3D8', '#D2E8E1',
  '#D7E3EF', '#E2DCEC',
];

const ColorPickerEmbedded: React.FC<ColorPickerProps> = ({ color, onChange, onClose, title }) => {
  const [hsv, setHsv] = useState(() => hexToHsv(color));
  const [hexInput, setHexInput] = useState(color);

  useEffect(() => { 
    setHexInput((prev) => {
      if (color.toUpperCase() !== prev.toUpperCase()) {
        setHsv(hexToHsv(color));
        return color.toUpperCase();
      }
      return prev;
    });
  }, [color]);

  const handleHsvChange = (key: string, val: string) => {
    const newHsv = { ...hsv, [key]: Number(val) };
    setHsv(newHsv as any);
    const newHex = hsvToHex(newHsv.h, newHsv.s, newHsv.v);
    setHexInput(newHex);
    onChange(newHex);
  };

  const handleHexInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.toUpperCase();
    if (val.length > 0 && !val.startsWith('#')) val = '#' + val;
    setHexInput(val);
    
    if (/^#[0-9A-F]{6}$/i.test(val)) {
      setHsv(hexToHsv(val));
      onChange(val);
    }
  };

  const handlePresetClick = (p: string) => {
    setHsv(hexToHsv(p));
    setHexInput(p);
    onChange(p);
  };

  // 前段跟經典拼圖同一組色票（相近的顏色排在一起），後段保留原本的灰階
  const PRESET_COLORS = [
    ...KOREAN_PRESETS,
    '#F0F0F0', '#D9D9D9', '#BFBFBF', '#A6A6A6', '#8C8C8C',
    '#737373', '#595959', '#404040', '#262626', '#1A1A1A', '#000000',
  ];

  return (
    <div className="h-full flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex justify-between items-center mb-3">
        <button onClick={onClose} className="flex items-center gap-2 text-[#888] hover:text-white transition-colors">
          <ArrowLeft size={14} />
          <span className="text-[10px] font-bold tracking-widest uppercase">返回</span>
        </button>
        <input
          type="text"
          value={hexInput}
          onChange={handleHexInputChange}
          maxLength={7}
          aria-label="色號"
          className="shrink-0 h-8 w-[86px] bg-[#1A1A1A] border border-[#333] rounded-[7px] px-2 text-white font-mono text-xs outline-none focus:border-white/50"
        />
      </div>
      
      <div className="flex-1 flex flex-col space-y-3">
        <div className="space-y-3">
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center text-[9px] font-bold text-[#666] tracking-tighter uppercase">
              <span>色相</span>
              <span className="text-white/40">{Math.round(hsv.h)}°</span>
            </div>
            <input type="range" min="0" max="360" value={hsv.h} onInput={e => handleHsvChange('h', (e.target as HTMLInputElement).value)} className="designer-color-slider w-full" style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center text-[9px] font-bold text-[#666] tracking-tighter uppercase">
                <span>飽和度</span>
                <span className="text-white/40">{Math.round(hsv.s)}%</span>
              </div>
              <input type="range" min="0" max="100" value={hsv.s} onInput={e => handleHsvChange('s', (e.target as HTMLInputElement).value)} className="designer-color-slider w-full" style={{ background: `linear-gradient(to right, #808080, ${hsvToHex(hsv.h, 100, 100)})` }} />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center text-[9px] font-bold text-[#666] tracking-tighter uppercase">
                <span>明度</span>
                <span className="text-white/40">{Math.round(hsv.v)}%</span>
              </div>
              <input type="range" min="0" max="100" value={hsv.v} onInput={e => handleHsvChange('v', (e.target as HTMLInputElement).value)} className="designer-color-slider w-full" style={{ background: `linear-gradient(to right, #000, ${hsvToHex(hsv.h, hsv.s, 100)})` }} />
            </div>
          </div>
          {/* 韓系拼貼常用色，與經典拼圖同一組 */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar px-0.5 py-0.5 mt-2">
            {KOREAN_PRESETS.map(c => {
              const active = c.toUpperCase() === (color || '').toUpperCase();
              return (
                <button
                  key={c}
                  onClick={() => handlePresetClick(c)}
                  title={c}
                  className={`shrink-0 w-8 h-8 rounded-[7px] transition-all active:scale-90 ${
                    active ? 'border-2 border-white' : 'border border-white/20'
                  }`}
                  style={{ backgroundColor: c }}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

interface CollageToolProps {
  onHome: () => void;
  /** 濾鏡清單，跟「編輯」「經典拼圖」同一份 */
  lutList?: { id: string; name: string; url: string }[];
  initialFile?: File | null;
  onImportNew: () => void;
  /** 接續上次時把存下來的參數餵回來 */
  initialState?: any;
}

export const CollageTool: React.FC<CollageToolProps> = ({ onHome, initialFile, onImportNew, initialState, lutList = [] }) => {
  const [imageState, setImageState] = useState<any>(null);
  const [layout, setLayout] = useState('mask-bottom');
  const [maskScale, setMaskScale] = useState(0.5);
  const [holeType, setHoleType] = useState('star'); 
  const [customText, setCustomText] = useState('Abai'); 
  const [holeSize, setHoleSize] = useState(25); 
  const [sizeJitter, setSizeJitter] = useState(0); 
  const [holeAngle, setHoleAngle] = useState(0);
  /* 連線：每個圖案拉一條極細的線到最近的鄰居。只有前六種圖案支援。
     線跟圖案走同一條路 —— 在遮罩上是挖穿的，在圖片上是遮罩色的實心線。 */
  /** 'none' 沒有線｜'solid' 連線｜'dash' 虛線。兩種線本來就是同一件事，
      只差線型，所以做成一個三態 —— 也就不可能同時打開。 */
  const [linkMode, setLinkMode] = useState<'none' | 'solid' | 'dash'>('none');
  const linkSupported = LINK_TYPES.includes(holeType);
  /* 動態播放中的那一格。不是 state —— 每一格都在動，走 ref 讓 renderToCanvas
     直接讀，才不會每一格都觸發一次 React 重繪。null 代表「不在播動態」。 */
  const animRef = useRef<{
    hole: (h: any, i: number) => MoFrame & { fx: number };
    /** 第 ia 顆與第 ib 顆之間那條線畫到幾成（0～1）。兩端都冒出來之後才會開始 */
    link: (ia: number, ib: number) => number;
    obj: (o: any, i: number) => MoFrame & { fx: number };
  } | null>(null);
  const [holeCount, setHoleCount] = useState(11);
  const [holes, setHoles] = useState<any[]>([]); 
  /* 浮動物件：疊在拼圖最上層的圖片與文字。
     跟「挖洞」完全分開 —— 洞是把遮罩打穿，這些是貼上去的圖層。
     座標一律用「輸出畫布」的座標系（跟遮罩同一套），縮放時再乘上倍率。 */
  const [objects, setObjects] = useState<any[]>([]);
  const objectsRef = useRef<any[]>([]);
  objectsRef.current = objects;
  const [selectedObj, setSelectedObj] = useState<string | null>(null);
  const selectedObjRef = useRef<string | null>(null);
  selectedObjRef.current = selectedObj;
  const objDragRef = useRef<any>(null);
  const objPinchRef = useRef<any>(null);
  /* 每個圖片物件跑完管線之後的成品，快取起來 —— 參數沒變就不重跑。
     key 是「物件 id + 參數指紋」，所以只有動到的那一張會重算。 */
  const objFxCache = useRef<Map<string, { key: string; cv: HTMLCanvasElement }>>(new Map());
  const [fxTick, setFxTick] = useState(0);
  const fxCanvasOf = useCallback((o: any): CanvasImageSource | null => {
    if (!o.img) return null;
    const shape = {
      r: o.imgRadius || 0, f: o.feather || 0,
      sw: o.imgStrokeWidth || 0, sc: o.imgStrokeColor || '#FFFFFF',
      g: o.imgGlow || 0, gc: o.imgGlowColor || '#FFFFFF',
    };
    const hasShape = shape.r || shape.f || shape.sw || shape.g;
    if ((!o.fx || !hasPhotoFx(o.fx)) && !hasShape) return o.img;
    const key = JSON.stringify([o.fx, shape]);
    const hit = objFxCache.current.get(o.id);
    if (hit && hit.key === key) return hit.cv;

    const w0 = o.img.naturalWidth || o.img.width;
    const h0 = o.img.naturalHeight || o.img.height;
    // 上限 1600：物件在畫面上不會比這更大，再高只是白燒記憶體
    const k = Math.min(1, 1600 / Math.max(w0, h0));
    const iw = Math.max(1, Math.round(w0 * k)), ih = Math.max(1, Math.round(h0 * k));
    const base = applyPhotoFx(o.img, iw, ih, o.fx || {});
    if (!hasShape) { objFxCache.current.set(o.id, { key, cv: base }); return base; }

    /* 這一段是經典拼圖 FloatingImageLayer 那條管線的逐段複製（同樣的函式、
       同樣的順序）：先把圖畫進一張「比框大 lw 一圈」的離屏畫布，用
       destination-in 套遮罩（有羽化才用 makeShapeMask 那張三次盒狀模糊的，
       只有圓角就直接填路徑，邊才不會被放大成階梯），描邊沿著外緣描，
       最後才用距離場算光暈墊在底下。

       經典拼圖的描邊／發光是「工作區單位」的絕對粗細（滑桿 0–20，浮動圖片
       的基準長邊是 160）。這裡沒有工作區單位，所以一律換算成「長邊的比例」：
       ×(長邊/160)，剛好等於經典拼圖預設大小那一張的觀感。 */
    const UNIT = Math.max(iw, ih) / 160;
    const lw = shape.sw * UNIT;
    const blurUnit = (shape.g / 20) * GLOW_BLUR_UNIT * UNIT;
    // 留邊固定用「最大強度」算，拖滑桿時邊界才不會每一格都變、圖看起來在抖
    const pad = Math.ceil(
      (shape.g ? GLOW_BLUR_UNIT * GLOW_EXTENT * UNIT : 0) + (shape.sw ? 20 * UNIT : 0) + 2,
    );
    const W = iw + pad * 2, H = ih + pad * 2;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d')!;

    // 描邊往外長，所以形狀那一張要比框大 lw 一圈
    const swid = iw + lw * 2, shgt = ih + lw * 2;
    let shaped: CanvasImageSource = base;
    let drawW = iw, drawH = ih, drawX = (W - iw) / 2, drawY = (H - ih) / 2;
    if (shape.f || shape.r || shape.sw) {
      const off = document.createElement('canvas');
      off.width = Math.max(1, Math.round(swid));
      off.height = Math.max(1, Math.round(shgt));
      const oc = off.getContext('2d')!;
      oc.drawImage(base, lw, lw, iw, ih);
      if (shape.f || shape.r) {
        oc.globalCompositeOperation = 'destination-in';
        if (shape.f) {
          oc.drawImage(makeShapeMask(iw, ih, shape.r, shape.f), lw, lw, iw, ih);
        } else {
          const R = cornerR(shape.r, iw, ih);
          roundRectPath(oc, lw, lw, iw, ih, R, R);
          oc.fillStyle = '#fff';
          oc.fill();
        }
        oc.globalCompositeOperation = 'source-over';
      }
      if (lw > 0) {
        const sr = shape.r ? cornerR(shape.r, iw, ih) + lw / 2 : 0;
        roundRectPath(oc, lw / 2, lw / 2, iw + lw, ih + lw, sr, sr);
        oc.lineWidth = lw;
        oc.lineJoin = 'miter';
        oc.miterLimit = 4;
        oc.strokeStyle = shape.sc;
        oc.stroke();
      }
      shaped = off;
      drawW = off.width; drawH = off.height;
      drawX = (W - swid) / 2; drawY = (H - shgt) / 2;
    }

    if (shape.g) {
      // 光暈本身很平滑，算在有上限的小張上再放大貼回來（跟經典拼圖同一招）
      const gk = Math.min(1, 420 / Math.max(W, H));
      const glow = makeGlowCanvas(
        shaped, W * gk, H * gk, drawX * gk, drawY * gk, drawW * gk, drawH * gk,
        blurUnit * gk, shape.gc,
      );
      c.drawImage(glow, 0, 0, W, H);
    }
    c.drawImage(shaped, drawX, drawY, drawW, drawH);

    /* 留邊在兩個方向都是同樣的畫布像素，但換算成「佔框的比例」時
       長邊與短邊不一樣 —— 兩軸要各自記一份，不然非正方形的圖會被拉扁。 */
    (cv as any).__padX = pad / iw;
    (cv as any).__padY = pad / ih;
    objFxCache.current.set(o.id, { key, cv });
    return cv;
  }, []);
  /** 圖片與遮罩的交界線（畫布座標）。四周包圍是原圖那個框的四條邊。 */
  const seamLinesRef = useRef<() => { xs: number[]; ys: number[] }>(() => ({ xs: [], ys: [] }));

  /** 旋轉之後真正佔的框（外接矩形）。0/180 度就是原本的寬高，90 度會對調。 */
  const aabbOf = (w: number, h: number, rot: number) => {
    const r = ((rot || 0) * Math.PI) / 180;
    const c = Math.abs(Math.cos(r)), s2 = Math.abs(Math.sin(r));
    return { bw: w * c + h * s2, bh: w * s2 + h * c };
  };

  /**
   * 這個位置上「現在剛好對齊」的每一條線。
   * 跟經典拼圖的 pageGuidelinesAt 同一套：吸附只挑最近的一條，
   * 但畫面上要把「當下同時對齊的每一條」都亮出來 —— 置中放大到剛好滿版時，
   * 左右（或上下）兩條會一起亮，而不是只亮一條。
   * edgeOnly：兩指縮放時中心點根本不會動，中線會整趟掛著，所以只畫邊。
   */
  const linesAt = useCallback((cx: number, cy: number, bw: number, bh: number, edgeOnly = false) => {
    const o = getLayoutOffsetsRef.current?.();
    if (!o) return [] as any[];
    const seams = seamLinesRef.current();
    const out: any[] = [];
    const EPS_C = 0.75;   // 中線是精準吸附
    const EPS_E = 0.6;    // 邊只留給次像素捨入；有縫就不該畫線
    const L = cx - bw / 2, R = cx + bw / 2, T = cy - bh / 2, B = cy + bh / 2;
    const xs = [0, o.cw, ...seams.xs];
    const ys = [0, o.ch, ...seams.ys];
    if (!edgeOnly && Math.abs(cx - o.cw / 2) < EPS_C) out.push({ x: o.cw / 2 });
    if (!edgeOnly && Math.abs(cy - o.ch / 2) < EPS_C) out.push({ y: o.ch / 2 });
    for (const v of xs) {
      if (Math.abs(L - v) < EPS_E || Math.abs(R - v) < EPS_E) out.push({ x: v });
      else if (!edgeOnly && seams.xs.includes(v) && Math.abs(cx - v) < EPS_C) out.push({ x: v });
    }
    for (const v of ys) {
      if (Math.abs(T - v) < EPS_E || Math.abs(B - v) < EPS_E) out.push({ y: v });
      else if (!edgeOnly && seams.ys.includes(v) && Math.abs(cy - v) < EPS_C) out.push({ y: v });
    }
    // 同一條線可能被多個來源推進來（例如畫布邊界剛好也是交界）
    const seen = new Set<string>();
    return out.filter(g => {
      const k = (g.x !== undefined ? 'x' : 'y') + Math.round((g.x !== undefined ? g.x : g.y) * 10);
      if (seen.has(k)) return false; seen.add(k); return true;
    });
  }, []);

  /** 把位置吸附到畫布中線／邊界／遮罩交界，並回報要亮哪幾條線 */
  const snapToGuides = useCallback((x0: number, y0: number, w0: number, h0: number, rot = 0, edgeOnly = false) => {
    const offsG = getLayoutOffsetsRef.current?.();
    if (!offsG || !w0 || !h0 || !enableSnappingRef.current) return { x: x0, y: y0, guides: [] as any[] };
    /* 判定一律用「旋轉之後的外接框」—— 轉了 90 度還拿原本的寬高去比，
       線就會亮在離邊緣半個身子的地方。 */
    const { bw, bh } = aabbOf(w0, h0, rot);
    let cx = x0 + w0 / 2, cy = y0 + h0 / 2;
    const snap = Math.max(4, Math.min(offsG.cw, offsG.ch) * 0.012);
    const seams = seamLinesRef.current();
    /**
     * 單軸吸附：候選是「這條線」＋「中心要位移多少才貼上去」。
     *  1. 中心線只跟「物件中心」配對 —— 邊緣碰到中心線不算對齊。
     *  2. 取最近的那一條，不是第一條符合的。
     *  3. 兩條一樣近但要往相反方向拉，就不要動 —— 以前是這一格黏一邊、
     *     下一格黏另一邊，看起來就是在抖。
     */
    const axis = (c0: number, half: number, centre: number, edges: number[], seamList: number[]) => {
      const cands: { d: number }[] = [];
      if (!edgeOnly) cands.push({ d: centre - c0 });
      for (const v of [...edges, ...seamList]) {
        cands.push({ d: v - (c0 - half) });
        cands.push({ d: v - (c0 + half) });
      }
      if (!edgeOnly) for (const v of seamList) cands.push({ d: v - c0 });
      const near = cands.filter(z => Math.abs(z.d) < snap).sort((a, b) => Math.abs(a.d) - Math.abs(b.d));
      if (!near.length) return 0;
      const best = near[0];
      const TIE = Math.max(0.75, snap * 0.06);
      if (near.some(z => Math.abs(Math.abs(z.d) - Math.abs(best.d)) < TIE && Math.abs(z.d - best.d) > TIE)) return 0;
      return best.d;
    };
    cx += axis(cx, bw / 2, offsG.cw / 2, [0, offsG.cw], seams.xs);
    cy += axis(cy, bh / 2, offsG.ch / 2, [0, offsG.ch], seams.ys);
    return { x: cx - w0 / 2, y: cy - h0 / 2, guides: linesAt(cx, cy, bw, bh, edgeOnly) };
  }, [linesAt]);

  /**
   * 兩指縮放時把「倍率」也吸一下：找一個倍率讓外接框的某一邊剛好落在
   * 畫布邊界／遮罩交界上。置中放大時左右（或上下）算出來的倍率是同一個，
   * 所以兩條邊會同時貼上去、兩條線一起亮 —— 這就是經典拼圖捏合時的手感。
   */
  const snapPinchScale = useCallback((k: number, w0: number, h0: number, cx: number, cy: number, rot: number) => {
    const o = getLayoutOffsetsRef.current?.();
    if (!o || !enableSnappingRef.current) return k;
    const seams = seamLinesRef.current();
    const { bw, bh } = aabbOf(w0, h0, rot);
    if (bw < 1 || bh < 1) return k;
    const SNAP = Math.max(4, Math.min(o.cw, o.ch) * 0.012);
    const cands: number[] = [];
    for (const v of [0, o.cw, ...seams.xs]) { cands.push((2 * (cx - v)) / bw); cands.push((2 * (v - cx)) / bw); }
    for (const v of [0, o.ch, ...seams.ys]) { cands.push((2 * (cy - v)) / bh); cands.push((2 * (v - cy)) / bh); }
    let best = Infinity, bestK = k;
    for (const cand of cands) {
      if (!(cand > 0.05) || cand > 8) continue;
      // 換算成「畫面上差幾個像素」再比門檻，倍率本身的差沒有意義
      const px = Math.abs(cand - k) * Math.max(bw, bh) / 2;
      if (px < SNAP && px < best) { best = px; bestK = cand; }
    }
    return best < SNAP ? bestK : k;
  }, []);

  /* ── 構圖：跟「編輯」「經典拼圖」共用同一個 ComposeStudio ──────────────
     套用完把裁切結果 bake 成新的一張圖塞回這個物件，寬度不變、
     高度依新的長寬比重算，並讓中心留在原地。 */
  const [composeState, setComposeState] = useState<{ id: string; img: HTMLImageElement; geo: GeoParams } | null>(null);

  const openComposeFor = useCallback((id: string) => {
    const o = objectsRef.current.find(z => z.id === id);
    if (!o || !o.src) return;
    const el = new Image();
    el.onload = () => setComposeState({ id, img: el, geo: o.geo || DEFAULT_GEO });
    // baked 過就從原圖接續，參數還原成上次的樣子
    el.src = o.origSrc || o.src;
  }, []);

  const applyComposeToObj = useCallback(() => {
    setComposeState(st => {
      if (!st) return null;
      const o = objectsRef.current.find(z => z.id === st.id);
      if (!o) return null;
      const srcUrl = o.origSrc || o.src;
      const finish = (newSrc: string, aspect: number) => {
        const el = new Image();
        el.onload = () => {
          setObjects(prev => prev.map(f => {
            if (f.id !== st.id) return f;
            const nh = Math.max(8, f.w / aspect);
            return { ...f, img: el, src: newSrc, origSrc: srcUrl, geo: st.geo, y: f.y + (f.h - nh) / 2, h: nh };
          }));
          objFxCache.current.delete(st.id);
          setFxTick(n => n + 1);
          setComposeState(null);
        };
        el.src = newSrc;
      };
      const sw = st.img.naturalWidth || st.img.width;
      const sh = st.img.naturalHeight || st.img.height;
      if (isGeoIdentity(st.geo)) { finish(srcUrl, sw / sh); return st; }
      const baked = composeCanvas(st.img, sw, sh, st.geo, 2400);
      baked.toBlob(blob => {
        if (!blob) { setComposeState(null); return; }
        finish(URL.createObjectURL(blob), baked.width / baked.height);
      }, 'image/png');
      return st;
    });
  }, []);

  /** 拖曳物件時亮起來的對齊線（畫布座標） */
  const getLayoutOffsetsRef = useRef<any>(null);
  const [guides, setGuides] = useState<any[]>([]);
  /* 拖形狀滑桿的期間把選取框與工具列收起來 —— 不然圓角／羽化／描邊／發光
     的邊緣變化整個被白框壓住，根本看不出來調到哪。 */
  const [tuningEdge, setTuningEdge] = useState(false);
  /* header 的三個點：對稱與對齊都收在裡面（跟經典拼圖同一套） */
  /* 兩指縮放物件的期間把那排白色鍵收起來 —— 它掛在物件下緣，
     物件一邊變大它就一邊亂跳（經典拼圖也是這樣處理的）。 */
  const [objPinching, setObjPinching] = useState(false);
  /* 圖片編輯頁：一進去工具欄維持原高度（不要往上跳），
     等真的點出滑桿才長高，而且是帶過場動畫地長。 */
  const [objSliderOpen, setObjSliderOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [enableSnapping, setEnableSnapping] = useState(true);
  const enableSnappingRef = useRef(true);
  enableSnappingRef.current = enableSnapping;
  const guidesRef = useRef<any[]>([]);
  const objFileInputRef = useRef<HTMLInputElement>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null); 
  const [colorPickerTarget, setColorPickerTarget] = useState<string | null>(null); 
  const [maskImageState, setMaskImageState] = useState<any>(null);
  const [imageTransform, setImageTransform] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [maskTransform, setMaskTransform] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [activeTab, setActiveTab] = useState('setting');
  /* 圖片編輯頁是自己排好三段式高度的整頁面板：外面不能再包內距，
     footer 也要夠高（5rem 滑桿 ＋ 6rem 工具列 ＋ h-16 分類列 ＋ 分頁列）。 */
  const objEditImage = activeTab === 'objedit' && !colorPickerTarget
    && !!objects.find(o => o.id === selectedObj && o.type === 'image');
  /** 「圖案」頁的左側子分頁：挑圖案／調參數 */
  const [shapeSub, setShapeSub] = useState<'shape' | 'style'>('shape');
  /** 編輯頁的左側子分頁 */
  const [objSub, setObjSub] = useState<'main' | 'style'>('main');
  /* 圖片調整面板的 UI 狀態 —— 跟經典拼圖同一組，只是各自持有，
     這樣兩邊的「停在哪個子分頁」互不干擾。 */
  const [adjustSub, setAdjustSub] = useState<'shape' | 'tune' | 'filter' | 'effect'>('filter');
  const [effectCard, setEffectCard] = useState<string | null>(null);
  const [effectDetail, setEffectDetail] = useState(false);
  const [shapeMenu, setShapeMenu] = useState('root');
  /* 一進編輯頁不預先選好任何工具：滑桿要點下工具鈕才浮出來 */
  const [shapeTool, setShapeTool] = useState('');
  const [tuneTool, setTuneTool] = useState('');
  const [loadingLut, setLoadingLut] = useState<string | null>(null);
  const [lutRevision, setLutRevision] = useState(0);
  const [maskColor, setMaskColor] = useState('#FFF2E6'); 
  const [patternType, setPatternType] = useState('none'); 
  const [dotColor, setDotColor] = useState('#595959'); 
  const [dotSize, setDotSize] = useState(20); 
  const [dotGap, setDotGap] = useState(20);
  const [saveState, setSaveState] = useState<'idle' | 'processing' | 'success'>('idle');
  const [finalImage, setFinalImage] = useState<string | null>(null);
  /** 成品是影片還是圖片 —— 完成頁要換成 <video>，副檔名也不一樣 */
  const [finalIsVideo, setFinalIsVideo] = useState(false);
  /* 成品是 blob 網址：換一張新的之前先回收，離開時也要回收 */
  const finalUrlRef = useRef<string | null>(null);
  /* 離開時晚一點再回收：導出紀錄的縮圖與分享用的檔案都是非同步去讀這個
     網址的，按下儲存後馬上離開的話會來不及讀完。 */
  useEffect(() => () => { const keep = finalUrlRef.current; setTimeout(() => revokeUrl(keep as any), 15000); }, []);
  const [, setForceRender] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textInputWrapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const maskFileInputRef = useRef<HTMLInputElement>(null);
  const dummyCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const baseMaskCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas')); 
  const fullMaskCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas')); 
  const lowerMaskCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  /** 挖穿的洞裡看到的那張底圖。跟上面幾張一樣重複使用，播動畫時才不會一直配置記憶體 */
  const holeBackdropCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  /** 遮罩底稿的快取鑰匙：參數沒變就不重畫那兩張全尺寸畫布 */
  const maskCacheKeyRef = useRef('');
  const activePointers = useRef<Map<number, any>>(new Map());
  /** 動畫頁期間鎖住畫布上的所有互動（handlePointerDown 開頭就會擋掉） */
  const motionLockRef = useRef(false);
  const interactionRef = useRef<any>(null);
  const holesRef = useRef<any[]>([]);
  const [brushMode, setBrushMode] = useState<'off' | 'pen' | 'eraser'>('off');
  const [symmetryEnabled, setSymmetryEnabled] = useState(true);
  const lastDrawPosRef = useRef<{ x: number, y: number } | null>(null);

  useEffect(() => {
    if (patternType === 'none' && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [patternType]);

  // 選中「自訂文字」時，自動把下方的輸入框捲進視野，並在底下留一點空隙
  useEffect(() => {
    if (activeTab !== 'shape' || shapeSub !== 'shape' || holeType !== 'text') return;
    const el = scrollContainerRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      const target = textInputWrapRef.current;
      if (!target) return;
      // 只捲到「輸入框完整露出」為止，不是一路捲到底 ——
      // 捲過頭的話上面那排形狀會整個跑掉，手指要再撥回來
      const need = target.offsetTop + target.offsetHeight - el.clientHeight;
      if (need > el.scrollTop) el.scrollTo({ top: need, behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(id);
  }, [activeTab, shapeSub, holeType]);

  /* 一格上一步 = 圖案 + 浮動物件的整組快照。
     物件的 img 是 DOM 元素，不能走 JSON —— 淺拷貝、img 維持同一個參考。 */
  type Snap = { holes: any[]; objects: any[] };
  const cloneSnap = (sn: Snap): Snap => ({
    holes: (sn.holes || []).map(h => ({ ...h })),
    objects: (sn.objects || []).map(o => ({ ...o, fx: o.fx ? { ...o.fx } : o.fx })),
  });
  const sameSnap = (a: Snap, b: Snap) =>
    !!a && !!b && sameHoles(a.holes, b.holes) && objKeyOf(a.objects) === objKeyOf(b.objects);

  const [historyState, setHistoryState] = useState<{ history: Snap[]; index: number }>({
    history: [{ holes: [], objects: [] }],
    index: 0,
  });
  /** undo/redo 自己造成的狀態變動不能再被記一次 */
  const restoringRef = useRef(false);

  const pushHistory = useCallback((newHoles: any[], newObjects?: any[]) => {
    const snap = cloneSnap({ holes: newHoles, objects: newObjects ?? objectsRef.current });
    setHistoryState(prev => {
      const sliced = prev.history.slice(0, prev.index + 1);
      const current = sliced[sliced.length - 1];
      if (current && sameSnap(current, snap)) return prev;      // 畫面沒變就不記
      const nextHistory = [...sliced, snap].slice(-100);
      return { history: nextHistory, index: nextHistory.length - 1 };
    });
  }, []);

  const resetHistory = useCallback((initialHoles: any[], initialObjects?: any[]) => {
    setHistoryState({
      history: [cloneSnap({ holes: initialHoles, objects: initialObjects ?? objectsRef.current })],
      index: 0,
    });
  }, []);

  const applySnap = (sn: Snap) => {
    restoringRef.current = true;
    setHoles(sn.holes.map(h => ({ ...h })));
    setObjects(sn.objects.map(o => ({ ...o, fx: o.fx ? { ...o.fx } : o.fx })));
    setSelectedTarget(null);
    setSelectedObj(prev => (sn.objects.some(o => o.id === prev) ? prev : null));
    // 下一輪 render 之後才解鎖，中間那幾次 setState 不會被記進歷史
    setTimeout(() => { restoringRef.current = false; }, 0);
  };

  const undo = useCallback(() => {
    if (historyState.index > 0) {
      const prevIndex = historyState.index - 1;
      applySnap(historyState.history[prevIndex]);
      setHistoryState(prev => ({ ...prev, index: prevIndex }));
    }
  }, [historyState]);

  const redo = useCallback(() => {
    if (historyState.index < historyState.history.length - 1) {
      const nextIndex = historyState.index + 1;
      applySnap(historyState.history[nextIndex]);
      setHistoryState(prev => ({ ...prev, index: nextIndex }));
    }
  }, [historyState]);

  useEffect(() => { holesRef.current = holes; }, [holes]);

  /* 物件的新增／刪除／編輯／移動／縮放都要能上一步。
     拖曳與滑桿是連續變動，所以等「停下來 400ms」再記一格 ——
     結果就是只記到鬆手時的那一組參數，中間的過程不會塞滿歷史。 */
  const objHistoryReadyRef = useRef(false);
  useEffect(() => {
    if (!imageState) return;
    if (!objHistoryReadyRef.current) { objHistoryReadyRef.current = true; return; }
    if (restoringRef.current) return;
    const t = setTimeout(() => {
      if (!restoringRef.current) pushHistory(holesRef.current, objectsRef.current);
    }, 400);
    return () => clearTimeout(t);
  }, [objects, imageState, pushHistory]);

  // ---- 跳出應用再回來還在：參數自動存檔 ----
  // 照片本身由 App 那邊存進 IndexedDB（跟其他工具共用一份草稿），
  // 這裡只負責把面板上的設定存起來、以及接續時套回去。
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !initialState) return;
    restoredRef.current = true;
    const st = initialState;
    if (st.layout !== undefined) setLayout(st.layout);
    if (st.maskScale !== undefined) setMaskScale(st.maskScale);
    if (st.holeType !== undefined) setHoleType(st.holeType);
    if (st.customText !== undefined) setCustomText(st.customText);
    if (st.holeSize !== undefined) setHoleSize(st.holeSize);
    if (st.sizeJitter !== undefined) setSizeJitter(st.sizeJitter);
    if (st.holeAngle !== undefined) setHoleAngle(st.holeAngle);
    if (st.holeCount !== undefined) setHoleCount(st.holeCount);
    if (Array.isArray(st.holes)) setHoles(st.holes);
    if (st.maskColor !== undefined) setMaskColor(st.maskColor);
    if (st.patternType !== undefined) setPatternType(st.patternType);
    if (st.dotColor !== undefined) setDotColor(st.dotColor);
    if (st.dotSize !== undefined) setDotSize(st.dotSize);
    if (st.dotGap !== undefined) setDotGap(st.dotGap);
    if (st.symmetryEnabled !== undefined) setSymmetryEnabled(st.symmetryEnabled);
  }, [initialState]);

  useEffect(() => {
    if (!imageState) return;
    const t = setTimeout(() => {
      saveToolDraft('collage', null, {
        layout, maskScale, holeType, customText, holeSize, sizeJitter, holeAngle,
        holeCount, holes, maskColor, patternType, dotColor, dotSize, dotGap, symmetryEnabled,
      });
    }, 1200);
    return () => clearTimeout(t);
  }, [
    imageState, layout, maskScale, holeType, customText, holeSize, sizeJitter, holeAngle,
    holeCount, holes, maskColor, patternType, dotColor, dotSize, dotGap, symmetryEnabled,
  ]);

  useEffect(() => {
    if (initialFile) {
      const e = { target: { files: [initialFile] } } as any;
      handleImageUpload(e);
    }
  }, [initialFile]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    // 這張照片就是草稿要存的那張（回來才接得回去）
    saveToolDraft('collage', url, null);
    const img = new Image();
    img.onload = () => {
      let bw = img.width, bh = img.height;
      const originalW = bw;
      const originalH = bh;
      // Limit working resolution to 1080px for stability
      if (Math.max(bw, bh) > 1080) { 
        const s = 1080 / Math.max(bw, bh); 
        bw *= s; 
        bh *= s; 
      }
      bw = Math.round(bw); bh = Math.round(bh);
      const gs = Math.max(bw, bh) / 1080;
      setImageState({ img, baseW: bw, baseH: bh, originalW, originalH, globalScale: gs });
      setImageTransform({ x: 0, y: 0, w: bw, h: bh });
      setLayout(bh > bw * 1.1 ? 'mask-right' : 'mask-bottom');
      setSelectedTarget(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
    e.target.value = '';
  };

  const handleMaskImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (!imageState) return;
      const { baseW, baseH } = imageState;
      const scale = Math.max(baseW / img.width, baseH / img.height);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      setMaskImageState({ img });
      setMaskTransform({ x: (baseW - w) / 2, y: (baseH - h) / 2, w, h });
      setSelectedTarget(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
    e.target.value = '';
  };

  const handleShapeClick = (id: string) => {
    let nextSize = holeSize;
    if (id === 'cross-star') {
      nextSize = 30;
    } else if (id === 'star') {
      nextSize = 35;
    } else if (id === 'flower') {
      nextSize = 45;
    } else if (id === 'vortex') {
      nextSize = 35;
    } else if (id === 'heart') {
      nextSize = 30;
    } else if (id === 'love') {
      nextSize = 25;
    } else if (id === 'love3') {
      // 字更長，同樣的「大小」值看起來會比較大，所以預設調小一點
      nextSize = 18;
    } else if (id === 'circle') {
      nextSize = 20;
    } else if (id === 'square') {
      nextSize = 15;
    } else if (id === 'random-num') {
      nextSize = 15;
    } else if (id === 'seagrass') {
      nextSize = 40;
    } else if (id === 'darkstar') {
      nextSize = 45;
    } else if (id === 'sparkle') {
      // 字身在字框裡本來就偏小，起始尺寸給大一點才跟其他圖案差不多大
      nextSize = 70;
    } else if (id === 'aster') {
      nextSize = 40;
    } else if (id === 'text') {
      nextSize = 15;
    }
    setHoleSize(nextSize);
    setHoleType(id);
  };

  const generateRandomHoles = useCallback((isInitial: boolean = false, layoutOverride?: string) => {
    if (!imageState) return;
    const { baseW, baseH, globalScale: gs } = imageState;
    const mappedHoleSize = 25 + (holeSize / 100) * 125;
    const s = mappedHoleSize * gs;
    /* 四周包圍時遮罩是整張畫布，圖案就單純隨機灑在整圈上 ——
       這種排版沒有「左右兩塊要對稱」的概念，所以一律 side: 'mask'。 */
    const lay = layoutOverride || layout;
    const around = lay === AROUND;
    /* 邊界安全距離。四周包圍時圖案灑在整張畫布上，只留半個圖案的話
       最外圈會有一半跑到畫面外，所以多留將近一個圖案的餘裕
       —— 但使用者自己拖出去仍然可以（那是刻意的）。 */
    /* 注意：四周包圍時 getHoleSize 會再乘上 (1 + 2×比例) 把圖案補回原本的視覺大小，
       安全距離也必須用「補過之後」的尺寸算，不然邊緣還是會被切到。 */
    const drawnS = around ? s * (1 + maskScale * 2) : s;
    const p = around ? drawnS * 0.75 + 25 * gs : s / 2 + 25 * gs;
    const md = maskDims(lay, baseW, baseH, maskScale);
    const fieldW = around ? md.mw : baseW;
    const fieldH = around ? md.mh : baseH;

    const newHoles = [];
    for (let i = 0; i < holeCount; i++) {
      let att = 0, valid = false, hx = 0, hy = 0;
      while (!valid && att < 500) {
        hx = p + Math.random() * (fieldW - p * 2); hy = p + Math.random() * (fieldH - p * 2); valid = true;
        for (let ex of newHoles) if (Math.hypot(ex.x - hx, ex.y - hy) < s * 1.2) { valid = false; break; }
        att++;
      }
      newHoles.push({
        id: Math.random().toString(36).substr(2, 9), x: hx, y: hy,
        randomFactor: Math.random() * 2 - 1, randomNumber: Math.floor(Math.random() * 10),
        side: around ? 'mask' : (symmetryEnabled ? 'both' : 'image'),
      });
    }
    setHoles(newHoles);
    if (isInitial) {
      resetHistory(newHoles);
    } else {
      pushHistory(newHoles);
    }
  }, [imageState, holeCount, holeSize, sizeJitter, pushHistory, resetHistory, symmetryEnabled, layout, maskScale]);

  /* 對稱鎖定：本來是 header 上的一顆按鈕，現在收進三個點的選單裡。
     邏輯完全沒動 —— 關掉就把 side:'both' 的圖案拆成 image/mask 兩顆，
     開回來就合併；沒改到東西就不佔一格上一步。 */
  const toggleSymmetry = useCallback(() => {
    if (layout === AROUND) return;
    setSymmetryEnabled(prev => {
      const next = !prev;
      if (!next) {
        const decoupled: any[] = [];
        holesRef.current.forEach(h => {
          const side = h.side || 'both';
          if (side === 'both') {
            decoupled.push({ ...h, id: h.id + '_img', side: 'image' });
            decoupled.push({ ...h, id: h.id + '_msk', side: 'mask' });
          } else decoupled.push(h);
        });
        if (sameHoles(decoupled, holesRef.current)) return next;
        setHoles(decoupled);
        setTimeout(() => pushHistory(decoupled), 0);
      } else {
        const combined: any[] = [];
        const seenBaseIds = new Set<string>();
        holesRef.current.forEach(h => {
          const baseId = h.id.replace(/_img$|_msk$/, '');
          if (seenBaseIds.has(baseId)) return;
          combined.push({ ...h, id: baseId, side: 'both' });
          seenBaseIds.add(baseId);
        });
        if (sameHoles(combined, holesRef.current)) return next;
        setHoles(combined);
        setTimeout(() => pushHistory(combined), 0);
      }
      return next;
    });
  }, [layout, pushHistory]);

  useEffect(() => { 
    setSelectedTarget(null);
    generateRandomHoles(true); 
    /* 這裡刻意「不」放 layout：換排版時是在按鈕裡跟 setLayout 同一批更新
       一起重灑的，放進來反而會多跑一輪 —— 那多出來的一格畫面就是
       「新版面配舊座標的圖案」，看起來就是閃一下。 */
  }, [imageState, holeCount]);

  const getLayoutOffsets = useCallback(() => {
    if (!imageState) return null;
    let { baseW: bw, baseH: bh } = imageState;
    const { mw, mh, padX, padY } = maskDims(layout, bw, bh, maskScale);

    if (layout === 'mask-bottom') return { cw: bw, ch: bh + mh, ix: 0, iy: 0, mx: 0, my: bh };
    if (layout === 'mask-top') return { cw: bw, ch: bh + mh, ix: 0, iy: mh, mx: 0, my: 0 };
    if (layout === 'mask-right') return { cw: bw + mw, ch: bh, ix: 0, iy: 0, mx: bw, my: 0 };
    if (layout === 'mask-left') return { cw: bw + mw, ch: bh, ix: mw, iy: 0, mx: 0, my: 0 };
    // 四周包圍：遮罩就是整張畫布，原圖擺正中央
    if (layout === AROUND) return { cw: mw, ch: mh, ix: padX, iy: padY, mx: 0, my: 0 };
    return { cw: bw, ch: bh, ix: 0, iy: 0, mx: 0, my: 0 };
  }, [imageState, layout, maskScale]);
  getLayoutOffsetsRef.current = getLayoutOffsets;

  /* 換排版時畫布的形狀會整個換掉（例如遮罩從下面搬到上面、或變成四周包圍），
     但浮動物件的座標還停在舊畫布上 —— 來回切幾次就會整個跑到畫面外面不見了。
     這裡在畫布尺寸真的變了的時候，把每個物件的「中心」按比例搬到新畫布的
     同一個相對位置，再夾在畫布範圍內。大小不動，手感才不會每切一次就縮一輪。 */
  const prevCanvasRef = useRef<{ cw: number; ch: number } | null>(null);
  useEffect(() => {
    const o = getLayoutOffsets();
    if (!o || !o.cw || !o.ch) return;
    const prev = prevCanvasRef.current;
    prevCanvasRef.current = { cw: o.cw, ch: o.ch };
    if (!prev || (prev.cw === o.cw && prev.ch === o.ch)) return;
    const kx = o.cw / prev.cw, ky = o.ch / prev.ch;
    setObjects(list => {
      if (!list.length) return list;
      return list.map(ob => {
        const cx = Math.min(Math.max((ob.x + ob.w / 2) * kx, 0), o.cw);
        const cy = Math.min(Math.max((ob.y + ob.h / 2) * ky, 0), o.ch);
        return { ...ob, x: cx - ob.w / 2, y: cy - ob.h / 2 };
      });
    });
  }, [getLayoutOffsets]);

  /* 圖片與遮罩的交界：並排的四種各有一條，四周包圍是原圖那個框的四條邊。 */
  seamLinesRef.current = () => {
    const o = getLayoutOffsets();
    if (!o || !imageState) return { xs: [] as number[], ys: [] as number[] };
    const { baseW: bw, baseH: bh } = imageState;
    if (layout === 'mask-bottom') return { xs: [], ys: [bh] };
    if (layout === 'mask-top') return { xs: [], ys: [o.iy] };
    if (layout === 'mask-right') return { xs: [bw], ys: [] };
    if (layout === 'mask-left') return { xs: [o.ix], ys: [] };
    if (layout === AROUND) return { xs: [o.ix, o.ix + bw], ys: [o.iy, o.iy + bh] };
    return { xs: [], ys: [] };
  };

  const getHoleSize = useCallback((h: any) => {
    const gs = imageState?.globalScale || 1;
    const mappedHoleSize = 25 + (holeSize / 100) * 125;
    const baseSize = Math.max(25, mappedHoleSize + (h.randomFactor || 0) * sizeJitter);
    /* 四周包圍的畫布比原圖大 (1 + 2×比例) 倍，但在螢幕上是縮到同樣大小顯示的，
       所以同一個「大小」值畫出來會看起來變小。這裡把那個倍率補回去，
       切過去的瞬間圖案在眼睛裡的大小不會變。 */
    const layoutK = layout === AROUND ? 1 + maskScale * 2 : 1;
    return baseSize * gs * layoutK * (h.localScale || 1);
  }, [holeSize, sizeJitter, imageState?.globalScale, layout, maskScale]);

  const isHoleFullyInsideMask = useCallback((h: any, s: number, maskW: number, maskH: number) => {
    const sz = getHoleSize(h) * s;
    const hx = h.x * s;
    const hy = h.y * s;

    if (isTextHole(holeType)) {
      const tctx = dummyCanvasRef.current.getContext('2d')!;
      tctx.font = `500 ${sz}px system-ui`;
      const renderStr = holeGlyph(holeType, customText, h);
      const tw = tctx.measureText(renderStr).width;
      const th = sz;
      return (
        hx - tw / 2 >= 0 &&
        hx + tw / 2 <= maskW &&
        hy - th / 2 >= 0 &&
        hy + th / 2 <= maskH
      );
    } else {
      const r = sz / 2;
      return (
        hx - r >= 0 &&
        hx + r <= maskW &&
        hy - r >= 0 &&
        hy + r <= maskH
      );
    }
  }, [getHoleSize, holeType, customText]);

  const checkHitHole = useCallback((hx: number, hy: number, h: any, gs: number, offs: any, clickedSide?: 'image' | 'mask') => {
    const s = getHoleSize(h);
    const { mw, mh } = maskDims(layout, imageState.baseW, imageState.baseH, maskScale);

    const side = h.side || 'both';
    if (clickedSide) {
      if (side !== 'both' && side !== clickedSide) {
        return false;
      }
    }

    if (isTextHole(holeType)) {
      const tctx = dummyCanvasRef.current.getContext('2d')!;
      tctx.font = `500 ${s}px system-ui`;
      const renderStr = holeGlyph(holeType, customText, h);
      const tw = tctx.measureText(renderStr).width;
      const th = s;

      const checkInRectImg = (ox: number, oy: number) => (hx >= ox + h.x - tw/2 && hx <= ox + h.x + tw/2 && hy >= oy + h.y - th/2 && hy <= oy + h.y + th/2);
      const checkInRectMask = (ox: number, oy: number) => (hx >= ox + h.x - tw/2 && hx <= ox + h.x + tw/2 && hy >= oy + h.y - th/2 && hy <= oy + h.y + th/2);

      if (clickedSide === 'image') {
        return checkInRectImg(offs.ix, offs.iy);
      } else if (clickedSide === 'mask') {
        return (layout === AROUND || isHoleFullyInsideMask(h, 1, mw, mh)) && checkInRectMask(offs.mx, offs.my);
      }

      const hitImg = (side === 'both' || side === 'image') && checkInRectImg(offs.ix, offs.iy);
      const hitMask = (side === 'both' || side === 'mask') && isHoleFullyInsideMask(h, 1, mw, mh) && checkInRectMask(offs.mx, offs.my);
      return hitImg || hitMask;
    } else {
      const checkInCircleImg = (ox: number, oy: number) => Math.hypot(hx - (h.x + ox), hy - (h.y + oy)) <= s / 2;
      const checkInCircleMask = (ox: number, oy: number) => Math.hypot(hx - (h.x + ox), hy - (h.y + oy)) <= s / 2;

      if (clickedSide === 'image') {
        return checkInCircleImg(offs.ix, offs.iy);
      } else if (clickedSide === 'mask') {
        return (layout === AROUND || isHoleFullyInsideMask(h, 1, mw, mh)) && checkInCircleMask(offs.mx, offs.my);
      }

      const hitImg = (side === 'both' || side === 'image') && checkInCircleImg(offs.ix, offs.iy);
      const hitMask = (side === 'both' || side === 'mask') && isHoleFullyInsideMask(h, 1, mw, mh) && checkInCircleMask(offs.mx, offs.my);
      return hitImg || hitMask;
    }
  }, [getHoleSize, holeType, customText, layout, maskScale, imageState, isHoleFullyInsideMask]);

  const checkHitHoleSegment = useCallback((pA: { x: number, y: number }, pB: { x: number, y: number }, h: any, gs: number, offs: any, clickedSide?: 'image' | 'mask') => {
    const s = getHoleSize(h);
    const getDistToSegment = (px: number, py: number) => {
      const dx = pB.x - pA.x;
      const dy = pB.y - pA.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq === 0) return Math.hypot(px - pA.x, py - pA.y);
      let t = ((px - pA.x) * dx + (py - pA.y) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (pA.x + t * dx), py - (pA.y + t * dy));
    };

    const side = h.side || 'both';
    if (clickedSide) {
      if (side !== 'both' && side !== clickedSide) {
        return false;
      }
    }

    if (isTextHole(holeType)) {
      for (let step = 0; step <= 5; step++) {
        const t = step / 5;
        const hx = pA.x + (pB.x - pA.x) * t;
        const hy = pA.y + (pB.y - pA.y) * t;
        if (checkHitHole(hx, hy, h, gs, offs, clickedSide)) return true;
      }
      return false;
    } else {
      const { mw, mh } = maskDims(layout, imageState.baseW, imageState.baseH, maskScale);

      if (clickedSide === 'image') {
        const dist1 = getDistToSegment(h.x + offs.ix, h.y + offs.iy);
        return dist1 <= s / 2;
      } else if (clickedSide === 'mask') {
        if (!isHoleFullyInsideMask(h, 1, mw, mh)) return false;
        const dist2 = getDistToSegment(h.x + offs.mx, h.y + offs.my);
        return dist2 <= s / 2;
      }

      const dist1 = getDistToSegment(h.x + offs.ix, h.y + offs.iy);
      const hitImg = (side === 'both' || side === 'image') && dist1 <= s / 2;

      let hitMask = false;
      if (isHoleFullyInsideMask(h, 1, mw, mh)) {
        const dist2 = getDistToSegment(h.x + offs.mx, h.y + offs.my);
        hitMask = (side === 'both' || side === 'mask') && dist2 <= s / 2;
      }

      return hitImg || hitMask;
    }
  }, [getHoleSize, holeType, checkHitHole, layout, maskScale, imageState, isHoleFullyInsideMask]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!imageState || !canvasRef.current) return;
    /* 動畫頁是「純預覽」：這時候元素都在動，點下去等於在動畫的某一格上
       抓東西，位置根本對不上。所以整片工作區都不接手勢。 */
    if (motionLockRef.current) return;
    const target = e.target as HTMLElement;
    if (!target || target.closest('.no-pointer-events')) return;
    
    // Check if we already have this pointer to prevent potential browser issues
    if (activePointers.current.has(e.pointerId)) {
      activePointers.current.delete(e.pointerId);
    }
    
    activePointers.current.set(e.pointerId, e); 
    try {
      target.setPointerCapture(e.pointerId);
    } catch (err) {
      // Just ignore if capture fails, some environments are strict
    }
    setForceRender(p => p + 1);
    
    const rect = canvasRef.current.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return;
    
    /* 除掉預覽倍率：畫布可能被畫得比工作解析度更細，但挖洞的座標一律是
       工作解析度，換算時要還原回去，不然放大之後點擊位置會整個偏掉。 */
    const ps = previewScaleRef.current;
    const sx = canvasRef.current.width / rect.width / ps, sy = canvasRef.current.height / rect.height / ps;
    const x = (e.clientX - rect.left) * sx, y = (e.clientY - rect.top) * sy;
    const gs = imageState.globalScale || 1, offs = getLayoutOffsets();

    if (activePointers.current.size === 1) {
      /* 浮動物件優先：它是疊在最上層的圖層，點到它就不該再往下傳給挖洞或筆刷。
         由上往下找（陣列後面的疊在上面）。 */
      if (brushMode === 'off') {
        const list = objectsRef.current;
        for (let i = list.length - 1; i >= 0; i--) {
          const o = list[i];
          const cxo = o.x + o.w / 2, cyo = o.y + o.h / 2;
          const rad = -(o.rot || 0) * Math.PI / 180;
          const dx0 = x - cxo, dy0 = y - cyo;
          const lx = dx0 * Math.cos(rad) - dy0 * Math.sin(rad);
          const ly = dx0 * Math.sin(rad) + dy0 * Math.cos(rad);
          if (Math.abs(lx) <= o.w / 2 && Math.abs(ly) <= o.h / 2) {
            e.stopPropagation();
            setSelectedTarget(null);
            if (selectedObjRef.current === o.id) {
              /* 已經選中的再點一次 → 進編輯頁（跟經典拼圖同樣的手感）；這一下也可以拖。
                 但正在調動態時不換頁 —— 那邊本來就是「一邊看預覽一邊調」，
                 被踢去編輯頁反而要一直切回來。 */
              setActiveTab(t => (t === 'motion' ? t : 'objedit'));
              objDragRef.current = { id: o.id, startX: x, startY: y, ox: o.x, oy: o.y };
            } else {
              /* 還沒選中的物件：這一下只能「點選」，不能順手拖走。
                 放開時沒移動才算選中，移動了就什麼都不做。 */
              objDragRef.current = { id: o.id, startX: x, startY: y, ox: o.x, oy: o.y, selectOnly: true, moved: false };
            }
            return;
          }
        }
        /* 已經選中東西時，就算沒點在它身上，拖曳畫布任何地方也是在移動它
           —— 選中之後整個畫布就是那個物件的操作區，跟經典拼圖一樣。 */
        const cur = objectsRef.current.find(z => z.id === selectedObjRef.current);
        if (cur) {
          e.stopPropagation();
          // fromBlank：這一下沒點在物件身上。放開時若完全沒移動，就當成「點旁邊」取消選取。
          objDragRef.current = { id: cur.id, startX: x, startY: y, ox: cur.x, oy: cur.y, fromBlank: true, moved: false };
          return;
        }
      }
      strokeStartHolesRef.current = holesRef.current;
      // Determine clickedSide
      let clickedSide: 'image' | 'mask' | undefined = undefined;
      if (offs) {
        const { baseW: bw, baseH: bh } = imageState;
        const md = maskDims(layout, bw, bh, maskScale);
        /* 四周包圍是特殊的：遮罩就是整張畫布，圖案可以自由跨進跨出圖片，
           沒有「左邊那塊 / 右邊那塊」的對稱關係。所以整張畫布一律當成
           同一個場（side 'mask'），命中判定與拖曳都用遮罩座標系 ——
           不然點圖片上的圖案會抓不到，抓到遮罩上的又會瞬間跳到圖片座標去。 */
        const around = layout === AROUND;
        const inOriginal = !around && x >= offs.ix && x <= offs.ix + bw && y >= offs.iy && y <= offs.iy + bh;
        const inMask = (around || !inOriginal)
          && x >= offs.mx && x <= offs.mx + md.mw && y >= offs.my && y <= offs.my + md.mh;
        if (inOriginal) clickedSide = 'image';
        else if (inMask) clickedSide = 'mask';
      }

      if (brushMode === 'pen') {
        e.stopPropagation();
        if (offs && clickedSide) {
          const { baseW: bw, baseH: bh } = imageState;
          let localX = -1;
          let localY = -1;
          if (clickedSide === 'image') {
            localX = x - offs.ix;
            localY = y - offs.iy;
          } else if (clickedSide === 'mask') {
            localX = x - offs.mx;
            localY = y - offs.my;
          }

          if (localX >= 0 && localY >= 0) {
            const mappedHoleSize = 25 + (holeSize / 100) * 125;
            const minDistance = mappedHoleSize * 0.75;
            const tooClose = holesRef.current.some(h => {
              const side = h.side || 'both';
              if (side !== 'both' && side !== clickedSide) return false;
              return Math.hypot(localX - h.x, localY - h.y) < minDistance;
            });
            if (!tooClose) {
              const newHole = {
                id: Math.random().toString(36).substr(2, 9),
                x: localX,
                y: localY,
                randomFactor: Math.random() * 2 - 1,
                randomNumber: Math.floor(Math.random() * 10),
                side: layout === AROUND ? clickedSide : (symmetryEnabled ? 'both' : clickedSide)
              };
              const nextHoles = [...holesRef.current, newHole];
              holesRef.current = nextHoles;
              setHoles(nextHoles);
              lastDrawPosRef.current = { x: localX, y: localY };
            }
            interactionRef.current = { type: 'brush_draw', startX: x, startY: y, clickedSide };
          }
        }
        return;
      } else if (brushMode === 'eraser') {
        e.stopPropagation();
        if (offs && clickedSide) {
          const hitHoles = holesRef.current.filter(h => checkHitHole(x, y, h, gs, offs, clickedSide));
          if (hitHoles.length > 0) {
            const hitIds = new Set(hitHoles.map(h => h.id));
            setHoles(prev => prev.filter(h => !hitIds.has(h.id)));
          }
          interactionRef.current = { type: 'brush_erase', lastX: x, lastY: y, startX: x, startY: y, clickedSide };
        }
        return;
      }

      let hitHole = null;
      for (let i = holesRef.current.length - 1; i >= 0; i--) {
        const h = holesRef.current[i];
        if (checkHitHole(x, y, h, gs, offs, clickedSide)) { hitHole = h; break; }
      }

      if (hitHole) {
        e.stopPropagation();
        setSelectedTarget(hitHole.id);
        interactionRef.current = { type: 'move_hole', id: hitHole.id, startX: x, startY: y, initX: hitHole.x, initY: hitHole.y, isClick: true, hitItself: true, clickedSide };
      } else if (selectedTarget) {
        const currentHole = holesRef.current.find(h => h.id === selectedTarget);
        if (currentHole) {
          e.stopPropagation();
          interactionRef.current = { type: 'move_hole', id: selectedTarget, startX: x, startY: y, initX: currentHole.x, initY: currentHole.y, isClick: true, hitItself: false, clickedSide };
        } else {
          setSelectedTarget(null);
        }
      }
    } else if (activePointers.current.size === 2 && selectedObjRef.current) {
      /* 選中物件時兩指是在縮放／旋轉那個物件 —— 不再縮放整個預覽。
         沒選中任何東西時才會落到下面那條「雙指縮放預覽」。 */
      e.stopPropagation();
      objDragRef.current = null;
      const pts2: any[] = Array.from(activePointers.current.values());
      const oo = objectsRef.current.find(z => z.id === selectedObjRef.current);
      if (oo) {
        objPinchRef.current = {
          id: oo.id,
          d0: Math.max(1, Math.hypot(pts2[0].clientX - pts2[1].clientX, pts2[0].clientY - pts2[1].clientY)),
          a0: Math.atan2(pts2[1].clientY - pts2[0].clientY, pts2[1].clientX - pts2[0].clientX) * 180 / Math.PI,
          w0: oo.w, h0: oo.h, size0: oo.size || 0, rot0: oo.rot || 0,
          rotOn: false, rotBias: 0,   // 旋轉的不動區：超過門檻才開始轉
          cx0: oo.x + oo.w / 2, cy0: oo.y + oo.h / 2,
        };
        setObjPinching(true);
      }
    } else if (activePointers.current.size === 2 && selectedTarget) {
      e.stopPropagation();
      const pts: any[] = Array.from(activePointers.current.values());
      const p1 = { x: (pts[0].clientX - rect.left) * sx, y: (pts[0].clientY - rect.top) * sy };
      const p2 = { x: (pts[1].clientX - rect.left) * sx, y: (pts[1].clientY - rect.top) * sy };
      const hole = holesRef.current.find(h => h.id === selectedTarget);
      if (hole) interactionRef.current = { type: 'pinch_hole', id: selectedTarget, startDist: Math.hypot(p1.x - p2.x, p1.y - p2.y) };
    } else if (activePointers.current.size === 2) {
      // 沒選中東西 → 雙指縮放整個預覽
      e.stopPropagation();
      const intr = interactionRef.current;
      // 第一根手指剛剛畫下去的那一下要收回來，不然縮放會順手戳一個洞
      if ((intr?.type === 'brush_draw' || intr?.type === 'brush_erase') && strokeStartHolesRef.current) {
        holesRef.current = strokeStartHolesRef.current;
        setHoles(strokeStartHolesRef.current);
      }
      interactionRef.current = null;
      lastDrawPosRef.current = null;
      const pts: any[] = Array.from(activePointers.current.values());
      const c = stageBox();
      const v = viewTRef.current;
      const mx = (pts[0].clientX + pts[1].clientX) / 2 - c.x;
      const my = (pts[0].clientY + pts[1].clientY) / 2 - c.y;
      viewPinchRef.current = {
        d0: Math.max(1, Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY)),
        k0: v.k,
        cx: (mx - v.tx) / v.k,
        cy: (my - v.ty) / v.k,
      };
    }
  };

  /* ---- 預覽縮放 ------------------------------------------------------------
     自己實作雙指縮放平移。react-zoom-pan-pinch 靠 touch 事件、畫布上的筆刷與
     拖曳靠 pointer 事件，兩者會互搶（美顏那邊也踩過同一個坑）。
     規則：選中挖洞時雙指仍然是縮放那個洞（原本的行為）；沒選中東西時雙指才是
     縮放整個預覽。單指一律維持原本的筆刷／拖曳。                              */
  const stageRef = useRef<HTMLDivElement>(null);
  const [viewT, setViewT] = useState({ k: 1, tx: 0, ty: 0 });
  const viewTRef = useRef(viewT);
  viewTRef.current = viewT;
  const viewPinchRef = useRef<{ d0: number; k0: number; cx: number; cy: number } | null>(null);
  /* 預覽畫布要畫多細。
     工作解析度只有 1080（為了拖曳順），螢幕上又是 CSS transform 放大 ——
     放到 6 倍等於把 1080 拉成 6480，當然糊。
     所以縮放停下來之後，照「螢幕上實際佔幾個裝置像素」重畫一次；
     算得出多少就放到多少，放不到就不讓你再放大（見 maxZoom），
     這樣任何倍率下都是 1 個畫布像素對 1 個裝置像素，不會有糊掉的區間。 */
  const [previewScale, setPreviewScale] = useState(1);
  const previewScaleRef = useRef(1);
  previewScaleRef.current = previewScale;
  /** 播動畫時實際用的倍率（見 MAX_MOTION_PIXELS）。跑不動時會被保險絲往下調 */
  const motionScaleRef = useRef(1);
  /** 上面那個值的上限：畫得動的話會慢慢升回來 */
  const motionScaleCapRef = useRef(1);
  const previewTimer = useRef<number | null>(null);
  /** 畫布在 1 倍時的 CSS 尺寸（放大時直接用它 × 倍率當版面尺寸） */
  const baseCssWRef = useRef(0);
  const [baseCss, setBaseCss] = useState<{ w: number; h: number } | null>(null);
  /** 舞台（工作區）的 CSS 尺寸。動畫頁要靠它算「圖要往上讓多少給播放列」 */
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  /** 第一根手指落下時的挖洞狀態 —— 第二根手指跟上時要把它畫的那一下收回去 */
  const strokeStartHolesRef = useRef<any[] | null>(null);
  const stageBox = () => {
    const el = stageRef.current;
    if (!el) return { x: 0, y: 0, w: 1, h: 1 };
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  };
  const applyView = useCallback((k: number, tx: number, ty: number) => {
    const c = stageBox();
    const kk = Math.max(1, Math.min(maxZoomRef.current, k));
    // 限制平移範圍，免得把圖拖出畫面找不回來
    const mx = Math.max(0, (kk - 1) * c.w * 0.5);
    const my = Math.max(0, (kk - 1) * c.h * 0.5);
    setViewT({ k: kk, tx: Math.max(-mx, Math.min(mx, tx)), ty: Math.max(-my, Math.min(my, ty)) });
  }, []);
  /* 「還能放大到幾倍而不糊」的上限 —— 由記憶體預算反推。
     算不到那麼細就不讓你再放大，所以任何倍率下都是清楚的，
     而且畫布總量永遠壓在預算內（分頁不會被系統回收）。
     這一行由 renderCanvas 算完之後寫進來（那時才知道畫布佔多少 CSS 寬）。 */
  const maxZoomRef = useRef(6);
  /** 這張拼圖在預算內能畫到的最大畫布倍率 */
  const maxPreviewScale = useCallback(() => {
    if (!imageState) return 1;
    // 沒有紋理時暫存畫布只有兩張（底色、挖完洞的）
    const one = previewPixelsAt(layout, imageState.baseW, imageState.baseH, maskScale, 1,
      patternType === 'dot' ? 3 : 2);
    return Math.max(1, Math.sqrt(MAX_PREVIEW_PIXELS / Math.max(1, one)));
  }, [imageState, layout, maskScale, patternType]);
  /* 縮放停下來 160ms 後照倍率重畫。拖曳中刻意不重畫 —— 每一格都重烤一張
     幾百萬像素的圖會直接卡死，而且拖曳中本來就看不出銳利度差別。 */
  useEffect(() => {
    if (!imageState || !canvasRef.current) return;
    if (previewTimer.current) window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => {
      const cs = collageSizeOf(layout, imageState.baseW, imageState.baseH, maskScale);
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const cssW = baseCss ? baseCss.w : baseCssWRef.current;
      if (!cssW || !cs.w) return;
      const budget = maxPreviewScale();
      // 要多少畫布像素才會「一個畫布像素對一個裝置像素」
      /* ×1.35 的超取樣：剛好 1:1 時圖案邊緣的抗鋸齒沒有取樣空間，多給一點
         才是「一載入就已經最清楚」，不用先放大一次才變利。
         而且無條件進位到 0.25，不會被四捨五入往下砍掉那 0.1。 */
      const want = Math.min(budget, Math.max(1, (cssW * viewT.k * dpr * 1.35) / cs.w));
      const snapped = Math.max(1, Math.ceil(want * 4) / 4);   // 取到 0.25，避免一直重畫
      setPreviewScale(prev => (Math.abs(prev - snapped) < 0.01 ? prev : snapped));
      /* 播動畫時另外壓一個上限：一秒烤 30 次，照靜態那個倍率跑會把
         手機的畫布記憶體吃光。正常倍率下這一行不會生效。 */
      const one = previewPixelsAt(layout, imageState.baseW, imageState.baseH, maskScale, 1,
        patternType === 'dot' ? 3 : 2);
      /* 播動畫時用的倍率＝靜態時的倍率，一模一樣 ——
         畫質不因為「正在播」而有任何降級。跟不上的時候改成降格數（見播放迴圈），
         不是降解析度。 */
      motionScaleCapRef.current = snapped;
      motionScaleRef.current = snapped;
    }, 90);
    return () => { if (previewTimer.current) window.clearTimeout(previewTimer.current); };
    /* baseCss 一定要進依賴：第一次算出基準尺寸之前這個 effect 會直接 return，
       而 viewT.k 不會再變 —— 少了它就會永遠停在 previewScale = 1，
       也就是「只有放大過才變清楚」的原因。 */
  }, [viewT.k, imageState, layout, maskScale, maxPreviewScale, baseCss]);

  useEffect(() => {
    if (activeTab !== 'objedit' || adjustSub !== 'filter') return;
    let alive = true;
    (async () => {
      for (const l of lutList) {
        if (!alive) return;
        if (!l.url || getLoadedLut(l.id)) continue;
        await loadLut(l.id, l.url);
        if (!alive) return;
        setLutRevision(n => n + 1);
        setFxTick(t => t + 1);
      }
    })();
    return () => { alive = false; };
  }, [activeTab, adjustSub, lutList]);

  /* 拼圖的形狀一變（換排版、換比例），1 倍時的版面尺寸就不一樣了。
     以前的作法是先把尺寸設成 null、讓 max-w/max-h 自己貼合一次，
     下一格再換成算好的尺寸 —— 中間那一格是「舊比例硬塞進新框」，
     看起來就是被壓一下再彈回來的果凍。
     現在直接照新的排版算出最終尺寸，一步到位，中間沒有過渡狀態。 */
  const sizeSnapRef = useRef(false);
  useEffect(() => {
    setViewT({ k: 1, tx: 0, ty: 0 });
    setPreviewScale(1);
    // 這一次的尺寸變化不要做過場動畫（放大狀態下換排版才不會拉一下）
    sizeSnapRef.current = true;
    const st = stageRef.current;
    if (!st || !imageState) { setBaseCss(null); return; }
    const cs = collageSizeOf(layout, imageState.baseW, imageState.baseH, maskScale);
    const sb = st.getBoundingClientRect();
    const availW = Math.max(1, sb.width - 32), availH = Math.max(1, sb.height - 32);
    if (!(cs.w > 0 && cs.h > 0) || !(availW > 1 && availH > 1)) { setBaseCss(null); return; }
    const f = Math.min(availW / cs.w, availH / cs.h);
    setBaseCss({ w: cs.w * f, h: cs.h * f });
    const t = window.setTimeout(() => { sizeSnapRef.current = false; }, 260);
    return () => window.clearTimeout(t);
  }, [layout, maskScale, imageState]);

  // 換一張圖就把縮放歸零
  const viewResetKeyRef = useRef('');
  useEffect(() => {
    const key = imageState ? `${imageState.baseW}x${imageState.baseH}` : '';
    if (key !== viewResetKeyRef.current) {
      viewResetKeyRef.current = key;
      setViewT({ k: 1, tx: 0, ty: 0 });
      setPreviewScale(1);
      setBaseCss(null);
    }
  }, [imageState]);

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!activePointers.current.has(e.pointerId) || !canvasRef.current || !imageState) return;
    activePointers.current.set(e.pointerId, e);
    const rect = canvasRef.current.getBoundingClientRect();
    const ps = previewScaleRef.current;
    const sx = canvasRef.current.width / rect.width / ps, sy = canvasRef.current.height / rect.height / ps;
    const x = (e.clientX - rect.left) * sx, y = (e.clientY - rect.top) * sy;
    const gs = imageState?.globalScale || 1;
    // 雙指縮放預覽時完全不碰筆刷與拖曳
    // 兩指縮放／旋轉浮動物件
    if (objPinchRef.current && activePointers.current.size >= 2) {
      e.stopPropagation();
      const pts2: any[] = Array.from(activePointers.current.values());
      const pin = objPinchRef.current;
      const dist = Math.max(1, Math.hypot(pts2[0].clientX - pts2[1].clientX, pts2[0].clientY - pts2[1].clientY));
      const ang = Math.atan2(pts2[1].clientY - pts2[0].clientY, pts2[1].clientX - pts2[0].clientX) * 180 / Math.PI;
      let k = Math.max(0.15, Math.min(8, dist / pin.d0));
      /* 旋轉有一段「不動區」：兩指轉不到 ROT_START 度就當成純縮放。
         超過之後把門檻扣掉再開始轉，所以不會在跨過門檻那一瞬間跳一下。
         另外靠近 0/90/180/270 就吸過去 —— 想轉正只要大概轉回去就會自己歸位。 */
      const ROT_START = 8;   // 度：低於這個角度完全不轉
      const ROT_SNAP = 6;    // 度：離直角這麼近就吸正
      const wrap180 = (v: number) => ((v + 180) % 360 + 360) % 360 - 180;
      let dRot = wrap180(ang - pin.a0);
      if (!pin.rotOn) {
        if (Math.abs(dRot) < ROT_START) dRot = 0;
        else { pin.rotOn = true; pin.rotBias = dRot > 0 ? ROT_START : -ROT_START; }
      }
      if (pin.rotOn) dRot -= pin.rotBias;
      let nrot = ((pin.rot0 + dRot) % 360 + 360) % 360;
      const upright = (Math.round(nrot / 90) * 90) % 360;
      if (Math.abs(wrap180(nrot - upright)) < ROT_SNAP) nrot = upright;
      /* 倍率也吸一下：讓外接框的某一邊剛好落在畫布邊界／遮罩交界上。
         置中放大時左右算出來的倍率一樣，所以兩條邊會同時貼上、兩條線一起亮。 */
      k = snapPinchScale(k, pin.w0, pin.h0, pin.cx0, pin.cy0, nrot);
      const nw = pin.w0 * k, nh = pin.h0 * k;
      // 縮放中的對齊線只畫「邊」：中心點整趟都沒動，中線會從頭亮到尾
      const sres = snapToGuides(pin.cx0 - nw / 2, pin.cy0 - nh / 2, nw, nh, nrot, true);
      guidesRef.current = sres.guides;
      setGuides(sres.guides);
      setObjects(prev => prev.map(o => o.id === pin.id
        ? { ...o, w: nw, h: nh, size: pin.size0 ? pin.size0 * k : o.size,
            x: sres.x, y: sres.y, rot: nrot }
        : o));
      return;
    }
    // 拖曳浮動物件
    if (objDragRef.current && activePointers.current.size === 1) {
      e.stopPropagation();
      const d = objDragRef.current;
      if (Math.hypot(x - d.startX, y - d.startY) > 3) d.moved = true;
      if (d.selectOnly) return;   // 還沒選中：這一下不搬東西
      let nx = d.ox + (x - d.startX), ny = d.oy + (y - d.startY);
      /* 對齊線：拖到接近畫布中線或邊界時吸附，並把那條線畫出來。
         門檻用畫布短邊的 1.2%，不管圖多大手感都一樣。 */
      const oNow = objectsRef.current.find(z => z.id === d.id);
      const r2 = snapToGuides(nx, ny, oNow?.w || 0, oNow?.h || 0, oNow?.rot || 0);
      nx = r2.x; ny = r2.y;
      guidesRef.current = r2.guides;
      setGuides(r2.guides);
      setObjects(prev => prev.map(o => o.id === d.id ? { ...o, x: nx, y: ny } : o));
      return;
    }
    if (viewPinchRef.current && activePointers.current.size >= 2) {
      e.stopPropagation();
      const pts: any[] = Array.from(activePointers.current.values());
      const pin = viewPinchRef.current;
      const c = stageBox();
      const dist = Math.max(1, Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY));
      const k = Math.max(1, Math.min(maxZoomRef.current, pin.k0 * (dist / pin.d0)));
      const mx = (pts[0].clientX + pts[1].clientX) / 2 - c.x;
      const my = (pts[0].clientY + pts[1].clientY) / 2 - c.y;
      applyView(k, mx - pin.cx * k, my - pin.cy * k);
      return;
    }
    const intr = interactionRef.current;
    if (!intr) return;

    e.stopPropagation();

    if (Math.hypot(x - intr.startX, y - intr.startY) > 3) intr.isClick = false;

    if (intr.type === 'brush_draw') {
      const offs = getLayoutOffsets();
      if (offs && lastDrawPosRef.current && intr.clickedSide) {
        const { baseW: bw, baseH: bh } = imageState;
        let localX = -1;
        let localY = -1;
        if (intr.clickedSide === 'image') {
          localX = x - offs.ix;
          localY = y - offs.iy;
        } else if (intr.clickedSide === 'mask') {
          localX = x - offs.mx;
          localY = y - offs.my;
        }

        if (localX >= 0 && localY >= 0) {
          const mappedHoleSize = 25 + (holeSize / 100) * 125;
          const minDistance = mappedHoleSize * 0.75;
          const tooClose = holesRef.current.some(h => {
            const side = h.side || 'both';
            if (side !== 'both' && side !== intr.clickedSide) return false;
            return Math.hypot(localX - h.x, localY - h.y) < minDistance;
          });
          if (!tooClose) {
            const newHole = {
              id: Math.random().toString(36).substr(2, 9),
              x: localX,
              y: localY,
              randomFactor: Math.random() * 2 - 1,
              side: layout === AROUND ? intr.clickedSide : (symmetryEnabled ? 'both' : intr.clickedSide)
            };
            const nextHoles = [...holesRef.current, newHole];
            holesRef.current = nextHoles;
            setHoles(nextHoles);
            lastDrawPosRef.current = { x: localX, y: localY };
          }
        }
      }
    } else if (intr.type === 'brush_erase') {
      const offs = getLayoutOffsets();
      if (offs && intr.clickedSide) {
        const pA = { x: intr.lastX ?? intr.startX, y: intr.lastY ?? intr.startY };
        const pB = { x, y };
        const hitHoles = holesRef.current.filter(h => checkHitHoleSegment(pA, pB, h, gs, offs, intr.clickedSide));
        if (hitHoles.length > 0) {
          const hitIds = new Set(hitHoles.map(h => h.id));
          setHoles(prev => prev.filter(h => !hitIds.has(h.id)));
        }
        intr.lastX = x;
        intr.lastY = y;
      }
    } else if (intr.type === 'move_hole') {
      const dx = x - intr.startX;
      const dy = y - intr.startY;
      // 四周包圍時圖案活動範圍是整張畫布，用原圖尺寸夾會把它擠回左上角
      const fld = maskDims(layout, imageState.baseW, imageState.baseH, maskScale);
      const limX = layout === AROUND ? fld.mw : imageState.baseW;
      const limY = layout === AROUND ? fld.mh : imageState.baseH;
      const nx = Math.max(0, Math.min(limX, intr.initX + dx));
      const ny = Math.max(0, Math.min(limY, intr.initY + dy));
      setHoles(prev => prev.map(h => h.id === intr.id ? { ...h, x: nx, y: ny } : h));
    } else if (intr.type === 'pinch_hole') {
      const pts: any[] = Array.from(activePointers.current.values());
      if (pts.length < 2) return;
      const p1 = { x: (pts[0].clientX - rect.left) * sx, y: (pts[0].clientY - rect.top) * sy };
      const p2 = { x: (pts[1].clientX - rect.left) * sx, y: (pts[1].clientY - rect.top) * sy };
      const scale = Math.hypot(p1.x - p2.x, p1.y - p2.y) / intr.startDist;
      setHoles(prev => prev.map(h => h.id === intr.id ? { ...h, localScale: Math.max(0.2, Math.min(10, (h.localScale || 1) * scale)) } : h));
      // Update start distance to allow continuous pinch
      intr.startDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    // 點在物件以外的地方、而且完全沒有拖動 → 取消選取
    if (objDragRef.current?.fromBlank && !objDragRef.current.moved) setSelectedObj(null);
    // 還沒選中的物件：只有「點下去沒移動」才算選中，拖了就當作沒發生
    if (objDragRef.current?.selectOnly && !objDragRef.current.moved) {
      setSelectedObj(objDragRef.current.id);
      setSelectedTarget(null);
    }
    objDragRef.current = null;
    if (guidesRef.current.length) { guidesRef.current = []; setGuides([]); }
    if (activePointers.current.size <= 2) { objPinchRef.current = null; setObjPinching(false); }
    try {
      const target = e.target as HTMLElement;
      if (target && target.hasPointerCapture(e.pointerId)) {
        target.releasePointerCapture(e.pointerId);
      }
    } catch (err) {}
    
    const intr = interactionRef.current;
    if (intr) {
      e.stopPropagation();
      if (intr.isClick && !intr.hitItself) setSelectedTarget(null);
      if (intr.type === 'brush_draw' || intr.type === 'brush_erase' || intr.type === 'move_hole' || intr.type === 'pinch_hole') {
        if (!(intr.type === 'move_hole' && intr.isClick)) {
          pushHistory(holesRef.current);
        }
      }
    }
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size < 2) viewPinchRef.current = null;
    if (activePointers.current.size === 0) {
      interactionRef.current = null;
      lastDrawPosRef.current = null;
      strokeStartHolesRef.current = null;
    }
    setForceRender(p => p + 1);
  };

  const renderToCanvas = useCallback((targetCanvas: HTMLCanvasElement, renderScale: number = 1) => {
    if (!imageState) return;
    const { baseW, baseH, globalScale: gs } = imageState;
    const ctx = get2dWide(targetCanvas, { alpha: false });
    if (!ctx) return;

    const s = renderScale;
    const sw = baseW * s;
    const sh = baseH * s;
    const sgs = gs * s;

    const mdS = maskDims(layout, sw, sh, maskScale);
    const maskW = mdS.mw;
    const maskH = mdS.mh;

    const getLayoutOffsetsS = () => {
      if (layout === 'mask-bottom') return { cw: sw, ch: sh + maskH, ix: 0, iy: 0, mx: 0, my: sh };
      if (layout === 'mask-top') return { cw: sw, ch: sh + maskH, ix: 0, iy: maskH, mx: 0, my: 0 };
      if (layout === 'mask-right') return { cw: sw + maskW, ch: sh, ix: 0, iy: 0, mx: sw, my: 0 };
      if (layout === 'mask-left') return { cw: sw + maskW, ch: sh, ix: maskW, iy: 0, mx: 0, my: 0 };
      if (layout === AROUND) return { cw: maskW, ch: maskH, ix: mdS.padX, iy: mdS.padY, mx: 0, my: 0 };
      return { cw: sw, ch: sh, ix: 0, iy: 0, mx: 0, my: 0 };
    };

    const offs = getLayoutOffsetsS();
    if (targetCanvas.width !== offs.cw || targetCanvas.height !== offs.ch) {
      targetCanvas.width = offs.cw;
      targetCanvas.height = offs.ch;
    }

    ctx.fillStyle = '#0A0A0A'; ctx.fillRect(0, 0, offs.cw, offs.ch);
    ctx.fillStyle = '#1A1A1A'; ctx.fillRect(offs.ix, offs.iy, sw, sh); ctx.fillRect(offs.mx, offs.my, maskW, maskH);

    const isMain = targetCanvas === canvasRef.current;
    const bCanvas = isMain ? baseMaskCanvasRef.current : document.createElement('canvas');
    /* 遮罩底稿（底色＋遮罩圖＋點點）只跟這幾個參數有關，圖案與動畫都不會動到它。
       播動畫時一秒要走 30 次，每次都重填兩張全尺寸畫布是純粹的浪費 ——
       這裡用一把鑰匙擋掉：參數沒變就直接沿用上一格畫好的那張。
       這是省成本，不是降畫質：畫出來的內容一模一樣。 */
    const maskKey = isMain ? JSON.stringify([
      maskW, maskH, maskColor, patternType, dotColor, dotGap, dotSize, sgs,
      maskImageState && maskImageState.img ? (maskImageState.img.src || '1') : '',
    ]) : '';
    const maskHit = isMain && maskKey === maskCacheKeyRef.current
      && bCanvas.width === maskW && bCanvas.height === maskH;
    if (!maskHit) { bCanvas.width = maskW; bCanvas.height = maskH; }
    const bCtx = get2dWide(bCanvas)!;
    if (!maskHit) {
    bCtx.fillStyle = maskColor;
    bCtx.fillRect(0, 0, maskW, maskH);
    if (maskImageState && maskImageState.img) {
      const mImg = maskImageState.img;
      const scale = Math.max(maskW / mImg.width, maskH / mImg.height);
      const drawW = mImg.width * scale;
      const drawH = mImg.height * scale;
      /* 置中截取（cover）。
         這裡一律置中截取（cover）。 */
      const drawX = (maskW - drawW) / 2;
      const drawY = (maskH - drawH) / 2;
      bCtx.drawImage(mImg, drawX, drawY, drawW, drawH);
    }
    }

    /* 沒有點點紋理的時候，「含紋理的遮罩」就等於「底色遮罩」本身 ——
       不必再開一張同樣大的畫布。一張全尺寸畫布動輒幾十 MB，
       省下來的預算直接換成更高的預覽解析度（圖案的鋸齒就是這樣來的）。 */
    const needPattern = patternType === 'dot';
    const fCanvas = !needPattern ? bCanvas
      : (isMain ? fullMaskCanvasRef.current : document.createElement('canvas'));
    if (needPattern && !maskHit) {
      fCanvas.width = maskW; fCanvas.height = maskH;
    }
    const fCtx = get2dWide(fCanvas)!;
    if (needPattern && !maskHit) fCtx.drawImage(bCanvas, 0, 0);

    if (patternType === 'dot' && !maskHit) {
      fCtx.fillStyle = dotColor; 
      // 根據 UI 值 (0~100) 映射到實際大小 (5~20) 與實際間距 (40~140)
      const actualDotSize = (5 + (dotSize / 100) * 15) * sgs;
      const actualDotGap = (40 + dotGap) * sgs;
      
      const r = actualDotSize / 2;
      // 邊緣的預留空間，上下左右完全一樣，且預留空間縮小以充分貼合邊界
      const pad = r + 2 * sgs; 
      
      const dx = actualDotGap;
      const dy = actualDotGap * Math.sqrt(3) / 2; // 半落重複 staggered 三角網格高度
      
      const rangeX = Math.ceil(maskW / dx) + 2;
      const rangeY = Math.ceil(maskH / dy) + 2;
      
      for (let j = -rangeY; j <= rangeY; j++) {
        const py = maskH / 2 + j * dy;
        
        const isOddRow = Math.abs(j) % 2 === 1;
        const shiftX = isOddRow ? dx / 2 : 0;
        
        for (let i = -rangeX; i <= rangeX; i++) {
          const px = maskW / 2 + i * dx + shiftX;
          // 邊界檢查 (上下距離與左右距離皆必須在 [pad, size-pad] 內)
          if (
            px - r >= pad && 
            px + r <= maskW - pad &&
            py - r >= pad &&
            py + r <= maskH - pad
          ) {
            fCtx.beginPath();
            fCtx.arc(px, py, r, 0, Math.PI * 2);
            fCtx.fill();
          }
        }
      }
    }
    if (isMain) maskCacheKeyRef.current = maskKey;

    const drawImg = (img: any, t: any, ox: number, oy: number, w: number, h: number) => {
      if (!img || !t) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, w, h);
      ctx.clip();
      ctx.drawImage(img, ox + t.x * s, oy + t.y * s, t.w * s, t.h * s);
      ctx.restore();
    };

    /* 四周包圍時「墊在遮罩底下那張圖」要以畫布中心等比放大到整張畫布 ——
       它跟中央那張是同一個構圖，只是被推到鏡頭外面，從洞裡看出去才對得起來。 */
    const drawBackdropAround = () => {
      const img = imageState.img, t = imageTransform;
      if (!img || !t) return;
      const k = maskW / sw;
      const cx = offs.cw / 2, cy = offs.ch / 2;
      const x0 = offs.ix + t.x * s, y0 = offs.iy + t.y * s;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, offs.cw, offs.ch); ctx.clip();
      ctx.drawImage(img, cx + (x0 - cx) * k, cy + (y0 - cy) * k, t.w * s * k, t.h * s * k);
      ctx.restore();
    };
    const drawCentreImage = () => drawImg(imageState.img, imageTransform, offs.ix, offs.iy, sw, sh);
    const drawBackdrop = () => (layout === AROUND
      ? drawBackdropAround()
      : drawImg(imageState.img, imageTransform, offs.mx, offs.my, maskW, maskH));

    /* ── 連線 ────────────────────────────────────────────────────
       線跟圖案走完全同一條路：在遮罩上是挖穿的、在圖片上是遮罩色的實心線，
       所以四個繪製階段都各補一次。每條線的進度是「兩端都冒完才開始長」，
       動態影片會拿它做出「從一個圖案的中心慢慢連出去」的效果。 */
    const LINK_W = Math.max(1, Math.min(offs.cw, offs.ch) * 0.0035);

    /* 播動態時，每顆圖案都有自己的一格：縮放、位移、旋轉、透明度。
       靜態時一律回「原樣」，所以平常這條完全不影響畫面。
       位移的單位是圖案自己的大小，所以大圖案飄得多、小圖案飄得少。 */
    const holeOrder = new Map<string, number>();
    [...holes].sort((a, b) => (a.x - b.x) || (a.y - b.y)).forEach((h, i) => holeOrder.set(h.id, i));
    type HA = { k: number; x: number; y: number; rot: number; a: number; fx: number; on: boolean };
    const hA = (h: any): HA => {
      const a = animRef.current;
      if (!a) return { k: 1, x: h.x, y: h.y, rot: 0, a: 1, fx: 1, on: true };
      const f = a.hole(h, holeOrder.get(h.id) ?? 0);
      const base = getHoleSize(h);
      return { k: f.k, x: h.x + f.dx * base, y: h.y + f.dy * base, rot: f.rot, a: f.a, fx: f.fx, on: f.k > 0.002 && f.a > 0.004 };
    };
    const linksFor = (side: 'image' | 'mask') => {
      if (linkMode === 'none' || !LINK_TYPES.includes(holeType)) return [] as [any, any][];
      const list = holes.filter(h => { const sd = h.side || 'both'; return sd === 'both' || sd === side; });
      /* 會穿過別的圖案的線就整條不畫 —— 線從圖案身上壓過去很醜。
         判斷用的是圖案「靜止時」的位置與大小，所以結果是穩定的：
         把圖案挪到不擋路的地方，線自己就回來了。 */
      return linkEdges(list).filter(([a, b]) => list.every(h => {
        if (h.id === a.id || h.id === b.id) return true;
        return segDist(h.x, h.y, a.x, a.y, b.x, b.y) > getHoleSize(h) / 2;
      }));
    };
    /** 把連線描在目前的座標系上（呼叫端已經 translate 到正確的原點）。
        端點跟著圖案的動態走，所以圖案在飄的時候線也黏著它們。 */
    const strokeLinks = (g: CanvasRenderingContext2D, pairs: [any, any][]) => {
      if (!pairs.length) return;
      const a0 = animRef.current;
      g.save();
      g.lineWidth = LINK_W;
      g.lineCap = 'round';
      if (linkMode === 'dash') {
        // 虛線：一段一段的點，長度跟著線寬走才不會在大圖上變成實線
        g.setLineDash([LINK_W * 3, LINK_W * 4]);
        g.lineCap = 'butt';
      }
      pairs.forEach(([a, b]) => {
        const pa = hA(a), pb = hA(b);
        // 任一端還沒冒出來，這條線就整條不畫 —— 線不會憑空出現在還不存在的圖案上
        if (!pa.on || !pb.on) return;
        /* 每一對有自己的進度：兩端都冒完才開始長。
           以前是全部圖案冒完才一起開始，中間那段會看到線憑空出現。 */
        const local = a0 ? a0.link(holeOrder.get(a.id) ?? 0, holeOrder.get(b.id) ?? 0) : 1;
        if (local <= 0) return;
        g.beginPath();
        g.moveTo(pa.x * s, pa.y * s);
        g.lineTo(pa.x * s + (pb.x - pa.x) * s * local, pa.y * s + (pb.y - pa.y) * s * local);
        g.stroke();
      });
      g.restore();
    };

    const drawImageSideHoles = () => {
    ctx.save(); ctx.translate(offs.ix, offs.iy);
    const basePat = ctx.createPattern(bCanvas, 'repeat');
    if (basePat) {
      ctx.fillStyle = basePat;
      /* 圖片側的圖案要顯示「遮罩上同一個相對位置」的那一塊。
         遮罩跟圖片不一定一樣大（例如下方那條只有一半高），直接貼的話
         pattern 會 repeat，圖案就會拿到繞回去的、對不上的那一段。
         這裡把圖案的位置從圖片座標換算成遮罩座標，再把 pattern 平移過去。 */
      const rx = sw > 0 ? maskW / sw : 1;
      const ry = sh > 0 ? maskH / sh : 1;
      holes.forEach(h => {
        const side = h.side || 'both';
        if (side !== 'both' && side !== 'image') return; // Only show on image side

        const A = hA(h);
        if (!A.on) return;
        const sz = getHoleSize(h) * A.k * s;
        const currentAngle = (h.angle !== undefined ? h.angle : holeAngle) + A.rot;
        const hx = A.x * s, hy = A.y * s;
        const mxp = hx * rx, myp = hy * ry;     // 遮罩上的對應點
        ctx.save();
        ctx.globalAlpha = A.a;
        // pattern 錨在目前的原點，所以先位移，讓遮罩上的 (mxp,myp) 正好落在圖案位置
        ctx.translate(hx - mxp, hy - myp);
        if (isTextHole(holeType)) {
          const tText = holeGlyph(holeType, customText, h);
          drawTextShape(ctx, holeType, tText, mxp, myp, sz, basePat, false, currentAngle);
        } else {
          // 以圖案自己的中心為軸旋轉，但不動到 pattern 的錨點
          ctx.translate(mxp, myp);
          ctx.rotate(currentAngle * Math.PI / 180);
          ctx.translate(-mxp, -myp);
          drawShapePath(ctx, holeType, mxp, myp, sz);
          ctx.fill();
        }
        ctx.restore();
      });
      // 連線在圖片上也是「遮罩色的實心線」，跟這一側的圖案同一套
      ctx.strokeStyle = basePat;
      strokeLinks(ctx, linksFor('image'));
    }
    ctx.restore();
    };

    let lmc: HTMLCanvasElement = isMain ? lowerMaskCanvasRef.current : document.createElement('canvas');
    const drawMaskLayer = () => {
    lmc.width = maskW; lmc.height = maskH;
    const lmx = get2dWide(lmc)!;
    lmx.drawImage(fCanvas, 0, 0);
    lmx.globalCompositeOperation = 'destination-out';
    holes.forEach(h => {
      const side = h.side || 'both';
      if (side !== 'both' && side !== 'mask') return; // Only show on mask side

      if (layout !== AROUND && !isHoleFullyInsideMask(h, s, maskW, maskH)) {
        return;
      }
      const A = hA(h);
      if (!A.on) return;
      const sz = getHoleSize(h) * A.k * s;
      const currentAngle = (h.angle !== undefined ? h.angle : holeAngle) + A.rot;
      lmx.save();
      lmx.globalAlpha = A.a;
      if (isTextHole(holeType)) {
        const tText = holeGlyph(holeType, customText, h);
        drawTextShape(lmx, holeType, tText, A.x * s, A.y * s, sz, null, true, currentAngle);
      } else {
        lmx.translate(A.x * s, A.y * s);
        lmx.rotate(currentAngle * Math.PI / 180);
        drawShapePath(lmx, holeType, 0, 0, sz);
        lmx.fill();
      }
      lmx.restore();
    });
    // 連線在遮罩上是挖穿的，跟這一側的圖案同一套
    lmx.strokeStyle = '#000';
    strokeLinks(lmx, linksFor('mask').filter(([a, b]) =>
      layout === AROUND
      || (isHoleFullyInsideMask(a, s, maskW, maskH) && isHoleFullyInsideMask(b, s, maskW, maskH))));
    lmx.globalCompositeOperation = 'source-over';
    ctx.drawImage(lmc, offs.mx, offs.my);
    };

    /* 一般四邊那四種是「圖跟遮罩並排」，誰先誰後都蓋不到對方；
       四周包圍是「遮罩鋪滿整張、原圖疊在正中央」，順序必須反過來。 */
    /* 四周包圍時遮罩鋪滿整張、原圖疊在正中央，所以落在圖片上的那些洞
       會被原圖蓋掉、整個看不見。這裡在原圖之上、只在圖片框內，
       再用「遮罩本身」把那些洞畫一次 ——
       於是同一個圖案跨在交界上時：框那一段是挖穿的（看到放大的底圖），
       圖片那一段是遮罩顏色的實心圖案，兩種樣式同時成立。 */
    const drawHolesOverImage = () => {
      const pat = ctx.createPattern(bCanvas, 'repeat');
      if (!pat) return;
      ctx.save();
      ctx.beginPath(); ctx.rect(offs.ix, offs.iy, sw, sh); ctx.clip();
      ctx.translate(offs.mx, offs.my);      // 洞的座標是遮罩座標系
      ctx.fillStyle = pat;
      holes.forEach(h => {
        const sd = h.side || 'both';
        if (sd !== 'both' && sd !== 'mask') return;
        const A = hA(h);
        if (!A.on) return;
        const sz = getHoleSize(h) * A.k * s;
        const currentAngle = (h.angle !== undefined ? h.angle : holeAngle) + A.rot;
        const hx = A.x * s, hy = A.y * s;
        // 四周包圍的洞本來就是遮罩座標，對應點就是自己
        ctx.save();
        ctx.globalAlpha = A.a;
        if (isTextHole(holeType)) {
          drawTextShape(ctx, holeType, holeGlyph(holeType, customText, h), hx, hy, sz, pat, false, currentAngle);
        } else {
          ctx.translate(hx, hy);
          ctx.rotate(currentAngle * Math.PI / 180);
          ctx.translate(-hx, -hy);
          drawShapePath(ctx, holeType, hx, hy, sz);
          ctx.fill();
        }
        ctx.restore();
      });
      ctx.strokeStyle = pat;
      strokeLinks(ctx, linksFor('mask'));
      ctx.restore();
    };

    /* 浮動物件（圖片／文字）。順序就是陣列順序（後面的蓋前面的）；
       標了 below 的那些會被畫在「所有圖案之下」，見下面兩次呼叫。 */
    const objIndex = new Map<string, number>();
    objects.forEach((o, i) => objIndex.set(o.id, i));
    const drawObjects = (list: any[]) => list.forEach(o => {
      /* 播動態時，每個物件有自己的一格（出場 ＋ 常駐）。
         靜態時 f 是 null，這一段完全不影響畫面。 */
      const f = animRef.current ? animRef.current.obj(o, objIndex.get(o.id) ?? 0) : null;
      if (f && (f.k <= 0.002 || f.a <= 0.004)) return;
      ctx.save();
      ctx.translate((o.x + o.w / 2 + (f ? f.dx * o.w : 0)) * s, (o.y + o.h / 2 + (f ? f.dy * o.h : 0)) * s);
      ctx.rotate(((o.rot || 0) + (f ? f.rot : 0)) * Math.PI / 180);
      if (f && (f.k !== 1 || f.fx !== 1)) ctx.scale(f.k * f.fx, f.k);
      ctx.globalAlpha = (o.alpha ?? 1) * (f ? f.a : 1);
      if (o.type === 'image' && o.img) {
        const src2: any = fxCanvasOf(o) || o.img;
        /* 有形狀效果時畫布比原圖大一圈（留給發光與描邊），
           畫的時候要等比放大回去，圖片本體才會剛好落在原本的框上。 */
        const padX = (src2 as any).__padX || 0, padY = (src2 as any).__padY || 0;
        const ew = o.w * s * (1 + padX * 2), eh = o.h * s * (1 + padY * 2);
        ctx.drawImage(src2, -ew / 2, -eh / 2, ew, eh);
      } else if (o.type === 'text') {
        /* 文字的每一項屬性都跟經典拼圖對齊：字體、粗體／斜體、字距、描邊、發光。
           面板本身就是那邊那顆元件，所以這裡只要照著畫。 */
        const fam = o.fontFamily || DEFAULT_FONT;
        const weight = o.bold ? 800 : 400;
        const style = o.italic ? 'italic ' : '';
        ctx.font = `${style}${weight} ${o.size * s}px ${fontStack(fam)}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        (ctx as any).letterSpacing = `${(o.letterSpacing || 0) * s}px`;
        /* 順序跟經典拼圖一致：先只用「填色的形狀」畫光（三段模糊疊起來），
           再畫描邊，最後才填色。
           光如果跟描邊一起算，會沿著描邊外緣散開 —— 看起來就是描邊突然粗一圈，
           那正是主人覺得怪的地方。強度也對齊那邊的 (glow/20)×14×k。 */
        /* 描邊與發光都要跟著字級等比。
           經典拼圖那邊的滑桿是配著「字級 40px」在調的（描邊 0～2px、發光 0～20），
           我們的文字通常被放大好幾倍，用原值畫就會細得像沒有 —— 這就是主人說
           「太細了」的原因。以 40px 為基準等比放大，兩邊看起來才一樣。 */
        const tk = (o.size / 40) * s;
        if (o.glow) {
          ctx.save();
          ctx.fillStyle = o.color || '#ffffff';
          ctx.shadowColor = o.glowColor || '#ffffff';
          for (const k2 of [1, 2, 3]) {
            ctx.shadowBlur = (o.glow / 20) * 14 * k2 * tk;
            ctx.fillText(o.text || '', 0, 0);
          }
          ctx.restore();
        }
        if (o.strokeWidth) {
          ctx.lineJoin = 'round';
          ctx.miterLimit = 2;
          ctx.strokeStyle = o.strokeColor || '#FFFFFF';
          ctx.lineWidth = o.strokeWidth * 2 * tk;
          ctx.strokeText(o.text || '', 0, 0);
        }
        ctx.fillStyle = o.color || '#ffffff';
        ctx.fillText(o.text || '', 0, 0);
        ctx.shadowBlur = 0;
        (ctx as any).letterSpacing = '0px';
      }
      ctx.globalAlpha = 1;
      if (isMain && selectedObj === o.id && !guides.length && !tuningEdge) {
        // 選中框維持虛線（跟挖洞那邊同一種語言）
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2 * sgs * s;
        ctx.setLineDash([8 * sgs * s, 8 * sgs * s]);
        ctx.strokeRect(-o.w * s / 2, -o.h * s / 2, o.w * s, o.h * s);
        ctx.setLineDash([]);
      }
      ctx.restore();
    });

    /* 標了 below 的物件插在「底圖鋪好之後、所有圖案之前」——
       所以圖片側的圖案會蓋在它上面，遮罩側則是被遮罩蓋住、只從洞裡透出來。
       兩種排版的插入點不同，但相對於圖案的層級是一致的。 */
    const belowObjs = objects.filter(o => o.below);
    const aboveObjs = objects.filter(o => !o.below);
    /* 四周包圍時，遮罩側的圖案是「在遮罩上挖穿、看到墊在底下那張放大的圖」，
       而遮罩是在物件之前就畫好的 —— 所以那些洞會被 below 的物件蓋住，
       跟圖片側的圖案不同層。這裡在物件之上再把「洞裡看到的那張圖」補畫一次，
       兩側的圖案就都在物件上面了。只有真的有 below 物件時才做（省一張畫布）。 */
    const drawMaskHolesOnTop = () => {
      const img = imageState.img, t = imageTransform;
      if (!img || !t) return;
      /* 洞裡看到的就是墊在遮罩底下那張放大的圖：先畫成一張，再一個洞一個洞貼回去。
         這張要重複使用 —— 播動畫時一秒會走 30 次，每次 new 一張幾百萬像素的
         畫布，記憶體會被灌爆（就是「播一播閃退回主畫面」）。 */
      const bd = isMain ? holeBackdropCanvasRef.current : document.createElement('canvas');
      const bdW = Math.max(1, Math.round(offs.cw)), bdH = Math.max(1, Math.round(offs.ch));
      if (bd.width !== bdW || bd.height !== bdH) { bd.width = bdW; bd.height = bdH; }
      else bd.getContext('2d')?.clearRect(0, 0, bdW, bdH);
      const g = bd.getContext('2d');
      if (!g) return;
      if (layout === AROUND) {
        // 四周包圍：洞裡看到的是以畫布中心等比放大的同一個構圖
        const kk = maskW / sw;
        const ccx = offs.cw / 2, ccy = offs.ch / 2;
        const x0 = offs.ix + t.x * s, y0 = offs.iy + t.y * s;
        g.drawImage(img, ccx + (x0 - ccx) * kk, ccy + (y0 - ccy) * kk, t.w * s * kk, t.h * s * kk);
      } else {
        // 並排的四種：遮罩那一塊底下就是同一張圖，位置跟 drawBackdrop 一致
        g.save();
        g.beginPath(); g.rect(offs.mx, offs.my, maskW, maskH); g.clip();
        g.drawImage(img, offs.mx + t.x * s, offs.my + t.y * s, t.w * s, t.h * s);
        g.restore();
      }
      const pat = ctx.createPattern(bd, 'no-repeat');
      holes.forEach(h => {
        const side = h.side || 'both';
        if (side !== 'both' && side !== 'mask') return;
        // 並排的四種：只有完全落在遮罩裡的那些洞才會被挖穿（跟 drawMaskLayer 同一條規則）
        if (layout !== AROUND && !isHoleFullyInsideMask(h, s, maskW, maskH)) return;
        const A = hA(h);
        if (!A.on) return;
        const sz = getHoleSize(h) * A.k * s;
        const ang2 = (h.angle !== undefined ? h.angle : holeAngle) + A.rot;
        const hx = A.x * s + offs.mx, hy = A.y * s + offs.my;
        if (isTextHole(holeType)) {
          if (pat) drawTextShape(ctx, holeType, holeGlyph(holeType, customText, h), hx, hy, sz, pat, false, ang2);
          return;
        }
        ctx.save();
        ctx.translate(hx, hy);
        ctx.rotate(ang2 * Math.PI / 180);
        ctx.translate(-hx, -hy);
        drawShapePath(ctx, holeType, hx, hy, sz);
        ctx.clip();
        // 形狀可以轉，但貼進去的圖不能跟著轉 —— 先把座標系還原再貼
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(bd, 0, 0);
        ctx.restore();
      });
      if (pat) {
        // 連線也要一起補畫，不然 below 的物件會壓在線上面
        ctx.save();
        ctx.translate(offs.mx, offs.my);
        ctx.strokeStyle = pat;
        strokeLinks(ctx, linksFor('mask'));
        ctx.restore();
      }
      if (!isMain) bd.width = 0;
    };

    if (layout === AROUND) {
      drawBackdrop();
      drawMaskLayer();
      drawCentreImage();
      drawObjects(belowObjs);
      if (belowObjs.length) drawMaskHolesOnTop();
      drawHolesOverImage();
      drawImageSideHoles();
    } else {
      /* below 的物件是「遮罩色塊之上、所有圖案之下」：
         先鋪底圖與遮罩色塊 → 畫物件 → 再把兩側的圖案補回最上層。
         以前物件是畫在 drawMaskLayer 之前，所以整個沉到遮罩色塊底下、
         在遮罩那一半完全看不見 —— 那是不對的。 */
      drawCentreImage();
      drawBackdrop();
      drawMaskLayer();
      drawObjects(belowObjs);
      if (belowObjs.length) drawMaskHolesOnTop();
      drawImageSideHoles();
    }

    // ctx.beginPath();
    // if (layout.includes('bottom') || layout.includes('top')) { ctx.moveTo(0, sh); ctx.lineTo(sw, sh); }
    // else { ctx.moveTo(sw, 0); ctx.lineTo(sw, sh); }
    // ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = sgs; ctx.stroke();

    drawObjects(aboveObjs);

    if (isMain && guides.length) {
      ctx.save();
      /* 經典拼圖那邊是 2 CSS px 的 bg-blue-500。這裡畫在畫布上，
         所以要把 2 CSS px 換算成畫布單位（畫布可能比螢幕細很多倍）。 */
      const cssW0 = baseCssWRef.current || 1;
      const shown = cssW0 * Math.max(1, viewTRef.current.k);
      ctx.strokeStyle = '#3B82F6';
      const glw = Math.max(1, 2 * (offs.cw * s) / shown);
      ctx.lineWidth = glw;
      /* 畫布最外圈那兩條線本來剛好壓在邊界上，一半會被畫布外的黑底吃掉，
         看起來就比中間那幾條細一半。往內縮半個線寬，整條都留在畫布裡。 */
      const clamp = (v: number, max: number) => Math.min(Math.max(v, glw / 2), max - glw / 2);
      guides.forEach(g => {
        ctx.beginPath();
        if (g.x !== undefined) {
          const gx = clamp(g.x * s, offs.cw);
          ctx.moveTo(gx, 0); ctx.lineTo(gx, offs.ch);
        } else {
          const gy = clamp(g.y * s, offs.ch);
          ctx.moveTo(0, gy); ctx.lineTo(offs.cw, gy);
        }
        ctx.stroke();
      });
      ctx.restore();
    }

    /* 選取框只畫在螢幕上那張。畫布可能被畫得更細，所以尺寸與座標都要乘上 s，
       不然放大重畫之後虛線框會停在原本的小尺寸、對不上那個洞。 */
    if (isMain && selectedTarget && interactionRef.current) {
      const selectedHole = holes.find(hx => hx.id === selectedTarget);
      if (selectedHole) {
        const h = selectedHole;
        const A = hA(h);
        const sz = getHoleSize(h) * A.k * s;
        const currentAngle = (h.angle !== undefined ? h.angle : holeAngle) + A.rot;
        const hSide = h.side || 'both';

        ctx.save(); 
        ctx.strokeStyle = '#FFFFFF'; 
        ctx.lineWidth = 4 * sgs; 
        ctx.setLineDash([10 * sgs, 10 * sgs]);

        // 左側選取框 (帶旋轉, 只有在 image 側時顯示)
        if (hSide === 'both' || hSide === 'image') {
          ctx.save();
          ctx.translate(A.x * s + offs.ix, A.y * s + offs.iy);
          ctx.rotate(currentAngle * Math.PI / 180);
          if (isTextHole(holeType)) {
            const tctx = dummyCanvasRef.current.getContext('2d')!;
            const renderStr = holeGlyph(holeType, customText, h);
            tctx.font = `500 ${sz}px sans-serif`;
            const tw = tctx.measureText(renderStr).width + 16 * sgs, th = sz + 16 * sgs;
            ctx.strokeRect(-tw / 2, -th / 2, tw, th);
          } else {
            const szz = sz + 16 * sgs;
            ctx.strokeRect(-szz / 2, -szz / 2, szz, szz);
          }
          ctx.restore();
        }

        // 右側選取框 (帶旋轉, 只有在 mask 側且完全在裡面時才顯示)
        if ((hSide === 'both' || hSide === 'mask') && isHoleFullyInsideMask(h, 1, maskW, maskH)) {
          ctx.save();
          ctx.translate(A.x * s + offs.mx, A.y * s + offs.my);
          ctx.rotate(currentAngle * Math.PI / 180);
          if (isTextHole(holeType)) {
            const tctx = dummyCanvasRef.current.getContext('2d')!;
            const renderStr = holeGlyph(holeType, customText, h);
            tctx.font = `500 ${sz}px sans-serif`;
            const tw = tctx.measureText(renderStr).width + 16 * sgs, th = sz + 16 * sgs;
            ctx.strokeRect(-tw / 2, -th / 2, tw, th);
          } else {
            const szz = sz + 16 * sgs;
            ctx.strokeRect(-szz / 2, -szz / 2, szz, szz);
          }
          ctx.restore();
        }

        ctx.restore();
      }
    }
    
    if (!isMain) {
      bCanvas.width = 0; if (fCanvas !== bCanvas) fCanvas.width = 0; lmc.width = 0;
    }
  }, [imageState, layout, maskColor, maskImageState, maskTransform, patternType, dotColor, dotGap, dotSize, holes, holeType, getHoleSize, customText, selectedTarget, holeAngle, maskScale, isHoleFullyInsideMask, objects, selectedObj, guides, tuningEdge, fxCanvasOf, fxTick, linkMode]);

  const renderCanvas = useCallback(() => {
    if (!canvasRef.current || !imageState) return;
    renderToCanvas(canvasRef.current, previewScaleRef.current);
    // 記住 1 倍時的 CSS 寬度（畫布是 max-w-full 等比縮放，換算全靠它）
    const r = canvasRef.current.getBoundingClientRect();
    if (r.width > 0 && imageState) {
      /* 基準尺寸用「舞台大小 ＋ 拼圖長寬比」直接算（contain 貼合），
         不去量畫布 —— 畫布的尺寸是我們自己寫死的，量它會跟自己打架。 */
      const stEl = stageRef.current;
      const cs0 = collageSizeOf(layout, imageState.baseW, imageState.baseH, maskScale);
      let cssW = 0, cssH = 0;
      if (stEl && cs0.w > 0 && cs0.h > 0) {
        const sb = stEl.getBoundingClientRect();
        const availW = Math.max(1, sb.width - 32), availH = Math.max(1, sb.height - 32);
        const f = Math.min(availW / cs0.w, availH / cs0.h);
        cssW = cs0.w * f; cssH = cs0.h * f;
        setStageSize(prev => (Math.abs(prev.w - sb.width) < 0.5 && Math.abs(prev.h - sb.height) < 0.5)
          ? prev : { w: sb.width, h: sb.height });
        setBaseCss(prev => (prev && Math.abs(prev.w - cssW) < 0.5 && Math.abs(prev.h - cssH) < 0.5)
          ? prev : { w: cssW, h: cssH });
      }
      baseCssWRef.current = cssW || r.width;
      const cs = collageSizeOf(layout, imageState.baseW, imageState.baseH, maskScale);
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      // 上限＝「畫得到的最細畫布」對應到螢幕上的倍率
      const z = (cs.w * maxPreviewScale()) / Math.max(1, (cssW || r.width) * dpr);
      /* 以前這裡硬給 1.5 的下限：畫布明明畫不到那麼細，卻還讓你放大到 1.5 倍 ——
         那段就是一定會糊的區間。改成「畫得到多少就只給多少」，
         任何倍率下都保證 1 個畫布像素 ≥ 1 個裝置像素。 */
      maxZoomRef.current = Math.max(1, Math.min(6, Math.floor(z * 20) / 20));
    }
  }, [imageState, renderToCanvas, previewScale, layout, maskScale, maxPreviewScale]);

  useEffect(() => { 
    if (saveState !== 'idle') return;
    let id = requestAnimationFrame(() => renderCanvas()); 
    return () => cancelAnimationFrame(id); 
  }, [renderCanvas, saveState]);

  /* ── IG 預覽 ────────────────────────────────────────────────────
     跟經典拼圖一樣：打開時用同一條算圖管線算一張「壓低解析度的成品」，
     顯示的就是匯出會長的樣子，不另外用 DOM 重畫一次。
     創意拼圖只有一張輸出，所以頁數固定是 1。 */
  const [igPreview, setIgPreview] = useState(false);
  const [igShots, setIgShots] = useState<string[]>([]);
  const igShotUrlRef = useRef<string[]>([]);
  /** 兩篇貼文共用的那一首歌 */
  const [igMusic, setIgMusic] = useState<any>(null);
  useEffect(() => {
    if (!igPreview || !imageState) return;
    let alive = true;
    (async () => {
      try {
        const off = getLayoutOffsets();
        if (!off) return;
        /* 長邊照螢幕實際能顯示的裝置像素給（再乘 1.15 超取樣），上限 1600。
           以前固定 900，在 3 倍螢幕上等於被拉大 1.3 倍，看起來就是糊的。 */
        const dpr = Math.min(3, window.devicePixelRatio || 1);
        const shown = Math.min(window.innerWidth, 520);
        const scale = Math.min(1600, Math.max(900, shown * dpr * 1.15)) / Math.max(off.cw, off.ch);
        const cv = document.createElement('canvas');
        // 動態正在播的話要先把它拿掉，不然預覽會抓到動畫的半途那一格
        const keep = animRef.current;
        animRef.current = null;
        renderToCanvas(cv, scale);
        animRef.current = keep;
        const url = await canvasToUrl(cv);
        cv.width = 0; cv.height = 0;
        if (!alive) { revokeUrl(url); return; }
        // 等解碼完再換，才不會有一段空白
        await new Promise<void>(res => { const im = new Image(); im.onload = () => res(); im.onerror = () => res(); im.src = url; });
        if (!alive) { revokeUrl(url); return; }
        igShotUrlRef.current.forEach(u => revokeUrl(u));
        igShotUrlRef.current = [url];
        setIgShots([url]);
      } catch { /* 算不出來就讓它顯示轉圈 */ }
    })();
    return () => {
      alive = false;
      igShotUrlRef.current.forEach(u => revokeUrl(u));
      igShotUrlRef.current = [];
      setIgShots([]);
    };
  }, [igPreview, imageState]);


  /* IG 直式最長只吃到 4:5（0.8）。比它更長的畫布發出去一定會被裁，
     預覽也就不是發文後的樣子 —— 那顆按鈕直接不出現。
     直式照片配「遮罩在下」或「遮罩在上」時畫布會被拉得更長（照片高＋遮罩高），
     幾乎一定會落在這條線外面，這是刻意的。 */
  const igSupported = (() => {
    const o = getLayoutOffsets();
    if (!o || !o.cw || !o.ch) return false;
    if (o.ch <= o.cw) return true;              // 正方形與橫式都沒問題
    /* 四周包圍寬鬆一點：照片四周本來就有一圈遮罩，IG 就算裁也是裁到那圈邊，
       照片本身不會被切到 —— 所以只要原圖不比 2:3 更長就給預覽。
       （這個排版的畫布跟原圖同比例，所以直接看畫布就等於看原圖。）
       其餘四種是照片直接貼邊，超過 IG 的直式上限 4:5 就會裁到照片。 */
    const limit = layout === AROUND ? 2 / 3 : 4 / 5;
    return o.cw / o.ch >= limit - 0.001;
  })();

  /* ── 動畫 ──────────────────────────────────────────────────────
     整套動畫是即時算出來的，不是先錄成影片再播：
       ① 進到「動畫」頁就自動從頭播，rAF 迴圈用目前的參數重畫主畫布本人 ——
          所以看到的畫質就是編輯畫面的畫質，也不會有壓縮痕跡。
       ② 任何改動（加物件、拖位置、換參數）下一格就反映出來。
       ③ 匯出時走同一條 renderToCanvas，影片的每一格就是預覽本人。
     時間軸由每個元素自己的「進場 → 常駐 → 離場」決定，
     連線則多一個「曲線變速」。 */
  /** 播放中／暫停中。離開動畫頁就整個停掉、畫面收回靜態。 */
  const [motionPlaying, setMotionPlaying] = useState(true);
  /** 重播用的流水號：改動畫種類時 +1，讓播放迴圈從頭跑一次 */
  const [motionSeq, setMotionSeq] = useState(0);
  /** 全部跑完之後多停幾秒再從頭（循環才不會像在抽搐） */
  const [motionHold, setMotionHold] = useState(4);
  /** 圖案這一群的動畫設定；每顆圖案再依序錯開 */
  /* 圖案是一整群：「進場耗時」給 3 秒才看得出一顆一顆冒出來，
     常駐維持上下飄（圖片與文字才是預設靜止）。 */
  const [moShape, setMoShape] = useState<MoCfg>({ ...MO_DEFAULT, dur: durFromSpeed(30), idle: 'float' });
  /** 連線：起始、畫完要多久、以及線往前長的曲線 */
  const [moLink, setMoLink] = useState({ delay: 0, dur: durFromSpeed(80), ease: 'linear' });
  /** 動畫頁上正在調哪一個元素：'shape' | 'link' | 物件 id */
  const [moTarget, setMoTarget] = useState<string>('shape');
  /** 匯出成影片時的進度（0～1）；null = 沒在匯出 */
  const [videoProg, setVideoProg] = useState<number | null>(null);
  /** 按下「取消匯出」時翻成 true，錄影迴圈下一格就會收工 */
  const videoAbortRef = useRef(false);
  /** 按下儲存後從下方延伸出來的兩顆按鈕 */
  const [exportAsk, setExportAsk] = useState(false);

  const hasLink = linkMode !== 'none' && LINK_TYPES.includes(holeType);
  /** 畫布現在要不要照動畫來畫（暫停時也算：停在那一格） */
  const motionOn = activeTab === 'motion' && saveState === 'idle' && !igPreview;

  /** 一圈跑多久。最晚結束的那個元素跑完，再加上停留時間。 */
  /* 線是「以顆為單位」等的：某一條線的兩端都冒出來之後，那條線才開始長。
     所以圖案還在一顆一顆冒的時候，已經成形的那幾條就可以先連起來，
     而還沒出現的圖案身上不會憑空多出一條線。 */
  const shapeEnd = moEnd(moShape);
  /* 圖案那一群的排程：每顆自己冒出來要 POP 秒，整群在 moShape.dur 之內錯開跑完。
     連線的時間軸要靠它算「第一條線最早什麼時候能開始」。 */
  const shapeTiming = useMemo(() => {
    const n = Math.max(1, holes.length);
    const POP = Math.min(0.5, moShape.dur * 0.45);
    const step = n > 1 ? Math.max(0, (moShape.dur - POP) / (n - 1)) : 0;
    /* 連線用的門檻：圖案「已經看得出來」就可以開始連，不必等它完全長好。
       用 POP 的兩成當門檻 —— 幾乎跟圖案同時，但仍然是「先有圖案才有線」。 */
    return { n, POP, step, upAt: (i: number) => moShape.delay + i * step + POP * 0.2 };
  }, [holes.length, moShape.delay, moShape.dur]);
  /* 連線的「進場耗時」＝從第一條線能開始畫算起，這麼多秒之內全部畫完。
     第一條線最早要等到第二顆圖案冒出來（一條線要有兩端）。 */
  const linkStart = shapeTiming.upAt(Math.min(1, shapeTiming.n - 1)) + Math.max(0, moLink.delay);
  const motionTotal = useMemo(() => {
    let end = moEnd(moShape);
    // 最後一條線要等最後一顆圖案冒完才開始，然後同樣畫滿一整段
    if (hasLink) end = Math.max(end, shapeEnd + Math.max(0, moLink.delay) + moLink.dur);
    objects.forEach(o => { end = Math.max(end, moEnd(moOf(o))); });
    return Math.max(1.2, end) + Math.max(0, motionHold);
  }, [moShape, moLink, hasLink, linkStart, shapeEnd, objects, motionHold]);

  /** 給一個時間 t，算出這一格每個元素長什麼樣 */
  const buildAnim = useCallback((t: number) => {
    const nHole = Math.max(1, holesRef.current.length);
    // 圖案是一群，進場要在 moShape.dur 之內一顆一顆錯開
    const POP = Math.min(0.5, moShape.dur * 0.45);
    const stepH = nHole > 1 ? Math.max(0, (moShape.dur - POP) / (nHole - 1)) : 0;
    const shapeCfg = (i: number): MoCfg => ({ ...moShape, delay: moShape.delay + i * stepH, dur: POP });
    /** 第 i 顆圖案「已經看得出來」的時間（POP 的兩成）——線從這一刻就能接上去 */
    const holeUpAt = (i: number) => moShape.delay + i * stepH + POP * 0.2;
    const ez = linkEase(moLink.ease);
    return {
      hole: (h: any, i: number) => composeMo(shapeCfg(i), t, hashId(h.id) % 628 / 100),
      /* 每條線各自等自己的兩端冒出來才開始畫，而且「每條線畫的時間都一樣長」。
         以前是讓所有線在同一個時間點收工，晚開始的那幾條就被壓縮成很短的時間，
         看起來就是「畫到後面突然變快」。現在速度從頭到尾一致。 */
      link: (ia: number, ib: number) => {
        if (!hasLink) return 1;
        const st = Math.max(holeUpAt(ia), holeUpAt(ib)) + Math.max(0, moLink.delay);
        const span = Math.max(0.1, moLink.dur);
        return ez(Math.max(0, Math.min(1, (t - st) / span)));
      },
      obj: (o: any, i: number) => composeMo(moOf(o), t, (hashId(o.id) % 628) / 100 + i * 0.7),
    };
  }, [moShape, moLink, hasLink, linkStart]);

  /* 播放迴圈。時鐘存在 ref 裡，所以「換個參數 / 拖一下物件」讓這個 effect
     重跑時，動畫是接著走的，不會每動一下就跳回第一格。
     動畫每一格都要重烤整張圖，60Hz 跑滿的話手機的畫布記憶體會被系統回收
     （就是「播一播突然回到主畫面」），所以這裡壓到 30fps 就好 ——
     肉眼看起來一樣順，但每秒少烤一半的圖。 */
  const motionClockRef = useRef(0);
  /* 拖滑桿時 holes 每一格都是新陣列 → renderToCanvas 的身分跟著換 →
     播放迴圈會被拆掉重建幾十次。走 ref 就不會，rAF 從頭到尾只有一個。 */
  const renderToCanvasRef = useRef(renderToCanvas);
  renderToCanvasRef.current = renderToCanvas;
  useEffect(() => {
    if (!motionOn || !motionPlaying || !imageState || videoProg !== null) return;
    let raf = 0;
    let last = -1;
    const FRAME = 1000 / 30;
    const t0 = performance.now() - motionClockRef.current * 1000;
    /* 自適應保險絲。閃退的成因永遠是同一件事：一格還沒畫完就又排下一格，
       工作愈積愈多、記憶體與 GC 一路堆到被系統回收。
       這裡只調「每秒畫幾格」，完全不動解析度 —— 畫面該多細就是多細，
       只是在跟不上的機器上改成 20fps／12fps，把每一格之間的空檔讓出來。 */
    let slow = 0, fast = 0;
    let interval = FRAME;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      if (last >= 0 && now - last < interval) return;
      last = now;
      try {
        motionClockRef.current = ((now - t0) / 1000) % motionTotal;
        animRef.current = buildAnim(motionClockRef.current);
        const t1 = performance.now();
        if (canvasRef.current) renderToCanvasRef.current(canvasRef.current, motionScaleRef.current);
        const cost = performance.now() - t1;
        // 一格畫超過「一格的時間」就是追不上了，連續幾次就把格數降一階
        if (cost > interval * 0.9) { slow++; fast = 0; } else if (cost < interval * 0.45) { fast++; slow = 0; }
        if (slow >= 5 && interval < 1000 / 12) {
          interval = interval < 1000 / 20 ? 1000 / 20 : 1000 / 12;
          slow = 0;
        } else if (fast >= 90 && interval > FRAME) {
          interval = interval > 1000 / 20 ? 1000 / 20 : FRAME;
          fast = 0;
        }
      } catch (err) {
        // 單一格畫壞不該把整個工具帶走 —— 停下來、收回靜態就好
        console.error('動畫這一格畫不出來', err);
        cancelAnimationFrame(raf);
        animRef.current = null;
        setMotionPlaying(false);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [motionOn, motionPlaying, motionSeq, imageState, videoProg, buildAnim, motionTotal]);

  /* 分頁被切到背景時停掉：背景分頁的 rAF 會被節流成幾秒一格，
     但畫布記憶體還是佔著，回來時很容易就是「已經被回收」那一頁。 */
  useEffect(() => {
    const onVis = () => { if (document.hidden) setMotionPlaying(false); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  /* 暫停時要把「停住的那一格」留在畫布上：animRef 還是那一格，
     但因為迴圈停了，任何 React 重繪都得自己重畫一次才對得上。 */
  useEffect(() => {
    if (!motionOn || motionPlaying || !imageState || !canvasRef.current || videoProg !== null) return;
    animRef.current = buildAnim(motionClockRef.current);
    renderToCanvas(canvasRef.current, motionScaleRef.current);
  }, [motionOn, motionPlaying, imageState, videoProg, buildAnim, renderToCanvas]);

  /* 離開動畫頁要把畫面收回靜態，不然會停在動畫的某一格。
     這裡一定要「自己重畫一次」——setForceRender 只是讓元件重新 render，
     負責畫布的那個 effect 相依的是 renderCanvas 的身分，不會因此重跑，
     所以畫面會原封不動停在最後那一格。 */
  useEffect(() => {
    if (motionOn || videoProg !== null) return;
    motionClockRef.current = 0;
    animRef.current = null;
    if (canvasRef.current && imageState) renderToCanvas(canvasRef.current, previewScaleRef.current);
    setForceRender(p => p + 1);
  }, [motionOn, videoProg, imageState, renderToCanvas]);

  /* 播放列的進場／離場。
     barMounted：離開動畫頁之後還要多留一拍才卸載，不然看不到滑出去那一段。
     barIn：掛上去的第一格必須還是「在下面」的狀態，下一格才翻成「上來」——
            一掛上去就是最終狀態的話，瀏覽器沒有起點可以補間，
            看起來就是「啪」一聲直接出現。 */
  const [barMounted, setBarMounted] = useState(false);
  const [barIn, setBarIn] = useState(false);
  useEffect(() => {
    if (activeTab === 'motion') {
      setBarMounted(true);
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setBarIn(true)));
      return () => cancelAnimationFrame(r);
    }
    setBarIn(false);
    const t = window.setTimeout(() => setBarMounted(false), 460);
    return () => window.clearTimeout(t);
  }, [activeTab]);

  /** 從頭播一次。換動畫種類時自動叫它 —— 不然改完要自己等一圈才看得到。 */
  const replayMotion = useCallback(() => {
    motionClockRef.current = 0;
    setMotionPlaying(true);
    setMotionSeq(n => n + 1);
  }, []);

  /* 一進動畫頁就從頭播，同時把選取清掉、鎖住畫布上的互動 */
  useEffect(() => {
    motionLockRef.current = activeTab === 'motion';
    if (activeTab !== 'motion') return;
    setSelectedTarget(null);
    setSelectedObj(null);
    motionClockRef.current = 0;
    setMotionPlaying(true);
    setMotionSeq(n => n + 1);
  }, [activeTab]);

  /* 第二篇貼文的動畫：直接在一張 canvas 上「當場播」。
     以前是先用 MediaRecorder 錄成影片再放 —— 錄影是即時的，一圈幾秒就要等幾秒，
     所以會停在那邊很久、然後突然閃一下才開始播。現在開啟預覽就立刻在動。 */
  const igCanvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!igPreview || !imageState) return;
    const off = getLayoutOffsets();
    if (!off) return;
    /* 算圖倍率照「這張畫布在螢幕上實際佔幾個裝置像素」來給，而不是寫死 720 ——
       寫死的話在 3 倍螢幕上等於把 720 拉成 1170，當然糊。
       另外多 1.15 倍的超取樣，邊緣才不會有鋸齒。 */
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const longSide = Math.max(off.cw, off.ch);
    let scale = Math.max(0.35, 720 / longSide);
    const fitScale = () => {
      const cv = igCanvasRef.current;
      if (!cv) return;
      const r = cv.getBoundingClientRect();
      const shownLong = Math.max(r.width, r.height);
      if (shownLong < 8) return;
      const want = Math.min(1600, shownLong * dpr * 1.15) / longSide;
      const next = Math.max(0.35, Math.round(want * 20) / 20);
      if (Math.abs(next - scale) > 0.02) scale = next;
    };
    let raf = 0, last = -1, fitTick = 0;
    const FRAME = 1000 / 30;
    const t0 = performance.now();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      if (last >= 0 && now - last < FRAME) return;
      last = now;
      const cv = igCanvasRef.current;
      if (!cv) return;
      try {
        // 版面可能還在安頓（比例、字型），前兩秒每 10 格重新對一次尺寸
        if (fitTick++ % 10 === 0 && fitTick < 60) fitScale();
        animRef.current = buildAnim(((now - t0) / 1000) % motionTotal);
        renderToCanvasRef.current(cv, scale);
      } catch (e) {
        console.error('預覽的動畫畫不出來', e);
        cancelAnimationFrame(raf);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); animRef.current = null; };
  }, [igPreview, imageState, getLayoutOffsets, buildAnim, motionTotal]);

  /** 改某個物件的動態設定 */
  const patchMo = useCallback((id: string, d: Partial<MoCfg>) => {
    setObjects(prev => prev.map(o => o.id === id ? { ...o, mo: { ...moOf(o), ...d } } : o));
  }, []);

  /* ── 匯出成影片 ────────────────────────────────────────────────
     跟預覽同一條算圖管線，只是畫在一張離屏畫布上。解析度直接吃
     MOTION_MAX_DIM（不再是 720），碼率也拉到 40Mbps —— 之前預覽糊
     就是因為先壓成 720p 的影片再放大來看。 */
  const exportVideo = useCallback(async () => {
    const off = getLayoutOffsets();
    if (!off || !imageState || videoProg !== null) return;
    setVideoProg(0);
    setSelectedTarget(null);
    setSelectedObj(null);
    // 等一格，讓「取消選取」先進畫面，選取框才不會被錄進去
    await new Promise(r => requestAnimationFrame(() => r(null)));
    const cv = document.createElement('canvas');
    try {
      /* renderScale 是「相對於工作區大小」的倍率，不是像素數 ——
         以前寫成 min(1, 720/長邊)，長邊本來就小於 720 的話等於 scale=1，
         影片就只剩工作區那點解析度，放大來看當然糊。
         現在走的是「跟存成圖片完全同一條算式」，只是多一個 MOTION_MAX_DIM
         的上限（編碼器與記憶體的現實），所以影片的清晰度就是成品本人。 */
      const rawSize = collageSizeOf(layout, imageState.originalW, imageState.originalH, maskScale);
      const cap = Math.min(MOTION_MAX_DIM, MAX_FINAL_DIM);
      const k = Math.max(rawSize.w, rawSize.h) > cap ? cap / Math.max(rawSize.w, rawSize.h) : 1;
      const scale = Math.floor(imageState.originalW * k) / imageState.baseW;
      animRef.current = buildAnim(0);
      renderToCanvas(cv, scale);          // 先畫第一格，不然開頭會錄到黑畫面
      const mime = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm']
        .find(t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) || '';
      const stream = (cv as any).captureStream(60);
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 40_000_000 } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      const done = new Promise<Blob>(res => { rec.onstop = () => res(new Blob(chunks, { type: mime || 'video/webm' })); });
      videoAbortRef.current = false;
      rec.start();
      // 錄兩圈：轉成 GIF 或用播放器 loop 時，接縫處才確定是連續的
      const span = motionTotal * 2;
      await new Promise<void>(resolve => {
        const t0 = performance.now();
        const frame = () => {
          const el = (performance.now() - t0) / 1000;
          animRef.current = buildAnim(el % motionTotal);
          renderToCanvas(cv, scale);
          setVideoProg(Math.min(0.99, el / span));
          if (el >= span || videoAbortRef.current) return resolve();
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      rec.stop();
      const blob = await done;
      // 取消：錄到一半的東西直接丟掉，什麼都不改
      if (videoAbortRef.current) return;
      revokeUrl(finalUrlRef.current);
      const url = URL.createObjectURL(blob);
      finalUrlRef.current = url;
      setFinalIsVideo(true);
      setFinalImage(url);
      setSaveState('success');
    } catch (e) {
      console.error('動態影片做不出來', e);
    } finally {
      cv.width = 0; cv.height = 0;
      animRef.current = null;
      setVideoProg(null);
    }
  }, [getLayoutOffsets, imageState, videoProg, buildAnim, motionTotal, renderToCanvas]);
  const handleSave = () => {
    if (!imageState) return;
    setSelectedTarget(null);
    setFinalIsVideo(false);
    setSaveState('processing');
    
    setTimeout(async () => {
      try {
        const { originalW, originalH, baseW, baseH } = imageState;
        
        // 1. Calculate the collage total size at original resolution
        const rawSize = collageSizeOf(layout, originalW, originalH, maskScale);

        /* 兩道保險，缺一不可：
             ① 最長邊 ≤ 4096（Safari Mobile 的單邊上限）
             ② 總像素 ≤ MAX_EXPORT_PIXELS（真正會爆的是面積不是邊長）
           而且量的是「拼完之後的畫布」不是原圖 —— 拿原圖量的話，
           四周包圍那種畫布是原圖的 1.67 倍寬高，會整個超出去。 */
        let finalScale = 1.0;
        if (Math.max(rawSize.w, rawSize.h) > MAX_FINAL_DIM) {
          finalScale = MAX_FINAL_DIM / Math.max(rawSize.w, rawSize.h);
        }
        const area = rawSize.w * finalScale * rawSize.h * finalScale;
        if (area > MAX_EXPORT_PIXELS) finalScale *= Math.sqrt(MAX_EXPORT_PIXELS / area);

        const exportW = Math.floor(originalW * finalScale);
        const exportScale = exportW / baseW;

        const exportCanvas = document.createElement('canvas');
        /* 存成圖片時一律用「靜態的那一張」：所有元素都在自己的原位、
           原尺寸。不然會存到動畫半途，位置跟編輯時看到的對不上。 */
        animRef.current = null;
        renderToCanvas(exportCanvas, exportScale);
        
        // 一樣是無損 PNG，只是改用 blob 網址拿在手上（dataURL 會多吃一份 33% 膨脹的字串）
        const url = await canvasToUrl(exportCanvas);
        revokeUrl(finalUrlRef.current);
        finalUrlRef.current = url;
        setFinalImage(url);
        setSaveState('success');
        
        // Explicit cleanup
        exportCanvas.width = 0; exportCanvas.height = 0;
      } catch (e) {
        console.error("Failed to save collage", e);
        setSaveState('idle');
      }
    }, 150);
  };

  /* ── 動畫頁的讓位 ────────────────────────────────────────────
     播放列浮在畫面下緣，會壓到預覽圖。進動畫頁時把圖往上讓開：
       ① 上方還有空白 → 純粹往上移（圖不變小，最自然）
       ② 空白不夠 → 剩下的差額用「從頂部往內縮」補（頂部位置不動）
     兩段都是 CSS transform，所以是流暢的過場，不會重新排版也不會重畫。 */
  /* 播放列自己離工具欄頂部 12px（bottom-3）。圖片離播放列也要一樣是 12px，
     所以要讓開的高度 ＝ 12（下） ＋ 播放列高度 ＋ 12（上）。 */
  const MOTION_CLEAR = 12 + 54 + 12;
  const motionUiOn = activeTab === 'motion' && !!imageState;
  const { mLift, mScale } = (() => {
    if (!motionUiOn || !baseCss || !stageSize.h) return { mLift: 0, mScale: 1 };
    const Hc = baseCss.h * viewT.k;                    // 圖在畫面上的高度
    /* 圖是以「舞台中心」為準置中的（外面那層有 p-4，但上下對稱所以中心不變），
       所以圖的下緣＝舞台中心 ＋ Hc/2，而播放列的上緣＝舞台底部 − MOTION_CLEAR。 */
    const overlap = Hc / 2 - stageSize.h / 2 + MOTION_CLEAR;
    if (overlap <= 0) return { mLift: 0, mScale: 1 };
    const free = Math.max(0, (stageSize.h - 32 - Hc) / 2);   // 圖上方還剩多少空白（扣掉 p-4）
    const lift = Math.min(overlap, free);
    const remain = overlap - lift;
    return { mLift: lift, mScale: remain > 0 ? Math.max(0.5, (Hc - remain) / Hc) : 1 };
  })();
  const MOTION_EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

  const selectedHole = holes.find(hx => hx.id === selectedTarget);
  const displayAngle = selectedHole ? (selectedHole.angle ?? holeAngle) : holeAngle;

  const handleAngleChange = (val: number) => {
    if (selectedTarget) {
      setHoles(prev => prev.map(h => h.id === selectedTarget ? { ...h, angle: val } : h));
    } else {
      setHoleAngle(val);
    }
  };

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-[#0A0A0A] text-white font-sans overflow-hidden animate-in fade-in duration-300">
      <style>{`
        .no-select {
            -webkit-user-select: none !important;
            -moz-user-select: none !important;
            -ms-user-select: none !important;
            user-select: none !important;
        }
        .no-callout {
            -webkit-touch-callout: none !important;
            -webkit-user-select: none !important;
            -moz-user-select: none !important;
            -ms-user-select: none !important;
            user-select: none !important;
        }
        .allow-callout {
            -webkit-touch-callout: default !important;
            -webkit-user-select: auto !important;
            -moz-user-select: auto !important;
            -ms-user-select: auto !important;
            user-select: auto !important;
            pointer-events: auto !important;
            touch-action: auto !important;
            cursor: pointer !important;
            z-index: 150 !important;
            display: block !important;
        }
        .interactive-area {
            touch-action: none;
        }
        .main-canvas-container {
            position: relative;
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        /* 圖片編輯那一頁的滑桿：跟「編輯」「經典拼圖」用同一組樣式，連軌道與圓點都一樣。
           這一份是從 GridLayoutTool 逐字複製過來的 —— 那顆面板是共用元件，
           樣式卻寫在各自的 <style> 裡，少這一份就會退回瀏覽器原生滑桿。 */
        .custom-range {
          -webkit-appearance: none;
          width: calc(100% + 64px);
          height: 40px;
          background: rgba(0,0,0,0);
          outline: none;
          margin: 0 -32px;
          padding: 0;
          touch-action: none;
          -webkit-tap-highlight-color: rgba(0,0,0,0);
        }
        .custom-range:focus { outline: none; }
        .custom-range.dense { height: 26px; width: 100%; margin: 0; }
        .custom-range.dense::-webkit-slider-runnable-track {
          background: linear-gradient(to right, rgba(0,0,0,0) 9px, #333 9px, #333 calc(100% - 9px), rgba(0,0,0,0) calc(100% - 9px));
        }
        .custom-range.dense::-moz-range-track {
          background: linear-gradient(to right, rgba(0,0,0,0) 9px, #333 9px, #333 calc(100% - 9px), rgba(0,0,0,0) calc(100% - 9px));
        }
        .custom-range.dense::-webkit-slider-thumb { height: 26px; width: 18px; margin-top: -12px; }
        .custom-range.dense::-moz-range-thumb { height: 26px; width: 18px; }
        .custom-range::-webkit-slider-runnable-track {
          width: 100%;
          height: 2px;
          background: linear-gradient(to right, rgba(0,0,0,0) 32px, #333 32px, #333 calc(100% - 32px), rgba(0,0,0,0) calc(100% - 32px));
          border-radius: 2px;
          cursor: pointer;
        }
        .custom-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          height: 64px;
          width: 64px;
          background-color: rgba(0,0,0,0);
          background-image: radial-gradient(circle at center, #ffffff 0, #ffffff 7.5px, rgba(255,255,255,0) 8px, rgba(255,255,255,0) 100%);
          border: none;
          outline: none;
          cursor: pointer;
          margin-top: -31px;
          transition: transform 0.1s;
          box-shadow: none;
        }
        .custom-range::-webkit-slider-thumb:active { transform: scale(1.15); }
        .custom-range::-moz-range-track { height: 2px; background: #333; border-radius: 2px; }
        .custom-range::-moz-range-thumb {
          height: 15px; width: 15px; border-radius: 50%;
          background: #fff; border: none; cursor: pointer;
        }
        .premium-slider { -webkit-appearance: none; width: 100%; height: 2px; background: #222; border-radius: 2px; outline: none; touch-action: none; }
        .premium-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #fff; cursor: pointer; }
        /* 圓球跟經典拼圖的顏色滑桿一致：沿用原生 thumb + accent-color，不自己畫 */
        .designer-color-slider { -webkit-appearance: none; appearance: none; width: 100%; height: 6px; border-radius: 3px; outline: none; touch-action: none; accent-color: #ffffff; cursor: pointer; }
      `}</style>

      {/* 匯出影片的進度。用同一條算圖管線一格一格畫，所以會花一點時間。 */}
      {videoProg !== null && (
        <div className="fixed inset-0 z-[116] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center gap-4">
          <div className="w-12 h-12 border-4 border-white/10 border-t-white rounded-full animate-spin" />
          <span className="text-[11px] tracking-[0.3em] text-white/60 tabular-nums">{Math.round(videoProg * 100)}%</span>
          <span className="text-[11px] text-white/50 tracking-widest">正在匯出影片</span>
          <button
            onClick={() => { videoAbortRef.current = true; }}
            className="mt-2 px-6 h-10 rounded-full border border-white/20 bg-white/5 text-white text-[11px] font-bold tracking-widest hover:bg-white/10 active:scale-95 transition-all"
          >
            取消匯出
          </button>
        </div>
      )}

      {/* IG 貼文預覽：跟經典拼圖共用 components/IgPreview.tsx。
          創意拼圖是兩篇 —— 上面圖片版、下面影片版。
          跟真的 IG 動態牆一樣「一篇接一篇往下捲」，滑多少算多少，
          不是一頁一頁地吸過去（所以沒有 scroll-snap）。
          歌是共用的（走 igMusic），帳號、數字、按讚各自獨立（走 slot）。 */}
      {igPreview && (
        <div
          className="fixed inset-0 z-[120] bg-black overflow-y-auto animate-in fade-in duration-200"
          /* none 而不是 contain：contain 只擋住「傳給外層」，自己還是會橡皮筋。
             已經在第一篇的最上面時再往上拉，畫面不該有任何位移。 */
          style={{ overscrollBehavior: 'none', scrollbarWidth: 'none', paddingTop: IG_EDGE, paddingBottom: IG_EDGE }}
        >
          {(['pic', 'vid'] as const).map((kind, i) => (
            /* 貼文與貼文之間、以及頭尾，統一都是同一個間距 */
            <div key={kind} className="w-full" style={{ marginTop: i === 0 ? 0 : IG_GAP }}>
              <IgPreview
                shots={igShots}
                frame={(() => { const o = getLayoutOffsets(); return o ? { w: o.cw, h: o.ch } : { w: 1, h: 1 }; })()}
                pageCount={1}
                /* 頭像與「說讚」那排的小頭像：用剛算好的成品那張，一定拿得到、
                   也一定是這張拼圖裡的畫面（原始照片那顆 Image 的 blob 網址
                   在某些流程下已經被回收，直接拿會變成破圖） */
                faces={igShots}
                supported={igSupported}
                slot={kind}
                embedded
                flow
                /* 影片版直接放一張正在跑動畫的畫布 —— 開啟當下就在動 */
                mediaNode={kind === 'vid'
                  ? <canvas ref={igCanvasRef} className="max-w-full max-h-full object-contain block" />
                  : undefined}
                /* 影片那篇也不給音量鍵：預覽本來就沒有聲音，多一顆只會擋到畫面 */
                hasVideo={(_i: number) => false}
                music={igMusic}
                onMusicChange={setIgMusic}
                onClose={() => setIgPreview(false)}
              />
            </div>
          ))}

        </div>
      )}

      {/* 構圖：跟「編輯」同一個介面，套用後 bake 回這個物件 */}
      {composeState && (
        <ComposeStudio
          image={composeState.img}
          geo={composeState.geo}
          onChange={g => setComposeState(st => (st ? { ...st, geo: g } : st))}
          onCancel={() => setComposeState(null)}
          onApply={applyComposeToObj}
        />
      )}

      {saveState === 'success' && finalImage && (
        <div className="absolute inset-0 z-[110] bg-black flex flex-col animate-in fade-in duration-500">
          <header className="h-14 flex items-center px-5 shrink-0 z-20 bg-black/40 backdrop-blur-xl">
            <button 
              onClick={(e) => { e.stopPropagation(); onHome(); }}
              className="p-2 -ml-2 text-[#888] hover:text-white transition-colors active:scale-90"
            >
              <ChevronLeft size={22} />
            </button>
          </header>
          <div className="flex-1 flex flex-col items-center justify-center p-6 relative">
            <div className="relative shadow-2xl rounded overflow-hidden max-h-[60vh] max-w-full mb-4">
              {finalIsVideo ? (
                <video
                  src={finalImage}
                  autoPlay loop muted playsInline controls
                  className="max-w-full max-h-[60vh] object-contain relative z-10"
                />
              ) : (
                <img 
                  src={finalImage} 
                  alt="Final Result" 
                  className="max-w-full max-h-[60vh] object-contain allow-callout relative z-10" 
                />
              )}
              <div className="absolute inset-0 pointer-events-none ring-1 ring-white/10 rounded"></div>
            </div>
          </div>
          <div className="bg-black flex flex-col gap-3 px-6 pb-6 pt-2">
            <SaveButton urls={finalImage ? [finalImage] : []} />
            <div className="flex items-center justify-center gap-4">
            <button 
              onClick={(e) => { e.stopPropagation(); setSaveState('idle'); }}
              className="flex-1 h-14 rounded-full border border-white/20 bg-white/5 text-white font-bold tracking-widest uppercase hover:bg-white/10 active:scale-95 transition-all text-sm"
            >
              繼續編輯
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); onImportNew(); }}
              className="flex-1 h-14 rounded-full border border-white/20 bg-white/5 text-white font-bold tracking-widest uppercase hover:bg-white/10 active:scale-95 transition-all text-sm"
            >
              拼下一張
            </button>
            </div>
          </div>
        </div>
      )}

      {saveState === 'processing' && (
        <div className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center animate-in fade-in duration-300">
          <div className="w-16 h-16 border-4 border-white/10 border-t-white rounded-full animate-spin mb-6"></div>
          <p className="text-lg font-black uppercase tracking-[0.3em] animate-pulse text-white">正在存檔</p>
          <p className="text-[10px] text-white/40 mt-3 uppercase tracking-widest font-bold">優化高品質渲染中</p>
        </div>
      )}

      {/* 這一列的排法整個照抄經典拼圖：返回｜筆刷｜分隔線｜復原｜重做｜分隔線｜三個點｜儲存。
          只有筆刷是創意拼圖自己的，留在外面；對稱收進三個點裡面。 */}
      {saveState !== 'success' && (
      <header className="h-14 border-b border-[#1a1a1a] flex items-center justify-between px-4 z-[100] bg-black/90 backdrop-blur-md">
        <button
          onClick={(e) => { e.stopPropagation(); onHome(); }}
          className="p-2 -ml-2 text-[#aaa] hover:text-white transition-colors active:scale-90"
          title="繼續編輯"
        >
          <ChevronLeft size={22} />
        </button>

        {imageState && (
          <div className="flex items-center gap-2">
            {/* 畫筆／橡皮擦：創意拼圖獨有，留在外面 */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setBrushMode(prev => {
                  if (prev === 'off') return 'pen';
                  if (prev === 'pen') return 'eraser';
                  return 'off';
                });
              }}
              className={`p-1.5 rounded-md border transition-all active:scale-90 flex items-center justify-center ${
                brushMode === 'pen' || brushMode === 'eraser'
                  ? 'bg-white/10 border-white text-white font-bold shadow-[0_0_8px_rgba(255,255,255,0.2)]'
                  : 'bg-transparent border-transparent text-[#888] hover:text-white'
              }`}
              title={brushMode === 'pen' ? '畫筆模式（再按切換為橡皮擦）' : brushMode === 'eraser' ? '橡皮擦模式（再按關閉）' : '開啟畫筆'}
            >
              {brushMode === 'eraser' ? <Eraser size={18} /> : brushMode === 'pen' ? <Paintbrush size={18} /> : <MousePointer size={18} />}
            </button>

            <div className="w-px h-4 bg-white/10 mx-1 shrink-0" />

            <button
              onClick={(e) => { e.stopPropagation(); undo(); }}
              disabled={historyState.index <= 0}
              className={`p-2 text-white transition-all ${historyState.index <= 0 ? 'opacity-20 pointer-events-none' : 'opacity-100 active:scale-90'}`}
              title="復原"
            >
              <Icon name="undo" className="text-xl" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); redo(); }}
              disabled={historyState.index >= historyState.history.length - 1}
              className={`p-2 text-white transition-all ${historyState.index >= historyState.history.length - 1 ? 'opacity-20 pointer-events-none' : 'opacity-100 active:scale-90'}`}
              title="重做"
            >
              <Icon name="redo" className="text-xl" />
            </button>

            <div className="w-px h-4 bg-white/10 mx-1 shrink-0" />

            {/* 三個點：對稱與對齊都收在這裡（樣式跟經典拼圖同一份） */}
            <div className="relative">
              <button
                onClick={() => setMoreOpen(o => !o)}
                className={`w-9 h-9 flex items-center justify-center transition-colors active:scale-90 ${moreOpen ? 'text-white' : 'text-white/70'}`}
                title="更多"
              >
                <Icon name="more_horiz" className="text-xl" />
              </button>
              {moreOpen && (
                <>
                  <div className="fixed inset-0 z-[60]" onClick={() => setMoreOpen(false)} />
                  <div className="absolute right-0 top-11 z-[61] w-36 rounded-2xl bg-[#1b1b1b] border border-white/10 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                    {/* 最上面是 IG 預覽，跟經典拼圖同一顆（比例 IG 吃不下時整個不出現） */}
                    {igSupported && (
                      <>
                        <button
                          onClick={() => { setMoreOpen(false); setIgPreview(true); }}
                          className="w-full h-11 px-4 flex items-center text-[12px] font-bold text-white/90 hover:bg-white/10 transition-colors"
                        >
                          <span>預覽</span>
                        </button>
                        <div className="h-px bg-white/10" />
                      </>
                    )}
                    {/* 四周包圍是一整片場、沒有「左右兩塊要對稱」的概念，那個排版下就不出現 */}
                    {layout !== AROUND && (
                      <>
                        <div className="w-full h-11 px-4 flex items-center text-[12px] font-bold text-white/90">
                          <span>對稱</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleSymmetry(); }}
                            role="switch"
                            aria-checked={symmetryEnabled}
                            title={symmetryEnabled ? '對稱鎖定：開啟中' : '對稱鎖定：已解除'}
                            className={`ml-auto relative shrink-0 w-[38px] h-[22px] rounded-full transition-colors duration-200 ${
                              symmetryEnabled ? 'bg-white' : 'bg-white/[0.14]'
                            }`}
                          >
                            <span className={`absolute top-[3px] left-[3px] w-4 h-4 rounded-full transition-transform duration-200 ease-out ${
                              symmetryEnabled ? 'translate-x-4 bg-black' : 'translate-x-0 bg-white/45'
                            }`} />
                          </button>
                        </div>
                        <div className="h-px bg-white/10" />
                      </>
                    )}
                    <div className="w-full h-11 px-4 flex items-center text-[12px] font-bold text-white/90">
                      <span>對齊</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEnableSnapping(v => {
                            if (v) { guidesRef.current = []; setGuides([]); }
                            return !v;
                          });
                        }}
                        role="switch"
                        aria-checked={enableSnapping}
                        title={enableSnapping ? '關閉對齊' : '開啟對齊'}
                        className={`ml-auto relative shrink-0 w-[38px] h-[22px] rounded-full transition-colors duration-200 ${
                          enableSnapping ? 'bg-white' : 'bg-white/[0.14]'
                        }`}
                      >
                        <span className={`absolute top-[3px] left-[3px] w-4 h-4 rounded-full transition-transform duration-200 ease-out ${
                          enableSnapping ? 'translate-x-4 bg-black' : 'translate-x-0 bg-white/45'
                        }`} />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* 儲存：點一下，兩顆選項從它正下方延伸出來（不論有沒有設動畫都有影片） */}
            <div className="relative shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); setExportAsk(v => !v); }}
                className={`px-6 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider shadow-lg active:scale-95 transition-all whitespace-nowrap ${
                  exportAsk ? 'bg-white/15 text-white' : 'bg-white text-black'
                }`}
              >
                儲存
              </button>
              {/* 展開／收合都走同一組 transition，所以兩個方向都是順的 */}
              <div
                className="absolute right-0 top-full mt-2 z-[60] flex flex-col gap-2 origin-top-right transition-all duration-200 ease-out"
                style={{
                  opacity: exportAsk ? 1 : 0,
                  transform: exportAsk ? 'translateY(0) scale(1)' : 'translateY(-6px) scale(0.94)',
                  pointerEvents: exportAsk ? 'auto' : 'none',
                }}
              >
                {([
                  ['圖片', <ImageIcon key="i" size={13} />, () => handleSave()],
                  ['影片', <Film key="v" size={13} />, () => exportVideo()],
                ] as const).map(([name, icon, run], i) => (
                  <button
                    key={name}
                    onClick={(e) => { e.stopPropagation(); setExportAsk(false); (run as () => void)(); }}
                    style={{ transitionDelay: exportAsk ? `${i * 45}ms` : '0ms' }}
                    className="pl-3 pr-4 h-9 rounded-full bg-[#141414] border border-white/15 text-white text-[11px] font-bold tracking-widest whitespace-nowrap shadow-[0_6px_20px_rgba(0,0,0,0.6)] active:scale-95 hover:bg-[#1d1d1d] transition-all duration-200 flex items-center gap-2"
                  >
                    {icon}儲存{name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleImageUpload} />
        <input type="file" accept="image/*" className="hidden" ref={maskFileInputRef} onChange={handleMaskImageUpload} />
      </header>
      )}
      
      <main 
        className="flex-1 flex items-center justify-center relative p-4 interactive-area overflow-hidden no-callout no-select"
        onPointerDown={() => { setSelectedTarget(null); setExportAsk(false); }}
      >
        {imageState && (
          <div
            ref={stageRef}
            className="absolute inset-0 overflow-hidden"
            style={{ touchAction: 'none' }}
            /* 手勢掛在整個工作區上，不是只有畫布：選中物件之後，
               畫布外面那片黑底也能拖、也能兩指縮放。挖洞／筆刷本來就會
               檢查座標落在哪一塊，落在黑底上就自然什麼都不做。 */
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={(e) => {
              const c = stageBox();
              const v = viewTRef.current;
              const k = Math.max(1, Math.min(6, v.k * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
              const ax = e.clientX - c.x, ay = e.clientY - c.y;
              applyView(k, ax - ((ax - v.tx) / v.k) * k, ay - ((ay - v.ty) / v.k) * k);
            }}
          >
            <div
              className="w-full h-full flex items-center justify-center p-4"
              /* 只平移，不縮放。
                 縮放交給畫布自己的 CSS 尺寸 —— transform: scale() 會讓瀏覽器
                 先把畫布用「版面尺寸」光柵化成一張貼圖再拉大，畫布內部畫得再細
                 也救不回來，那就是圖案與遮罩邊緣一直有鋸齒的根本原因。 */
              style={{
                transform: `translate(${viewT.tx}px, ${viewT.ty}px)`,
                transition: viewPinchRef.current ? 'none' : 'transform 90ms linear',
              }}
            >
              <canvas 
                ref={canvasRef} 
                className={`block drop-shadow-[0_20px_50px_rgba(255,255,255,0.05)] pointer-events-auto ${baseCss ? '' : 'max-w-full max-h-full'}`}
                style={{ 
                  touchAction: 'none',
                  // 1 倍時交給 max-w/max-h 自己貼合；放大之後直接寫死尺寸，
                  // 畫布就是實打實地被排版成那麼大，不經過任何貼圖拉伸
                  ...(baseCss ? { width: baseCss.w * viewT.k, height: baseCss.h * viewT.k } : null),
                  /* 動畫頁的讓位：從頂部往上收，所以頂部位置不動。
                     用 transform 而不是改版面尺寸 —— 改尺寸會重新算圖、會頓，
                     transform 是純合成，整段都很順。 */
                  transformOrigin: 'top center',
                  transform: (mLift || mScale !== 1) ? `translateY(${-mLift}px) scale(${mScale})` : 'none',
                  /* 尺寸過場只在「正在縮放」時才有意義。換排版時畫布形狀會整個換掉，
                     這時候讓寬高做動畫就會看到那種果凍般的伸縮（桌機用滾輪縮放特別明顯）。 */
                  transition: [
                    (viewPinchRef.current || viewT.k === 1 || sizeSnapRef.current) ? '' : 'width 90ms linear, height 90ms linear',
                    `transform 420ms ${MOTION_EASE}`,
                  ].filter(Boolean).join(', '),
                  cursor: brushMode === 'pen' ? 'crosshair' : brushMode === 'eraser' ? 'pointer' : 'default' 
                }}
              />
            </div>
          </div>
        )}

        {/* 選中的圖片／文字下方浮出的工具列 —— 跟經典拼圖同一組動作。
            位置是用畫布的螢幕矩形換算的（畫布內部座標 → CSS 座標）。 */}
        {/* 構圖那一頁是全螢幕的，這排白色鍵不能浮在它上面 */}
        {/* 對齊線亮著、或正在拖形狀滑桿時，這排鍵也要一起讓開 */}
        {imageState && selectedObj && !composeState && !guides.length && !tuningEdge && !objPinching && (() => {
          const o = objects.find(z => z.id === selectedObj);
          const cvsEl = canvasRef.current;
          if (!o || !cvsEl) return null;
          const r = cvsEl.getBoundingClientRect();
          const stEl = stageRef.current;
          const sr = stEl ? stEl.getBoundingClientRect() : { left: 0, top: 0 };
          const ps = previewScaleRef.current;
          const k = r.width / Math.max(1, cvsEl.width / ps);   // 畫布內部單位 → CSS
          const cx = r.left - sr.left + (o.x + o.w / 2) * k;
          const by = r.top - sr.top + (o.y + o.h) * k + 10;
          const act = (fn: () => void) => (ev: React.PointerEvent) => { ev.stopPropagation(); ev.preventDefault(); fn(); };
          /* 比原本多一層：陣列最底下再往下按一次，就整個掉到「所有圖案之下」（below）。
             從 below 往上按就先回到圖案之上的最底層，再往上才是換順序。
             圖片與文字走的是同一套，沒有差別。 */
          const move = (dir: number) => setObjects(prev => {
            const i = prev.findIndex(z => z.id === o.id);
            if (i < 0) return prev;
            const cur = prev[i];
            const n = prev.slice();
            if (dir < 0) {
              if (i === 0) {
                if (cur.below) return prev;               // 已經是最底層了
                n[0] = { ...cur, below: true }; return n;
              }
              const [x0] = n.splice(i, 1); n.splice(i - 1, 0, x0); return n;
            }
            if (cur.below) { n[i] = { ...cur, below: false }; return n; }
            if (i >= prev.length - 1) return prev;
            const [x1] = n.splice(i, 1); n.splice(i + 1, 0, x1); return n;
          });
          const dup = () => {
            const id = Math.random().toString(36).slice(2, 9);
            setObjects(prev => [...prev, { ...o, id, x: o.x + o.w * 0.08, y: o.y + o.h * 0.08 }]);
            setSelectedObj(id);
          };
          return (
            <div
              className="absolute z-[70] flex items-center gap-0.5 bg-white rounded-full p-0.5 shadow-xl pointer-events-auto"
              style={{ left: cx, top: by, transform: 'translateX(-50%)', touchAction: 'none' }}
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              {[
                { t: '下移一層', on: act(() => move(-1)), el: <MoveDown size={14} />, off: objects[0]?.id === o.id && !!o.below },
                { t: '上移一層', on: act(() => move(1)), el: <MoveUp size={14} />, off: objects[objects.length - 1]?.id === o.id && !o.below },
                { t: '複製', on: act(dup), el: <Copy size={14} />, off: false },
                { t: o.type === 'text' ? '編輯文字' : '圖片調整', on: act(() => setActiveTab('objedit')), el: <Sliders size={14} />, off: false },
                { t: '刪除', on: act(() => { setObjects(prev => prev.filter(z => z.id !== o.id)); setSelectedObj(null); }), el: <Trash2 size={14} />, off: false },
              ].map(b => (
                <button key={b.t} title={b.t} disabled={b.off}
                  onPointerDown={b.off ? undefined : b.on}
                  className={`w-7 h-7 rounded-full flex items-center justify-center ${b.off ? 'text-black/25 cursor-default' : 'text-black hover:bg-black/10'}`}>
                  {b.el}
                </button>
              ))}
            </div>
          );
        })()}

        {imageState && (
          <div
            className="absolute right-6 z-[60]"
            /* 動畫頁時往上讓開播放列，並跟著圖片一起平滑移動 */
            style={{ bottom: motionUiOn ? 86 : 24, transition: `bottom 420ms ${MOTION_EASE}` }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button 
              onClick={(e) => {
                e.stopPropagation();
                generateRandomHoles();
              }} 
              className="p-3 bg-[#111] hover:bg-[#1a1a1a] border border-white/10 hover:border-white/20 text-[#aaa] hover:text-white rounded-full active:scale-95 transition-all shadow-[0_4px_16px_rgba(0,0,0,0.5)] flex items-center justify-center backdrop-blur-md"
              title="隨機圖形"
            >
              <RefreshCw size={18} />
            </button>
          </div>
        )}

        {/* 動畫頁的播放列：浮在預覽畫布下緣（工具欄上方），
            把工具欄的空間整條讓出來給參數。
            播放中會自己淡掉（跟影片播放器一樣），才不會一直壓在圖上；
            點一下畫面就回來，暫停時則一直留著。 */}
        {barMounted && imageState && !colorPickerTarget && (
          <div
            className="absolute left-3 right-3 bottom-3 z-30 flex items-center gap-2 rounded-2xl bg-black/55 backdrop-blur-md border border-white/10 px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
            style={{
              /* 進出場跟預覽圖同一段時間、同一條曲線，兩個看起來就是一起動的 */
              opacity: barIn ? 1 : 0,
              transform: barIn ? 'translateY(0)' : 'translateY(130px)',
              transition: `transform 420ms ${MOTION_EASE}, opacity 420ms ${MOTION_EASE}`,
              pointerEvents: barIn ? 'auto' : 'none',
            }}
            onPointerDown={e => e.stopPropagation()}
          >
            <button
              onClick={() => setMotionPlaying(v => !v)}
              title={motionPlaying ? '暫停' : '播放'}
              /* 實心／空心跟著「按鈕上的圖標」走：
                 顯示播放圖標（＝現在是暫停中）時是實心，顯示暫停圖標時是空心白框。 */
              className={`h-9 w-11 shrink-0 rounded-[8px] border flex items-center justify-center transition-all active:scale-90 ${
                motionPlaying
                  ? 'bg-transparent text-white border-white'
                  : 'bg-white text-black border-white'}`}
            >
              {/* 播放中顯示暫停圖標（按下去＝暫停），暫停中顯示播放圖標 */}
              {motionPlaying
                ? <Pause size={15} fill="currentColor" strokeWidth={0} />
                : <Play size={15} fill="currentColor" strokeWidth={0} />}
            </button>
            <button
              onClick={replayMotion}
              title="從頭播"
              className="h-9 w-11 shrink-0 rounded-[8px] border border-white/15 text-white/70 hover:bg-white/10 hover:text-white flex items-center justify-center transition-all active:scale-90"
            >
              <RotateCcw size={15} />
            </button>
            <div className="flex-1 min-w-0">
              <CompactSlider label="循環間隔" value={Math.round(motionHold)} min={0} max={20} step={1}
                onChange={(v: number) => setMotionHold(v)} />
            </div>
          </div>
        )}

      </main>

      <input
        type="file"
        ref={objFileInputRef}
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const url = URL.createObjectURL(f);
          const im = new Image();
          im.onload = () => {
            const offs2 = getLayoutOffsets();
            if (offs2) {
              const id = Math.random().toString(36).slice(2, 9);
              // 新增進來預設佔畫布短邊的四成，置中擺放
              const target = Math.min(offs2.cw, offs2.ch) * 0.4;
              const k = target / Math.max(im.width, im.height);
              const w = im.width * k, h = im.height * k;
              setObjects(prev => [...prev, {
                /* src 一定要留著：濾鏡／特效卡片的縮圖是拿它去重畫的，
                   構圖也要從它重新載一張原圖。所以這條 objectURL 不能 revoke。 */
                id, type: 'image', img: im, src: url,
                x: offs2.cw / 2 - w / 2, y: offs2.ch / 2 - h / 2, w, h, rot: 0,
              }]);
              setSelectedObj(id);
              setSelectedTarget(null);
              setActiveTab('objedit');   // 匯入完直接進編輯頁，跟新增文字一致
            }
          };
          im.src = url;
          e.target.value = '';
        }}
      />

      <footer className={`bg-[#0a0a0a] border-t border-[#1a1a1a] transition-[transform,height] duration-300 ease-out flex flex-col z-[50] no-select ${imageState ? 'translate-y-0' : 'translate-y-full absolute bottom-0 w-full'}`} style={{ height: objEditImage && objSliderOpen ? 'max(34dvh, 300px)' : '34dvh' }}>
        {!colorPickerTarget && (
          <div className="flex px-4 pt-1 border-b border-[#1a1a1a]">
            {['setting', 'shape', 'add', 'objedit', 'motion'].map(id => (
              <button 
                key={id} 
                onClick={() => setActiveTab(id)} 
                className={`flex-1 py-3 text-[11px] font-bold border-b-2 transition-[color] duration-150 ${
                  activeTab === id ? 'text-white border-white' : 'text-[#555] border-transparent'
                }`}
              >
                {id === 'setting' ? <Crop size={16} className="mx-auto" /> : id === 'add' ? <Plus size={16} className="mx-auto" /> : id === 'objedit' ? <SlidersHorizontal size={16} className="mx-auto" /> : id === 'motion' ? <Film size={16} className="mx-auto" /> : <Star size={16} className="mx-auto" />}
              </button>
            ))}
          </div>
        )}
        
        {/* pb-20 本來是留給右下角那顆浮動按鈕的空間，但「圖案」頁是左右分欄、
            自己就會捲，那 80px 只會在下面留一條黑色空白、把工具欄擠得很小。 */}
        {/* 圖片編輯那一頁是「滑桿 5rem ＋ 工具列 6rem ＋ 分類列 h-16」的三段式，
            自己就把整個高度切好了。再包一層 p-5 會整個縮一圈、上面那根滑桿
            還會被擠出可視範圍 —— 所以這一頁完全不加內距，跟經典拼圖一樣。 */}
        {/* overscrollBehavior 用 none 而不是 contain：contain 只擋住「把捲動傳給外層」，
            自己還是會橡皮筋 —— 已經到頂了再往上拉，畫面不該有任何位移。
            動畫頁底部另外留 pb-12，最後一根滑桿才不會貼在最下緣。 */}
        <div ref={scrollContainerRef} style={{ overscrollBehavior: 'none' }} className={`flex-1 ${objEditImage ? 'overflow-hidden' : `p-5 ${activeTab === 'motion' && !colorPickerTarget ? 'pb-12' : (colorPickerTarget || activeTab === 'shape' || activeTab === 'objedit' ? 'pb-5' : 'pb-20')} custom-scrollbar ${
          (activeTab === 'setting' && !colorPickerTarget) ||
          (activeTab === 'add' && !colorPickerTarget) ||
          (activeTab === 'objedit' && !colorPickerTarget) ||
          (activeTab === 'shape' && !colorPickerTarget) ||
          (activeTab === 'motion' && !colorPickerTarget)
            ? 'overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]' 
            : 'overflow-hidden'
        }`}`}>
          {colorPickerTarget ? (
            <ColorPickerEmbedded 
              color={colorPickerTarget === 'mask' ? maskColor : dotColor} 
              onChange={c => { if(colorPickerTarget==='mask') setMaskColor(c); else setDotColor(c); }}
              onClose={() => setColorPickerTarget(null)}
              title={colorPickerTarget === 'mask' ? '遮罩顏色' : '點點'}
            />
          ) : (
            <>
              {activeTab === 'setting' && <div className="max-w-md mx-auto space-y-4 pb-4 animate-in fade-in duration-300">


                <div className="flex gap-4 items-start">
                  <div className="flex flex-col">
                    <div className="text-[10px] font-bold text-[#888] mb-2 uppercase tracking-widest">
                      <span>排版</span>
                    </div>
                    <div className="h-9 flex items-center gap-2 bg-[#111] border border-[#222] px-1.5 rounded-[6px] w-fit">
                      {['mask-bottom', 'mask-top', 'mask-left', 'mask-right', AROUND].map(t => (
                        <button key={t} onClick={() => {
                          // 排版、比例、圖案在同一批更新裡一起換，中間不會露出半舊半新的那一格
                          setLayout(t);
                          if (t === AROUND) setMaskScale(AROUND_SCALE);
                          setSelectedTarget(null);
                          generateRandomHoles(true, t);
                        }} className="focus:outline-none">
                          <LayoutIcon type={t} active={layout === t} />
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col flex-1">
                    <div className="text-[10px] font-bold text-[#888] mb-2 uppercase tracking-widest pl-2">
                      <span>比例</span>
                    </div>
                    <div className="h-9 flex items-center gap-1 bg-[#111] border border-[#222] px-1 rounded-[6px] w-full">
                      {[
                        { label: '1/1', val: 1.0 },
                        { label: '1/2', val: 0.5 },
                        { label: '1/3', val: 1.0 / 3.0 }
                      ].map(s => (
                        <button
                          key={s.label}
                          onClick={() => setMaskScale(s.val)}
                          className={`flex-1 h-6 rounded-[4px] text-[10px] font-bold transition-all border ${
                            Math.abs(maskScale - s.val) < 0.05
                              ? 'border-white text-white bg-transparent'
                              : 'border-transparent text-[#888] hover:text-white bg-transparent'
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                {/* 遮罩的三項（自訂遮罩、顏色、紋理）接在排版與比例下面 ——
                    它們講的都是「這張版面長什麼樣」，本來就該在同一頁。
                    -mt-1 是為了讓它跟上面那排的間距，跟這三項彼此之間一樣。 */}
                <div className="space-y-3 !mt-3">

                <div className="grid grid-cols-2 gap-3">
                  <div className="h-[47px] flex items-center justify-between bg-[#111] px-3 border border-[#222] rounded-[6px]">
                    <span className="text-[10px] font-bold text-[#888] shrink-0">自訂遮罩</span>
                    <div className="flex gap-1.5 overflow-hidden">
                      {maskImageState && (
                        <button onClick={(e) => { e.stopPropagation(); setMaskImageState(null); }} className="flex items-center justify-center p-1.5 text-[10px] bg-[#222] text-white font-bold rounded-[4px] border border-[#333] hover:bg-[#333] transition-all" title="還原素色">
                          <RotateCcw size={12} />
                        </button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); maskFileInputRef.current?.click(); }} className="px-2 py-1.5 text-[10px] bg-white text-black font-bold rounded-[4px] hover:bg-gray-200 transition-colors uppercase tracking-widest whitespace-nowrap">
                        {maskImageState ? '更換' : '選擇'}
                      </button>
                    </div>
                  </div>
                  <div className="h-[47px] flex items-center justify-between bg-[#111] px-3 border border-[#222] rounded-[6px] cursor-pointer hover:bg-[#151515] transition-colors" onClick={() => setColorPickerTarget('mask')}>
                    <span className="text-[10px] font-bold text-[#888]">顏色</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-mono text-white/40">{maskColor}</span>
                      <div className="w-6 h-5 rounded-[4px] shadow-inner border border-white/10" style={{ backgroundColor: maskColor }} />
                    </div>
                  </div>
                </div>
                <div className="h-[47px] flex items-center justify-between bg-[#111] px-3 border border-[#222] rounded-[6px]">
                  <span className="text-[10px] font-bold text-[#888]">紋理</span>
                  <div className="flex bg-[#0a0a0a] border border-[#222] p-0.5 rounded-[4px]">
                    {['none', 'dot'].map(t => (
                      <button key={t} onClick={() => setPatternType(t)} className={`px-4 h-6 text-[10px] font-bold rounded-[2px] transition-all ${patternType === t ? 'bg-[#333] text-white shadow-sm' : 'text-[#555] hover:text-[#888]'}`}>{t === 'none' ? '無' : '點點'}</button>
                    ))}
                  </div>
                </div>
                {patternType === 'dot' && (
                  <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-[8px] p-4 space-y-3 animate-in fade-in zoom-in-95 duration-300">
                    <div className="grid grid-cols-2 gap-4">
                      <CompactSlider label="大小" value={dotSize} min={0} max={100} onChange={setDotSize} />
                      <CompactSlider label="間距" value={dotGap} min={0} max={100} onChange={setDotGap} />
                    </div>
                    <div className="flex items-center justify-between bg-[#111] p-2.5 border border-[#222] rounded-[6px] cursor-pointer hover:bg-[#151515] transition-colors" onClick={() => setColorPickerTarget('dot')}>
                      <span className="text-[10px] font-bold text-[#888]">顏色</span>
                      <div className="w-8 h-4 rounded-[3px] border border-white/5 shadow-inner" style={{ backgroundColor: dotColor }} />
                    </div>
                  </div>
                )}
                </div>
              </div>}
              {activeTab === 'add' && (() => {
                const sel = objects.find(o => o.id === selectedObj) || null;
                const patch = (d: any) => setObjects(prev => prev.map(o => o.id === sel.id ? { ...o, ...d } : o));
                const addText = () => {
                  const offs2 = getLayoutOffsets();
                  if (!offs2) return;
                  const id = Math.random().toString(36).slice(2, 9);
                  const size = Math.round(Math.min(offs2.cw, offs2.ch) * 0.09);
                  const w = size * 4, h = size * 1.3;
                  setObjects(prev => [...prev, {
                    id, type: 'text', text: 'Abai', color: '#ffffff', size,
                    fontFamily: DEFAULT_FONT, bold: false, italic: false,
                    letterSpacing: 0, strokeWidth: 0, strokeColor: '#000000',
                    glow: 0, glowColor: '#ffffff',
                    x: offs2.cw / 2 - w / 2, y: offs2.ch / 2 - h / 2, w, h, rot: 0,
                  }]);
                  setSelectedObj(id);
                  setSelectedTarget(null);
                  ensureFont(DEFAULT_FONT);
                  setActiveTab('objedit');   // 新增完直接進編輯頁，跟經典拼圖一樣
                };
                return (
                  <div className="max-w-md mx-auto space-y-4 animate-in fade-in duration-300">
                    {/* 按鈕與圖標尺寸跟經典拼圖的加號頁完全一致；
                        只差沒有「新增佈局」——創意拼圖的版面是排版＋遮罩決定的。 */}
                    <div className="flex justify-center gap-4 mt-6">
                      <button
                        onClick={() => objFileInputRef.current?.click()}
                        className="flex flex-col items-center justify-center py-4 px-6 bg-white/5 border border-white/10 hover:border-white/30 hover:bg-white/10 rounded-2xl transition-all gap-2 active:scale-95 flex-1 max-w-[130px]"
                      >
                        <Icon name="add_photo_alternate" className="text-[24px] text-white/80" />
                        <span className="text-[11px] font-bold tracking-widest text-white/90">匯入照片</span>
                      </button>
                      <button
                        onClick={addText}
                        className="flex flex-col items-center justify-center py-4 px-6 bg-white/5 border border-white/10 hover:border-white/30 hover:bg-white/10 rounded-2xl transition-all gap-2 active:scale-95 flex-1 max-w-[130px]"
                      >
                        <Type size={24} strokeWidth={1.5} className="text-white opacity-80" />
                        <span className="text-[11px] font-bold tracking-widest text-white/90">新增文字</span>
                      </button>
                    </div>
                  </div>
                );
              })()}
              {activeTab === 'objedit' && (() => {
                const sel = objects.find(o => o.id === selectedObj) || null;
                const patch = (d: any) => setObjects(prev => prev.map(o => o.id === sel.id ? { ...o, ...d } : o));
                const move = (dir: number) => setObjects(prev => {
                  const i = prev.findIndex(o => o.id === sel.id);
                  const j = i + dir;
                  if (i < 0 || j < 0 || j >= prev.length) return prev;
                  const n = prev.slice(); const [x] = n.splice(i, 1); n.splice(j, 0, x); return n;
                });
                if (!sel) return (
                  // 位置與字樣跟經典拼圖同一份
                  <div className="h-full flex items-center justify-center pb-6">
                    <p className="text-[11px] text-white/40 text-center">請先選中圖片或文字</p>
                  </div>
                );
                return (
                  sel.type === 'text' ? (
                    <div className="max-w-md mx-auto h-full animate-in fade-in duration-300">
                      <TextEditorPanel
                        layer={{
                          text: sel.text, color: sel.color, fontFamily: sel.fontFamily,
                          fontSize: sel.size, bold: sel.bold, italic: sel.italic,
                          letterSpacing: sel.letterSpacing, strokeWidth: sel.strokeWidth,
                          strokeColor: sel.strokeColor, glow: sel.glow, glowColor: sel.glowColor,
                        } as any}
                        onChange={(d: any) => {
                          if (d.fontFamily) ensureFont(d.fontFamily);
                          if (d.fontSize !== undefined) { patch({ ...d, size: d.fontSize }); return; }
                          patch(d);
                        }}
                      />
                    </div>
                  ) : (
                  <div className="h-full">
                    {/* 圖片調整直接用經典拼圖那顆元件 —— 同一份程式碼，
                        所以按鈕佈局、樣式、外觀都是逐像素相同。
                        形狀那一組（圓角／羽化／描邊／發光）也接上了，
                        畫布端會把它們畫進每個圖片物件的快取裡。 */}
                    <ImageAdjustPanel
                      img={sel} set={(d: any) => patch(d)} lutList={lutList}
                      loadingLut={loadingLut} setLoadingLut={setLoadingLut}
                      lutRevision={lutRevision} setLutRevision={setLutRevision}
                      adjustSub={adjustSub} setAdjustSub={setAdjustSub}
                      effectCard={effectCard} setEffectCard={setEffectCard}
                      effectDetail={effectDetail} setEffectDetail={setEffectDetail}
                      shapeMenu={shapeMenu} setShapeMenu={setShapeMenu}
                      shapeTool={shapeTool} setShapeTool={setShapeTool}
                      tuneTool={tuneTool} setTuneTool={setTuneTool}
                      setTuningEdge={setTuningEdge}
                      openComposeFor={openComposeFor}
                      deferSlider
                      onSliderOpenChange={setObjSliderOpen}
                    />
                  </div>
                  )
                );
              })()}
              {activeTab === 'motion' && (() => {
                /* 動畫頁。最上面是常駐的播放列（往下捲也不會跑掉），
                   下面挑要調哪個元素，再下面就是那個元素的參數。
                   所有改動都是即時的，換動畫種類還會自動重播一次。 */
                const selObj = objects.find(o => o.id === moTarget) || null;
                const cur: MoCfg = moTarget === 'shape' ? moShape : selObj ? moOf(selObj) : MO_DEFAULT;
                const setCur = (d: Partial<MoCfg>) => {
                  if (moTarget === 'shape') setMoShape(m => ({ ...m, ...d }));
                  else if (selObj) patchMo(selObj.id, d);
                };
                // 換動畫種類 → 從頭播一次，不用自己等一圈
                const pickKind = (d: Partial<MoCfg>) => { setCur(d); replayMotion(); };
                const chip = (on: boolean) =>
                  `px-3 h-8 shrink-0 rounded-[8px] border text-[11px] font-bold tracking-wider transition-all ${
                    on ? 'bg-[#222] text-white border-white shadow-[0_0_15px_rgba(255,255,255,0.1)]'
                       : 'border-[#1a1a1a] text-[#555] hover:bg-[#111] hover:text-[#888]'}`;
                const cell = (on: boolean) =>
                  `h-9 rounded-[8px] border text-[10px] font-bold tracking-wider transition-all ${
                    on ? 'bg-[#222] text-white border-white shadow-[0_0_15px_rgba(255,255,255,0.1)]'
                       : 'border-[#1a1a1a] text-[#555] hover:bg-[#111] hover:text-[#888]'}`;
                const label = (t: string) =>
                  <p className="text-[10px] font-bold text-[#666] uppercase tracking-widest mb-2 mt-4">{t}</p>;
                // 圖案是一整群、共用一條路徑，翻轉那種單體效果套上去只會亂
                const kinds = moTarget === 'shape'
                  ? IN_KINDS.filter(k => k.id !== 'flip')
                  : IN_KINDS.filter(k => k.id !== 'bounce');
                return (
                  <div className="max-w-md mx-auto pb-4 animate-in fade-in duration-300">
                    {/* 要調哪一個元素（播放列不在這裡 —— 它跟分頁列一樣在捲動區外面） */}
                    <div className="flex gap-2 overflow-x-auto no-scrollbar [&::-webkit-scrollbar]:hidden pb-1">
                      <button onClick={() => setMoTarget('shape')} className={chip(moTarget === 'shape')}>圖案</button>
                      {hasLink && <button onClick={() => setMoTarget('link')} className={chip(moTarget === 'link')}>
                        {linkMode === 'dash' ? '虛線' : '連線'}
                      </button>}
                      {objects.map((o, i) => (
                        <button key={o.id}
                          onClick={() => setMoTarget(o.id)}
                          className={chip(moTarget === o.id)}>
                          {o.type === 'text' ? (o.text || '文字').slice(0, 6) : `圖片 ${i + 1}`}
                        </button>
                      ))}
                    </div>

                    {moTarget === 'link' ? (
                      <>
                        <div className="grid grid-cols-2 gap-4 mt-4">
                          <CompactSlider label="起始" value={Math.round(moLink.delay)} min={0} max={20} step={1}
                            onCommit={replayMotion}
                            onChange={(v: number) => setMoLink(m => ({ ...m, delay: v }))} />
                          {/* 面板上調速度（越大越快），內部照樣存秒數 */}
                          <CompactSlider label="速度" value={speedFromDur(moLink.dur)} min={0} max={100} step={1}
                            onCommit={replayMotion}
                            onChange={(v: number) => setMoLink(m => ({ ...m, dur: durFromSpeed(v) }))} />
                        </div>
                        <div className="grid grid-cols-2 gap-2 mt-3">
                          {LINK_EASES.map(e => (
                            <button key={e.id}
                              onClick={() => { setMoLink(m => ({ ...m, ease: e.id })); replayMotion(); }}
                              className={cell(moLink.ease === e.id)}>
                              {e.name}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : (moTarget !== 'shape' && !selObj) ? (
                      <p className="text-[11px] text-white/40 text-center py-8">這個物件已經不在了，請重新選一個</p>
                    ) : (
                      <>
                        {label('進場動畫')}
                        <div className="grid grid-cols-4 gap-2">
                          {kinds.map(k => (
                            <button key={k.id} onClick={() => pickKind({ in: k.id })} className={cell(cur.in === k.id)}>
                              {k.name}
                            </button>
                          ))}
                        </div>
                        <div className="grid grid-cols-2 gap-4 mt-3">
                          <CompactSlider label="起始" value={Math.round(cur.delay)} min={0} max={20} step={1}
                            onCommit={replayMotion}
                            onChange={(v: number) => setCur({ delay: v })} />
                          <CompactSlider label="速度" value={speedFromDur(cur.dur)} min={0} max={100} step={1}
                            onCommit={replayMotion}
                            onChange={(v: number) => setCur({ dur: durFromSpeed(v) })} />
                        </div>

                        {label('常駐動畫')}
                        <div className="grid grid-cols-4 gap-2">
                          {IDLE_KINDS.map(k => (
                            <button key={k.id} onClick={() => pickKind({ idle: k.id })} className={cell(cur.idle === k.id)}>
                              {k.name}
                            </button>
                          ))}
                        </div>
                        {cur.idle !== 'none' && (
                          <div className="grid grid-cols-2 gap-4 mt-3">
                            <CompactSlider label="幅度" value={cur.amp} min={0} max={100} step={1}
                              onChange={(v: number) => setCur({ amp: v })} />
                            {/* 範圍 20～180 配 step 1：滑桿只有 167px 寬，範圍再寬一點
                                一個螢幕像素就會跳 2 —— 那正是主人說「動一下就 +2」的原因 */}
                            <CompactSlider label="快慢" value={Math.round(cur.speed * 100)} min={20} max={180} step={1}
                              onChange={(v: number) => setCur({ speed: v / 100 })} />
                          </div>
                        )}

                      </>
                    )}
                  </div>
                );
              })()}
              {activeTab === 'shape' && <div className="max-w-md mx-auto h-full flex flex-row animate-in fade-in duration-300">
                {/* 左側細長分頁列：上面挑圖案、下面調參數 ——
                    跟經典拼圖「新增佈局」裡面完全同一種版型（只有圖示、中間一條分隔線） */}
                <div className="flex flex-col shrink-0 w-11 -mt-5 -mb-5 -ml-5 border-r border-white/10 select-none">
                  <button
                    onClick={() => setShapeSub('shape')}
                    title="圖案" aria-label="圖案"
                    /* 只做「發亮 + 圖標微放大」。原本是整顆 transition-all，
                       連 outline / 邊框那些也一起過場，點下去跟移開時看起來會抖。 */
                    className={`w-full flex-1 flex items-center justify-center outline-none transition-colors duration-150 ${shapeSub === 'shape' ? 'text-white' : 'text-[#5a5a5a]'}`}
                  >
                    <Star size={18} className={`transition-transform duration-150 will-change-transform ${shapeSub === 'shape' ? 'scale-110' : 'scale-100'}`} />
                  </button>
                  <div className="w-full h-[1px] bg-white/10 shrink-0" />
                  <button
                    onClick={() => setShapeSub('style')}
                    title="參數" aria-label="參數"
                    className={`w-full flex-1 flex items-center justify-center outline-none transition-colors duration-150 ${shapeSub === 'style' ? 'text-white' : 'text-[#5a5a5a]'}`}
                  >
                    <SlidersHorizontal size={18} className={`transition-transform duration-150 will-change-transform ${shapeSub === 'style' ? 'scale-110' : 'scale-100'}`} />
                  </button>
                </div>
                <div className="flex-1 min-w-0 no-scrollbar pl-3 pr-1 h-full overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {shapeSub === 'shape' && <div className="pt-0.5 pb-2">
                <div className="grid grid-cols-5 gap-2 mb-3">
                  {['circle', 'square', 'cross-star', 'heart', 'star', 'flower', 'love', 'love3', 'vortex', 'random-num', 'seagrass', 'darkstar', 'sparkle', 'aster', 'text'].map(s => (
                    <button key={s} onClick={() => handleShapeClick(s)} className={`py-3 flex items-center justify-center rounded-[8px] border transition-all ${holeType === s ? 'bg-[#222] text-white border-white shadow-[0_0_15px_rgba(255,255,255,0.1)]' : 'border-[#1a1a1a] text-[#555] hover:bg-[#111] hover:text-[#888]'}`}>
                      {s === 'circle' ? <Circle size={18} /> : s === 'square' ? <Square size={18} /> : s === 'cross-star' ? <CrossStarIcon size={18} /> : s === 'heart' ? <Heart size={18} /> : s === 'star' ? <Star size={18} /> : s === 'flower' ? <span className="text-lg font-bold font-sans leading-none">❋</span> : s === 'love' ? <span className="text-xs font-black font-mono tracking-tighter leading-none">&lt;3</span> : s === 'love3' ? <span className="text-[10px] font-black font-mono tracking-tighter leading-none">&lt;333</span> : s === 'vortex' ? <VortexIcon size={18} /> : s === 'random-num' ? <span className="text-sm font-bold font-sans leading-none tracking-tight">(9)</span> : GLYPH_HOLES[s] ? <span className="text-lg font-bold font-sans leading-none">{GLYPH_HOLES[s]}</span> : <Type size={18} />}
                    </button>
                  ))}
                </div>
                {holeType === 'text' && (
                  <div ref={textInputWrapRef} className="pb-1">
                    <input 
                      type="text" 
                      maxLength={15} 
                      value={customText} 
                      onChange={e => setCustomText(e.target.value)} 
                      placeholder="輸入文字..." 
                      className="w-full p-2.5 bg-[#111] border border-transparent rounded-[8px] text-center text-sm font-bold focus:outline-none focus:border-white transition-colors text-white placeholder:text-[#333]" 
                    />
                    <div className="h-2" />
                  </div>
                )}
                </div>}
                {shapeSub === 'style' && <div className="pt-1 pb-2">
                  <div className="grid grid-cols-2 gap-4">
                    <CompactSlider label="大小" value={holeSize} min={0} max={100} onChange={setHoleSize} />
                    <CompactSlider label="數量" value={holeCount} min={0} max={50} onChange={setHoleCount} step={1} />
                    <CompactSlider label="變化" value={sizeJitter} min={0} max={50} onChange={setSizeJitter} />
                    <CompactSlider label="角度" value={displayAngle} min={0} max={360} onChange={handleAngleChange} step={1} />
                  </div>
                  {/* 連線：每個圖案拉一條極細的線到最近的鄰居。
                      版型跟上面那幾根滑桿一致 —— 左上是名稱，下面才是選項。
                      只有前六種有明確中心的圖案支援，其餘一律不給按。 */}
                  <div className="flex flex-col mt-6">
                    <div className="flex justify-between text-[10px] font-bold text-[#888] mb-2 uppercase tracking-widest">
                      <span>連線</span>
                    </div>
                    <div className="flex gap-2">
                      {([['none', '關閉'], ['solid', '實線'], ['dash', '虛線']] as const).map(([mode, name]) => (
                        <button
                          key={mode}
                          onClick={() => linkSupported && setLinkMode(mode)}
                          disabled={!linkSupported}
                          title={linkSupported ? `圖案之間的連線：${name}` : '這個圖案不支援連線'}
                          className={`flex-1 h-9 rounded-[8px] border text-[11px] font-bold tracking-widest transition-all ${
                            !linkSupported
                              ? 'border-[#1a1a1a] text-[#333] cursor-default'
                              : linkMode === mode
                                ? 'bg-[#222] text-white border-white shadow-[0_0_15px_rgba(255,255,255,0.1)]'
                                : 'border-[#1a1a1a] text-[#555] hover:bg-[#111] hover:text-[#888]'
                          }`}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>}
                </div>
              </div>}
            </>
          )}
        </div>
      </footer>
    </div>
  );
}

const CompactSlider = ({ label, value, min, max, onChange, step = "any", decimals = 0, onCommit }: any) => (
  <div className="flex flex-col">
    <div className="flex justify-between text-[10px] font-bold text-[#888] mb-2 uppercase tracking-widest">
      <span>{label}</span>
      {/* 小數位要能顯示出來，不然 1.25 跟 1.5 在畫面上都是 1，看起來就像滑桿沒作用 */}
      <span className="text-white font-sans tabular-nums">
        {decimals > 0 ? Number(value).toFixed(decimals).replace(/\.?0+$/, '') || '0' : Math.round(value)}
      </span>
    </div>
    {/* onCommit：手指／滑鼠放開時才觸發（動畫頁拿它來自動重播） */}
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={e => onChange(Number(e.target.value))}
      onPointerUp={() => onCommit && onCommit()}
      onTouchEnd={() => onCommit && onCommit()}
      onKeyUp={() => onCommit && onCommit()}
      className="premium-slider" onPointerDown={e => e.stopPropagation()} />
  </div>
);

const LayoutIcon = ({ type, active }: any) => {
  const pos = type.split('-')[1];
  // 四周包圍：畫成一個「框」，中間留白就是那張原圖
  if (pos === 'around') {
    return (
      <div className={`w-5 h-5 rounded-[2px] border ${active ? 'border-white scale-110 shadow-lg' : 'border-[#333]'} relative overflow-hidden transition-all shrink-0`}>
        <div className={`absolute inset-0 transition-colors ${active ? 'bg-white' : 'bg-[#333]'}`} />
        <div className="absolute inset-[4px] bg-[#111] rounded-[1px]" />
      </div>
    );
  }
  return (
    <div className={`w-5 h-5 rounded-[2px] border ${active ? 'border-white scale-110 shadow-lg' : 'border-[#333]'} relative overflow-hidden transition-all shrink-0`}>
      <div className={`absolute transition-colors ${active ? 'bg-white' : 'bg-[#333]'} ${pos === 'top' ? 'top-0 left-0 right-0 h-1/2' : pos === 'bottom' ? 'bottom-0 left-0 right-0 h-1/2' : pos === 'left' ? 'top-0 left-0 bottom-0 w-1/2' : 'top-0 right-0 bottom-0 w-1/2'}`} />
    </div>
  );
};
