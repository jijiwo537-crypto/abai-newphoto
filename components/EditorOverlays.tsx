import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoveUp, MoveDown, Copy, Sliders, Trash2 } from 'lucide-react';
import {
  paintClassicAnimatedVector, shapeSupportsStretch, WAVE_LIKE_KINDS, TEXT_PLACEHOLDER,
  type FloatingImage,
} from './GridLayoutTool';
import { DEFAULT_FONT, SYMBOL_FONT, ensureFont, fontStack } from '../utils/fonts';

/* ── 「編輯」裡疊在照片上的文字／符號／圖形／圖片 ────────────────────────────
   資料格式就是經典拼圖的浮動圖層（FloatingImage），畫法也直接用經典拼圖那一支
   （paintClassicAnimatedVector），面板是同一組 TextEditorPanel／ShapeEditorPanel，
   所以外觀、參數跟拼圖裡一模一樣。

   座標：一張寬 OVERLAY_PAGE_W 的「頁面」蓋在照片上，高照照片比例。物件的
   x／y 是左上角、width／height 是沒縮放的大小、scale 是倍率、rotation 是角度 —— 跟拼圖一樣。
   預覽與存檔共用 paintOverlays：預覽每單位幾個裝置像素、存檔每單位幾個輸出像素，
   畫出來只差解析度。 */

export const OVERLAY_PAGE_W = 360;
export type OverlayItem = FloatingImage & { natW?: number; natH?: number };
export type OverlayKind = 'text' | 'symbol' | 'shape' | 'image';
export const overlayKind = (it: OverlayItem): OverlayKind =>
  it.sym ? 'symbol' : it.text !== undefined ? 'text' : it.shape ? 'shape' : 'image';

const newId = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;

/* ── 圖片快取：同一個網址只解一次，解好了通知重畫 ── */
const imgCache = new Map<string, HTMLImageElement>();
const imgWaiters = new Map<string, Set<() => void>>();
const overlayImage = (src: string, onLoad?: () => void): HTMLImageElement | null => {
  let im = imgCache.get(src);
  if (!im) {
    im = new Image();
    if (!src.startsWith('blob:') && !src.startsWith('data:')) im.crossOrigin = 'anonymous';
    imgCache.set(src, im);
    const done = () => { const ws = imgWaiters.get(src); imgWaiters.delete(src); ws?.forEach(f => f()); };
    im.onload = done; im.onerror = done;
    im.src = src;
  }
  if (im.complete && im.naturalWidth) return im;
  if (onLoad) { let s = imgWaiters.get(src); if (!s) imgWaiters.set(src, s = new Set()); s.add(onLoad); }
  return null;
};
const imageReady = (src: string) => new Promise<void>(res => { if (overlayImage(src, res)) res(); });

/* ── 字體：沒載好就先用替代字畫，載好後重畫一次 ── */
const fontReady = new Set<string>();
const fontWait = (family: string, onLoad?: () => void) => {
  if (fontReady.has(family)) return true;
  ensureFont(family).then(() => document.fonts?.load(`400 40px ${fontStack(family)}`)).catch(() => {}).finally(() => {
    if (!fontReady.has(family)) { fontReady.add(family); onLoad?.(); }
  });
  return false;
};

/* 文字圖層的框跟著字量：字、字體、粗細、斜體、字距、描邊一改就重算。
   有被四邊擠壓過（textStretchBase）的話，框維持擠壓的比例。 */
const measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
export const measureTextBox = (it: OverlayItem) => {
  const size = it.fontSize || 28;
  const family = it.sym ? SYMBOL_FONT : (it.fontFamily || DEFAULT_FONT);
  let maxW = size;
  if (measureCtx) {
    measureCtx.font = `${it.italic ? 'italic ' : ''}${it.bold ? 700 : 400} ${size}px ${fontStack(family)}`;
    (measureCtx as any).letterSpacing = `${it.letterSpacing || 0}px`;
    for (const line of (it.text || ' ').split('\n')) maxW = Math.max(maxW, measureCtx.measureText(line || ' ').width);
  }
  const lines = (it.text || ' ').split('\n').length;
  const sw = (it.strokeWidth || 0) * 2;
  return { w: Math.ceil(maxW + sw + size * 0.5), h: Math.ceil(lines * size * 1.12 + sw + size * 0.35) };
};
/** 改了會影響文字框大小的欄位，就把框重量一次（中心不動） */
export const refitText = (it: OverlayItem, patch: Partial<OverlayItem>): Partial<OverlayItem> => {
  if (it.sym || it.text === undefined) return patch;
  if (!['text', 'fontFamily', 'bold', 'italic', 'letterSpacing', 'strokeWidth', 'fontSize'].some(k => k in patch)) return patch;
  const next = { ...it, ...patch };
  const m = measureTextBox(next);
  const kx = it.textStretchBaseW ? it.width / it.textStretchBaseW : 1;
  const ky = it.textStretchBaseH ? it.height / it.textStretchBaseH : 1;
  const w = m.w * kx, h = m.h * ky;
  const cx = it.x + it.width / 2, cy = it.y + it.height / 2;
  return {
    ...patch, width: w, height: h, x: cx - w / 2, y: cy - h / 2,
    ...(it.textStretchBaseW ? { textStretchBaseW: m.w } : {}),
    ...(it.textStretchBaseH ? { textStretchBaseH: m.h } : {}),
  };
};

export const newTextItem = (cx: number, cy: number): OverlayItem => {
  const base: OverlayItem = {
    id: newId('text'), src: '', x: 0, y: 0, width: 10, height: 10, scale: 1, rotation: 0,
    text: TEXT_PLACEHOLDER, fontFamily: DEFAULT_FONT, fontSize: 28, color: '#FFFFFF',
    bold: false, italic: false, letterSpacing: 0, strokeColor: '#000000', glow: 0, glowColor: '#FFFFFF',
  };
  const m = measureTextBox(base);
  return { ...base, width: m.w, height: m.h, x: cx - m.w / 2, y: cy - m.h / 2 };
};
export const newImageItem = (src: string, natW: number, natH: number, pageH: number): OverlayItem => {
  const fit = Math.min(OVERLAY_PAGE_W * 0.6 / natW, pageH * 0.6 / natH);
  const w = natW * fit, h = natH * fit;
  return {
    id: newId('img'), src, natW, natH, x: OVERLAY_PAGE_W / 2 - w / 2, y: pageH / 2 - h / 2,
    width: w, height: h, scale: 1, rotation: 0, opacity: 100, imgRadius: 0,
  };
};

const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  if ((ctx as any).roundRect) (ctx as any).roundRect(x, y, w, h, r);
  else { ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
};

let scratch: HTMLCanvasElement | null = null;
/**
 * 把所有圖層畫到 ctx（目前的變換＝頁面座標 0,0 在畫布 0,0）。
 * k：每一個頁面單位是幾個畫布像素。回傳 false 代表還有圖片／字體在載，載好會呼叫 onLoad。
 */
export function paintOverlays(ctx: CanvasRenderingContext2D, items: OverlayItem[], k: number, onLoad?: () => void): boolean {
  let ready = true;
  for (const it of items) {
    const op = Math.max(0, Math.min(1, (it.opacity ?? 100) / 100));
    if (op <= 0) continue;
    const kind = overlayKind(it);
    if (kind === 'text' && !fontWait(it.fontFamily || DEFAULT_FONT, onLoad)) ready = false;
    const place = (g: CanvasRenderingContext2D) => {
      g.scale(k, k);
      g.translate(it.x + it.width / 2, it.y + it.height / 2);
      g.rotate((it.rotation || 0) * Math.PI / 180);
      g.scale(it.scale || 1, it.scale || 1);
    };
    if (kind === 'image') {
      const im = overlayImage(it.src, onLoad);
      if (!im) { ready = false; continue; }
      ctx.save();
      place(ctx);
      ctx.globalAlpha *= op;
      const r = Math.min(it.width, it.height) / 2 * Math.min(1, (it.imgRadius || 0) / 50);
      if (r > 0) { roundRect(ctx, -it.width / 2, -it.height / 2, it.width, it.height, r); ctx.clip(); }
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(im, -it.width / 2, -it.height / 2, it.width, it.height);
      ctx.restore();
      continue;
    }
    const density = k * Math.abs(it.scale || 1);
    if (op >= 0.999) {
      ctx.save(); place(ctx);
      try { paintClassicAnimatedVector(ctx, it, null, density); } catch { /* 單一圖層畫失敗不影響其他 */ }
      ctx.restore();
      continue;
    }
    /* 半透明：先不透明地畫好整個圖層（描邊、發光才不會各自疊色），最後整張只套一次透明度 */
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    const s = scratch ??= document.createElement('canvas');
    if (s.width !== cw || s.height !== ch) { s.width = cw; s.height = ch; }
    const g = s.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cw, ch);
    g.setTransform(ctx.getTransform());
    place(g);
    try { paintClassicAnimatedVector(g, it, null, density); } catch { /* 同上 */ }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha *= op; ctx.drawImage(s, 0, 0); ctx.restore();
  }
  return ready;
}

/** 存檔用：圖片、字體都載好之後，把圖層畫進成品（w×h 是成品像素） */
export async function bakeOverlays(ctx: CanvasRenderingContext2D, w: number, items: OverlayItem[] | undefined) {
  if (!items?.length) return;
  await Promise.all(items.map(it => {
    const kind = overlayKind(it);
    if (kind === 'image') return imageReady(it.src);
    if (kind === 'text') return ensureFont(it.fontFamily || DEFAULT_FONT).then(() => document.fonts?.load(`400 40px ${fontStack(it.fontFamily || DEFAULT_FONT)}`)).catch(() => {});
    return Promise.resolve();
  }));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  paintOverlays(ctx, items, w / OVERLAY_PAGE_W);
  ctx.restore();
}

/* ── 互動層 ─────────────────────────────────────────────────────────────── */

export type OverlayLayerHandle = {
  /** 面板拖滑桿中：只更新畫面，不寫回文件 */
  preview: (id: string, patch: Partial<OverlayItem>) => void;
};

type Gesture =
  | { kind: 'empty' }
  | { kind: 'drag'; id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean; wasSelected: boolean }
  | { kind: 'pinch'; id: string; d0: number; a0: number; s0: number; r0: number; mx0: number; my0: number; cx0: number; cy0: number }
  | { kind: 'stretch'; id: string; side: 't' | 'r' | 'b' | 'l'; base: OverlayItem; sx: number; sy: number };

const SNAP_PX = 6;

export const OverlayLayer: React.FC<{
  items: OverlayItem[];
  pageH: number;
  /** 文字／圖形／符號／圖片分頁：可以點選、拖曳；其他分頁只顯示 */
  interactive: boolean;
  hidden?: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCommit: (next: OverlayItem[]) => void;
  onEdit: (id: string) => void;
  apiRef: React.MutableRefObject<OverlayLayerHandle | null>;
}> = ({ items, pageH, interactive, hidden, selectedId, onSelect, onCommit, onEdit, apiRef }) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef<OverlayItem[]>(items);
  const busy = useRef(false);
  const [, setTick] = useState(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [guides, setGuides] = useState<{ v: boolean; h: boolean }>({ v: false, h: false });
  if (!busy.current) live.current = items;

  const raf = useRef(0);
  const paint = useCallback(() => {
    const c = canvasRef.current, box = boxRef.current; if (!c || !box) return;
    const cw = box.offsetWidth, ch = box.offsetHeight; if (!cw || !ch) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const W = Math.round(cw * dpr), H = Math.round(ch * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    paintOverlays(g, live.current, W / OVERLAY_PAGE_W, () => schedule());
  }, []);
  const schedule = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => { raf.current = 0; paint(); });
  }, [paint]);
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);
  useLayoutEffect(() => { paint(); }, [items, size, paint]);
  useLayoutEffect(() => {
    const box = boxRef.current; if (!box || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setSize(s => (s.w === box.offsetWidth && s.h === box.offsetHeight) ? s : { w: box.offsetWidth, h: box.offsetHeight }));
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  apiRef.current = {
    preview: (id, patch) => {
      busy.current = true;
      live.current = live.current.map(it => it.id === id ? { ...it, ...refitText(it, patch) } : it);
      schedule(); setTick(t => t + 1);
    },
  };
  /* 面板那邊提交了（文件更新）就回到「照文件畫」 */
  useEffect(() => { busy.current = false; live.current = items; schedule(); }, [items, schedule]);

  /* 螢幕座標 → 頁面單位 */
  const toUnit = (clientX: number, clientY: number) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left) / r.width * OVERLAY_PAGE_W, y: (clientY - r.top) / r.height * pageH, upx: OVERLAY_PAGE_W / r.width };
  };
  const hit = (ux: number, uy: number, upx: number) => {
    const list = live.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      const cx = it.x + it.width / 2, cy = it.y + it.height / 2;
      const a = -(it.rotation || 0) * Math.PI / 180;
      const dx = ux - cx, dy = uy - cy;
      const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
      // 太小的圖層至少給 36px 見方好點
      const hw = Math.max(it.width * Math.abs(it.scale || 1), 36 * upx) / 2;
      const hh = Math.max(it.height * Math.abs(it.scale || 1), 36 * upx) / 2;
      if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) return it;
    }
    return null;
  };
  const patchLive = (id: string, patch: Partial<OverlayItem>) => {
    live.current = live.current.map(it => it.id === id ? { ...it, ...patch } : it);
    schedule(); setTick(t => t + 1);
  };

  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const gest = useRef<Gesture | null>(null);
  const startPinch = (id: string) => {
    const it = live.current.find(o => o.id === id); if (!it) return;
    const [a, b] = [...ptrs.current.values()];
    gest.current = {
      kind: 'pinch', id, d0: Math.hypot(b.x - a.x, b.y - a.y) || 1, a0: Math.atan2(b.y - a.y, b.x - a.x),
      s0: it.scale || 1, r0: it.rotation || 0, mx0: (a.x + b.x) / 2, my0: (a.y + b.y) / 2,
      cx0: it.x + it.width / 2, cy0: it.y + it.height / 2,
    };
  };
  const onDown = (e: React.PointerEvent) => {
    if (!interactive) return;
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* 沒抓到也無所謂 */ }
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 2) {
      const g = gest.current;
      const id = (g && g.kind !== 'empty' ? g.id : null) || selectedId;
      if (id) { busy.current = true; startPinch(id); }
      return;
    }
    if (ptrs.current.size > 2) return;
    const u = toUnit(e.clientX, e.clientY);
    const h = hit(u.x, u.y, u.upx);
    /* 點在空白處先不取消選取：可能是兩指縮放的第一指（手指常常落在小圖層外面）。
       放開時沒有第二指、也沒拖動，才算「點空白＝取消選取」。 */
    if (!h) { gest.current = { kind: 'empty' }; return; }
    busy.current = true;
    gest.current = { kind: 'drag', id: h.id, sx: u.x, sy: u.y, ox: h.x, oy: h.y, moved: false, wasSelected: selectedId === h.id };
    if (selectedId !== h.id) onSelect(h.id);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gest.current; if (!g) return;
    if (g.kind === 'drag' && ptrs.current.size === 1) {
      const u = toUnit(e.clientX, e.clientY);
      if (!g.moved && Math.hypot(u.x - g.sx, u.y - g.sy) < 3 * u.upx) return;
      g.moved = true;
      const it = live.current.find(o => o.id === g.id); if (!it) return;
      let x = g.ox + (u.x - g.sx), y = g.oy + (u.y - g.sy);
      /* 中心靠近頁面中線就吸過去，並顯示參考線 */
      const snap = SNAP_PX * u.upx;
      const v = Math.abs(x + it.width / 2 - OVERLAY_PAGE_W / 2) < snap, hz = Math.abs(y + it.height / 2 - pageH / 2) < snap;
      if (v) x = OVERLAY_PAGE_W / 2 - it.width / 2;
      if (hz) y = pageH / 2 - it.height / 2;
      if (v !== guides.v || hz !== guides.h) setGuides({ v, h: hz });
      patchLive(g.id, { x, y });
    } else if (g.kind === 'pinch' && ptrs.current.size >= 2) {
      const [a, b] = [...ptrs.current.values()];
      const d = Math.hypot(b.x - a.x, b.y - a.y) || 1, ang = Math.atan2(b.y - a.y, b.x - a.x);
      const it = live.current.find(o => o.id === g.id); if (!it) return;
      const r = boxRef.current!.getBoundingClientRect(), upx = OVERLAY_PAGE_W / r.width;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const scale = Math.max(0.05, Math.min(30, g.s0 * d / g.d0));
      let rot = g.r0 + (ang - g.a0) * 180 / Math.PI;
      // 接近水平／垂直就吸住
      const near = Math.round(rot / 90) * 90; if (Math.abs(rot - near) < 3) rot = near;
      const cx = g.cx0 + (mx - g.mx0) * upx, cy = g.cy0 + (my - g.my0) * upx;
      patchLive(g.id, { scale, rotation: rot, x: cx - it.width / 2, y: cy - it.height / 2 });
    } else if (g.kind === 'stretch') {
      const u = toUnit(e.clientX, e.clientY);
      const b = g.base, s = b.scale || 1, a = (b.rotation || 0) * Math.PI / 180;
      const dx = u.x - g.sx, dy = u.y - g.sy;
      const lx = (dx * Math.cos(a) + dy * Math.sin(a)) / s, ly = (-dx * Math.sin(a) + dy * Math.cos(a)) / s;
      let w = b.width, h = b.height, ox = 0, oy = 0;
      if (g.side === 'r') { w = Math.max(8, b.width + lx); ox = (w - b.width) / 2; }
      if (g.side === 'l') { w = Math.max(8, b.width - lx); ox = -(w - b.width) / 2; }
      if (g.side === 'b') { h = Math.max(8, b.height + ly); oy = (h - b.height) / 2; }
      if (g.side === 't') { h = Math.max(8, b.height - ly); oy = -(h - b.height) / 2; }
      // 對邊固定：中心沿著自己的軸往拉的那一邊移動一半
      const cx = b.x + b.width / 2 + (ox * Math.cos(a) - oy * Math.sin(a)) * s;
      const cy = b.y + b.height / 2 + (ox * Math.sin(a) + oy * Math.cos(a)) * s;
      const patch: Partial<OverlayItem> = { width: w, height: h, x: cx - w / 2, y: cy - h / 2 };
      if (b.text !== undefined && !b.sym) { patch.textStretchBaseW = b.textStretchBaseW || b.width; patch.textStretchBaseH = b.textStretchBaseH || b.height; }
      patchLive(g.id, patch);
    }
  };
  const finish = () => {
    const g = gest.current;
    gest.current = null;
    setGuides({ v: false, h: false });
    if (!g) { busy.current = false; return; }
    if (g.kind === 'empty') { busy.current = false; onSelect(null); return; }
    const changed = g.kind !== 'drag' || g.moved;
    if (changed) onCommit(live.current);
    else {
      busy.current = false;
      // 已經選中的文字再點一下：開始輸入
      const it = live.current.find(o => o.id === g.id);
      if (g.kind === 'drag' && g.wasSelected && it && overlayKind(it) === 'text') onEdit(it.id);
    }
  };
  const onUp = (e: React.PointerEvent) => {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.delete(e.pointerId);
    const g = gest.current;
    if (g?.kind === 'pinch' && ptrs.current.size === 1) {
      // 兩指放開一指：剩下那一指接著拖，不要跳
      const [p] = [...ptrs.current.values()];
      const it = live.current.find(o => o.id === g.id);
      if (it) { const u = toUnit(p.x, p.y); gest.current = { kind: 'drag', id: it.id, sx: u.x, sy: u.y, ox: it.x, oy: it.y, moved: true, wasSelected: true }; }
      return;
    }
    if (g?.kind === 'empty' && ptrs.current.size > 0) return;
    if (ptrs.current.size === 0) finish();
  };
  /* 桌機：滾輪縮放選中的那一個 */
  const onWheel = (e: React.WheelEvent) => {
    if (!interactive || !selectedId) return;
    const it = live.current.find(o => o.id === selectedId); if (!it) return;
    busy.current = true;
    patchLive(it.id, { scale: Math.max(0.05, Math.min(30, (it.scale || 1) * (e.deltaY < 0 ? 1.08 : 1 / 1.08))) });
    window.clearTimeout((onWheel as any).t);
    (onWheel as any).t = window.setTimeout(() => onCommit(live.current), 250);
  };

  const sel = interactive && selectedId ? live.current.find(o => o.id === selectedId) || null : null;
  const box = boxRef.current;
  const cssK = box && box.offsetWidth ? box.offsetWidth / OVERLAY_PAGE_W : 1;
  const act = (fn: () => void) => (ev: React.SyntheticEvent) => { ev.stopPropagation(); ev.preventDefault(); fn(); };
  const commitList = (list: OverlayItem[]) => { busy.current = true; live.current = list; schedule(); onCommit(list); };
  const toolbar = sel && !gest.current ? (() => {
    const i = live.current.findIndex(o => o.id === sel.id);
    const kind = overlayKind(sel);
    const cx = (sel.x + sel.width / 2) * cssK, cy = (sel.y + sel.height / 2) * cssK;
    const a = (sel.rotation || 0) * Math.PI / 180, s = Math.abs(sel.scale || 1);
    const bh = (Math.abs(sel.width * Math.sin(a)) + Math.abs(sel.height * Math.cos(a))) * s * cssK;
    const H = (box?.offsetHeight || 0);
    const above = cy > H * (2 / 3) && cy - bh / 2 - 42 >= 0;
    let top = above ? cy - bh / 2 - 42 : cy + bh / 2 + 10;
    if (!above && H) top = Math.min(top, H - 34);
    const move = (dir: number) => {
      const n = live.current.slice(); const j = i + dir;
      if (j < 0 || j >= n.length) return;
      const [x] = n.splice(i, 1); n.splice(j, 0, x); commitList(n);
    };
    const dup = () => {
      const copy = { ...sel, id: newId(kind === 'image' ? 'img' : kind === 'shape' ? 'shape' : 'text'), x: sel.x + 12, y: sel.y + 12 };
      const n = live.current.slice(); n.splice(i + 1, 0, copy); commitList(n); onSelect(copy.id);
    };
    const del = () => { commitList(live.current.filter(o => o.id !== sel.id)); onSelect(null); };
    const btns = [
      { t: '下移一層', on: act(() => move(-1)), el: <MoveDown size={14} />, off: i <= 0 },
      { t: '上移一層', on: act(() => move(1)), el: <MoveUp size={14} />, off: i >= live.current.length - 1 },
      { t: '複製', on: act(dup), el: <Copy size={14} />, off: false },
      { t: kind === 'text' ? '編輯文字' : kind === 'symbol' ? '編輯符號' : kind === 'shape' ? '圖形調整' : '圖片調整', on: act(() => onEdit(sel.id)), el: <Sliders size={14} />, off: false },
      { t: '刪除', on: act(del), el: <Trash2 size={14} />, off: false },
    ];
    return (
      <div data-overlay-toolbar className="absolute z-[3] flex items-center gap-0.5 bg-white rounded-full p-0.5 pointer-events-auto"
        style={{ left: Math.max(84, Math.min((box?.offsetWidth || 0) - 84, cx)), top, transform: 'translateX(-50%)', touchAction: 'none', boxShadow: '0 3px 10px rgba(0,0,0,0.22), 0 0 0 0.5px rgba(0,0,0,0.06)' }}
        onPointerDown={e => e.stopPropagation()}>
        {btns.map(b => (
          <button key={b.t} title={b.t} aria-label={b.t} disabled={b.off} onClick={b.off ? undefined : b.on}
            className={`w-7 h-7 rounded-full flex items-center justify-center ${b.off ? 'text-black/25' : 'text-black active:bg-black/10'}`}>{b.el}</button>
        ))}
      </div>
    );
  })() : null;

  const beginStretch = (side: 't' | 'r' | 'b' | 'l') => (e: React.PointerEvent) => {
    if (!sel) return;
    e.stopPropagation(); e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* 同上 */ }
    const u = toUnit(e.clientX, e.clientY);
    busy.current = true;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // 已經有一指在畫面上：這是兩指縮放的第二指，不是拉邊
    if (ptrs.current.size >= 2) { startPinch(sel.id); return; }
    gest.current = { kind: 'stretch', id: sel.id, side, base: { ...sel }, sx: u.x, sy: u.y };
  };
  const canStretch = sel && overlayKind(sel) !== 'symbol' && overlayKind(sel) !== 'image'
    && (overlayKind(sel) !== 'shape' || shapeSupportsStretch(sel.shape, sel.shapeFilled, sel.holeType));

  return (
    <div ref={boxRef} data-overlay-layer className="absolute inset-0"
      style={{ zIndex: 20, visibility: hidden ? 'hidden' : undefined, pointerEvents: interactive ? 'auto' : 'none', touchAction: interactive ? 'none' : undefined }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
      {guides.v && <div className="absolute top-0 bottom-0 w-px bg-[#FF5FA2] pointer-events-none" style={{ left: '50%' }} />}
      {guides.h && <div className="absolute left-0 right-0 h-px bg-[#FF5FA2] pointer-events-none" style={{ top: '50%' }} />}
      {sel && (
        <div data-overlay-frame className="absolute pointer-events-none"
          style={{
            left: (sel.x + sel.width / 2) * cssK, top: (sel.y + sel.height / 2) * cssK,
            width: sel.width * Math.abs(sel.scale || 1) * cssK + 8, height: sel.height * Math.abs(sel.scale || 1) * cssK + 8,
            transform: `translate(-50%, -50%) rotate(${sel.rotation || 0}deg)`,
            border: '1px dashed rgba(255,255,255,0.95)', boxShadow: '0 0 0 0.5px rgba(0,0,0,0.35)',
          }}>
          {canStretch && !gest.current && ([
            ['t', 'left-1/2 top-0', 'translate(-50%,-50%)', 'w-16 h-5'],
            ['r', 'right-0 top-1/2', 'translate(50%,-50%)', 'w-5 h-12'],
            ['b', 'left-1/2 bottom-0', 'translate(-50%,50%)', 'w-16 h-5'],
            ['l', 'left-0 top-1/2', 'translate(-50%,-50%)', 'w-5 h-12'],
          ] as const).filter(([side]) => !(sel.shape && WAVE_LIKE_KINDS.has(sel.shape)) || side === 'l' || side === 'r').map(([side, pos, tx, sz]) => (
            <div key={side} data-overlay-stretch={side} className={`absolute ${pos} ${sz} pointer-events-auto flex items-center justify-center touch-none`}
              style={{ transform: tx }} onPointerDown={beginStretch(side)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
              <span className="w-[6px] h-[6px] rounded-full block bg-white shadow-[0_1px_3px_rgba(0,0,0,0.5)]" />
            </div>
          ))}
        </div>
      )}
      {toolbar}
    </div>
  );
};

/* ── 打字：鍵盤上方一條輸入框，邊打畫面上的字邊跟著變 ─────────────────── */
export const TextEditDialog: React.FC<{
  value: string;
  onInput: (v: string) => void;
  onDone: (v: string) => void;
}> = ({ value, onInput, onDone }) => {
  const field = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [v, setV] = useState(value === TEXT_PLACEHOLDER ? '' : value);
  useLayoutEffect(() => {
    const vv = window.visualViewport;
    const place = () => {
      if (!panel.current) return;
      const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      panel.current.style.top = `${Math.max(8, bottom - panel.current.offsetHeight - 8)}px`;
    };
    place();
    field.current?.focus({ preventScroll: true });
    vv?.addEventListener('resize', place); vv?.addEventListener('scroll', place);
    return () => { vv?.removeEventListener('resize', place); vv?.removeEventListener('scroll', place); };
  }, []);
  const done = () => { field.current?.blur(); onDone(v.trim() ? v : TEXT_PLACEHOLDER); };
  return createPortal(
    <div className="fixed inset-0 z-[1000]" role="dialog" aria-label="輸入文字">
      <button className="absolute inset-0 bg-black/30" aria-label="完成" onClick={done} />
      <div ref={panel} data-text-edit-panel className="absolute left-3 right-3 flex items-end gap-3 rounded-xl bg-[#242424] p-3 shadow-xl">
        <textarea ref={field} value={v} rows={Math.min(4, Math.max(1, v.split('\n').length))} placeholder={TEXT_PLACEHOLDER}
          onChange={e => { setV(e.target.value); onInput(e.target.value.trim() ? e.target.value : TEXT_PLACEHOLDER); }}
          className="min-w-0 flex-1 resize-none rounded-lg bg-black/30 px-3 py-2 text-white outline-none"
          style={{ fontSize: 16, caretColor: '#fff', border: '1px solid #fff' }} />
        <button className="shrink-0 px-2 py-2 text-sm text-white" onPointerDown={e => e.preventDefault()} onClick={done}>完成</button>
      </div>
    </div>, document.body);
};
