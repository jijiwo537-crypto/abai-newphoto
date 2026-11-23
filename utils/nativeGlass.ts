/* 原生的液態玻璃按鈕（對應 ios/App/App/NativeGlassPlugin.swift）。
 *
 * 用法：網頁照常把按鈕排好（位置、大小都由網頁決定），App 裡把那幾顆換成原生的：
 *   const glass = useNativeGlass('gallery', open, () => [ ...每一顆的 id、圖示、DOM 元素... ], onTap, deps)
 * 有原生的時候，網頁那幾顆按鈕要藏起來（visibility: hidden，位置照樣佔著，量得到），glass.native 會是 true。
 * 網頁版、外掛不在的舊版 App：glass.native 是 false，網頁的按鈕照常顯示、照常按。 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { nativePlugin } from './nativeBridge';
import { isNative } from './native';

export interface GlassButtonSpec { id: string; symbol?: string; title?: string; tint?: 'white' | 'red' | 'pink' | 'yellow'; enabled?: boolean }
export type GlassItem =
  | (GlassButtonSpec & { kind: 'circle'; el: HTMLElement | null; shape?: 'roundedSquare' })
  | { kind: 'capsule'; el: HTMLElement | null; buttons: GlassButtonSpec[] };

interface NativeGlassApi {
  show(o: { group: string; items: unknown[]; animate?: boolean }): Promise<void>;
  update(o: { group: string; id: string; symbol?: string; tint?: string; enabled?: boolean }): Promise<void>;
  hide(o: { group: string; animate?: boolean }): Promise<void>;
  addListener(ev: 'tap', cb: (d: { group: string; id: string }) => void): Promise<{ remove: () => void }>;
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
      return it.kind === 'capsule' ? { kind: 'capsule', ...box, buttons: it.buttons } : { ...it, el: undefined, ...box };
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
