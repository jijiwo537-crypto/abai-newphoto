/* 原生的液態玻璃按鈕（對應 ios/App/App/NativeGlassPlugin.swift）。
 *
 * 用法：網頁照常把按鈕排好（位置、大小都由網頁決定），App 裡把那幾顆換成原生的：
 *   const glass = useNativeGlass('gallery', open, () => [ ...每一顆的 id、圖示、DOM 元素... ], onTap, deps)
 * 有原生的時候，網頁那幾顆按鈕要藏起來（visibility: hidden，位置照樣佔著，量得到），glass.native 會是 true。
 * 網頁版、外掛不在的舊版 App：glass.native 是 false，網頁的按鈕照常顯示、照常按。 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { nativePlugin } from './nativeBridge';
import { isNative } from './native';

export interface GlassButtonSpec { id: string; symbol?: string; title?: string; tint?: 'white' | 'red' | 'pink' | 'yellow'; enabled?: boolean; /** 白底按鈕上的黑字 */ titleColor?: 'black'; /** 圖示大小（pt，不給＝19）；有給的會照圖形本身視覺置中 */ pointSize?: number }
export type GlassItem =
  | (GlassButtonSpec & { kind: 'circle'; el: HTMLElement | null; shape?: 'roundedSquare'; /** 深色玻璃 */ dark?: boolean; /** 深色那層的濃度（不給＝0.3） */ darkAlpha?: number; /** 白底 */ fill?: 'white'; /** 白底的濃度（0～1） */ fillAlpha?: number })
  | { kind: 'capsule'; el: HTMLElement | null; buttons: GlassButtonSpec[]; /** 左右內距（pt，不給＝8） */ pad?: number };

interface NativeGlassApi {
  menu?(o: { anchor: { x: number; y: number; w: number; h: number }; items: GlassMenuItem[]; width?: number; place?: { x: number; y: number; w: number } }): Promise<{ opened: boolean }>;
  closeMenu?(): Promise<void>;
  dialog?(o: NativeDialogOpts): Promise<{ id: string }>;
  closeDialog?(): Promise<void>;
  offset?(o: { group: string; x: number; y: number }): Promise<void>;
  sheet?(o: NativeSheetPage): Promise<void>;
  closeSheet?(): Promise<void>;
  addListener(ev: 'sheet', cb: (d: { id: string }) => void): Promise<{ remove: () => void }>;
  show(o: { group: string; items: unknown[]; animate?: boolean }): Promise<void>;
  update(o: { group: string; id: string; symbol?: string; tint?: string; enabled?: boolean; title?: string }): Promise<void>;
  hide(o: { group: string; animate?: boolean }): Promise<void>;
  addListener(ev: 'tap', cb: (d: { group: string; id: string }) => void): Promise<{ remove: () => void }>;
  addListener(ev: 'menu', cb: (d: { id: string; value: unknown }) => void): Promise<{ remove: () => void }>;
  addListener(ev: 'menuClosed', cb: () => void): Promise<{ remove: () => void }>;
}

export const nativeGlass = () => nativePlugin<NativeGlassApi>('NativeGlass');

/** 這台能不能用原生的玻璃按鈕（App 裡、外掛在）。一開始先當作可以（App 裡），探到沒有再退回網頁按鈕 */
export function useNativeGlassAvailable() {
  const [ok, setOk] = useState(isNative());
  useEffect(() => { if (isNative()) void nativeGlass().then(p => setOk(!!p)); }, []);
  return ok;
}

/**
 * active：這組按鈕現在要不要顯示。items()：每次 render 都重新取（DOM 元素用 ref）。
 * settleMs：網頁那層有進場動畫時，等動畫走完再量位置（不然會量到滑到一半的位置）。
 */
export function useNativeGlass(group: string, active: boolean, items: () => GlassItem[], onTap: (id: string) => void, deps: unknown[], settleMs = 0) {
  const native = useNativeGlassAvailable();
  const tapRef = useRef(onTap); tapRef.current = onTap;
  const itemsRef = useRef(items); itemsRef.current = items;
  const shown = useRef(false);

  useEffect(() => {
    if (!native) return;
    let sub: { remove: () => void } | null = null, alive = true;
    void nativeGlass().then(async p => {
      if (!p || !alive) return;
      sub = await p.addListener('tap', d => { if (d.group === group) tapRef.current(d.id); });
      if (!alive) sub.remove();
    });
    return () => { alive = false; sub?.remove(); };
  }, [native, group]);

  const send = (animate: boolean) => {
    const list = itemsRef.current().map(it => {
      const r = it.el?.getBoundingClientRect();
      if (!r || !r.width) return null;
      const box = { x: r.left, y: r.top, w: r.width, h: r.height };
      return it.kind === 'capsule' ? { kind: 'capsule', ...box, buttons: it.buttons, pad: it.pad } : { ...it, el: undefined, ...box };
    }).filter(Boolean);
    void nativeGlass().then(p => p?.show({ group, items: list, animate }));
    shown.current = true;
  };

  useLayoutEffect(() => {
    if (!native) return;
    if (!active) {
      if (shown.current) { shown.current = false; void nativeGlass().then(p => p?.hide({ group, animate: !group.startsWith('camera-') })); }
      return;
    }
    const first = !shown.current;
    const t = window.setTimeout(() => send(first), first ? settleMs : 0);
    const onResize = () => send(false);
    window.addEventListener('resize', onResize);
    return () => { window.clearTimeout(t); window.removeEventListener('resize', onResize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, active, ...deps]);

  useEffect(() => () => { if (shown.current) { shown.current = false; void nativeGlass().then(p => p?.hide({ group, animate: false })); } }, [group]);

  return { native };
}


/* ── 儲存旁邊 ⋯ 的選項面板：原生黑色液態玻璃（ios/App/App/NativeGlassPlugin.swift 的 menu）──
 * 每一列是一組分段按鈕（例如 匯出格式：JPG／PNG／HEIC）。選了就馬上呼叫 onChange（面板留著，可以再改）；
 * 點面板外面收起來。回傳 false＝沒有原生（網頁版、舊版 App）：呼叫端照舊打開網頁的選單 */
export type GlassMenuItem =
  | { id: string; type: 'choice'; title: string; value: string; options: { label: string; value: string; enabled?: boolean }[] }
  /** 開關：值是 true／false（onChange 收到 'true'／'false'） */
  | { id: string; type: 'switch'; title: string; value: boolean }
  /** 點一下就做事、面板收起來：onChange 收到 'tap' */
  | { id: string; type: 'action'; title: string };
let menuSubs: { remove: () => void }[] = [];
/** compactWidth：給了就不用滿版寬，面板只有這麼寬、靠著那顆按鈕的右緣往下長（拼圖 ⋯ 那種只有兩三列的小選單） */
export async function openGlassMenu(anchor: HTMLElement, items: GlassMenuItem[], onChange: (id: string, value: string) => void, compactWidth?: number): Promise<boolean> {
  if (!isNative()) return false;
  const p = await nativeGlass();
  if (!p?.menu) return false;
  menuSubs.forEach(s => s.remove()); menuSubs = [];
  menuSubs.push(await p.addListener('menu', d => onChange(String(d.id), String(d.value))));
  menuSubs.push(await p.addListener('menuClosed', () => { menuSubs.forEach(s => s.remove()); menuSubs = []; }));
  const r = anchor.getBoundingClientRect();
  /* 位置與寬度照原本網頁選單：標題列正下方 8px、左右各留 16px（滿版寬） */
  const hd = (anchor.closest('header') as HTMLElement | null)?.getBoundingClientRect();
  const place = compactWidth
    ? { x: Math.max(8, Math.min(window.innerWidth - compactWidth - 8, r.right - compactWidth)), y: (hd ? hd.bottom : r.bottom) + 8, w: compactWidth }
    : hd ? { x: hd.left + 16, y: hd.bottom + 8, w: hd.width - 32 } : undefined;
  try { await p.menu({ anchor: { x: r.left, y: r.top, w: r.width, h: r.height }, items, place }); return true; }
  catch { menuSubs.forEach(s => s.remove()); menuSubs = []; return false; }
}

/** 原生的詢問框（畫面正中間）。回傳按了哪一顆的 id；被 closeNativeDialog 收掉回傳 ''。
 *  沒有原生（網頁版、舊版 App）回傳 null —— 呼叫的地方照常顯示網頁版的框 */
/** bottom：從下方升上來的面板（點外面或 ✕ 關掉，回傳 ''）。按鈕可帶 SF Symbol（symbol）或網頁畫好的圖（image：PNG 的 data URL，照原色畫） */
export type NativeDialogOpts = { title: string; message?: string; buttons: { id: string; title: string; role?: 'primary' | 'normal'; symbol?: string; image?: string; iconSize?: number }[]; style: 'clear' | 'dark'; bottom?: boolean };
export async function nativeDialog(o: NativeDialogOpts): Promise<string | null> {
  if (!isNative()) return null;
  try {
    const p = await nativeGlass();
    if (!p?.dialog) return null;
    return (await p.dialog(o)).id ?? '';
  } catch { return null; }
}
export async function closeNativeDialog(): Promise<void> {
  if (!isNative()) return;
  try { await (await nativeGlass())?.closeDialog?.(); } catch { /* 沒開著 */ }
}

/** 深色原生面板的一頁（設定、語言、條款…）。rows：一列一列的選項；sections：一段可以捲動的文字 */
export type NativeSheetPage = { title: string; back?: boolean; rows?: { id: string; title: string; checked?: boolean; symbol?: string }[]; foot?: string; intro?: string; note?: string; sections?: { head?: string; body: string }[] };
/** 打開（或換成）這一頁。沒有原生回傳 false（照常用網頁的面板） */
export async function nativeSheet(page: NativeSheetPage): Promise<boolean> {
  if (!isNative()) return false;
  try { const p = await nativeGlass(); if (!p?.sheet) return false; await p.sheet(page); return true; } catch { return false; }
}
export async function closeNativeSheet(): Promise<void> {
  if (!isNative()) return;
  try { await (await nativeGlass())?.closeSheet?.(); } catch { /* 沒開著 */ }
}
export async function onNativeSheet(cb: (id: string) => void): Promise<() => void> {
  if (!isNative()) return () => {};
  try { const p = await nativeGlass(); if (!p?.sheet) return () => {}; const h = await p.addListener('sheet', d => cb(String(d.id))); return () => h.remove(); } catch { return () => {}; }
}
/** 一組原生按鈕跟著網頁捲動位移 */
export async function offsetGlass(group: string, x: number, y: number): Promise<void> {
  if (!isNative()) return;
  try { await (await nativeGlass())?.offset?.({ group, x, y }); } catch { /* 舊版 */ }
}

/** 把開著的原生選單收起來 */
export async function closeGlassMenu(): Promise<void> {
  if (!isNative()) return;
  try { await (await nativeGlass())?.closeMenu?.(); } catch { /* 沒開著 */ }
}
