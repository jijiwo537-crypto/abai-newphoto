/* 原生預覽層（對應 ios/App/App/NativePreviewPlugin.swift）。
 *
 * 用在「網頁顯示不了」的情況：HDR 照片。WebKit 只能用 SDR 顯示照片，
 * 原生的 Metal＋EDR 才能讓亮部真的比白色更亮。照片那一塊交給原生畫，
 * 網頁把那一塊挖成透明（其他按鈕、面板照舊是網頁的）。
 *
 * useNativeHdrPreview：HDR 照片在「還沒編輯」和「按住對比看原圖」時，用原生 HDR 顯示原圖。
 * 一開始編輯，網頁的畫面就接手（濾鏡、特效都在網頁那條管線上）。 */
import { useEffect, useRef } from 'react';
import { isNative } from './native';
import { nativePlugin, nativePathOf } from './nativeBridge';
import { nativeImage } from './nativeImage';

interface NativePreviewApi {
  show(o: Record<string, unknown>): Promise<void>;
  update(o: Record<string, unknown>): Promise<void>;
  hide(): Promise<void>;
}

const hdrCache = new Map<string, Promise<boolean>>();
function isHdr(path: string): Promise<boolean> {
  let p = hdrCache.get(path);
  if (!p) {
    p = (async () => {
      const img = await nativeImage();
      if (!img) return false;
      try { return !!((await img.info({ path })) as { hdr?: boolean }).hdr; } catch { return false; }
    })();
    hdrCache.set(path, p);
  }
  return p;
}

/** 把 el 這一塊和它的上層背景挖成透明，回傳還原的函式 */
export function punchThrough(el: HTMLElement, hide: HTMLElement[]): () => void {
  const restore: (() => void)[] = [];
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    const prev = n.style.backgroundColor;
    n.style.backgroundColor = 'transparent';
    restore.push(() => { n!.style.backgroundColor = prev; });
  }
  for (const h of hide) {
    const prev = h.style.visibility;
    h.style.visibility = 'hidden';
    restore.push(() => { h.style.visibility = prev; });
  }
  return () => restore.reverse().forEach(f => f());
}

export function useNativeHdrPreview(opts: {
  container: () => HTMLElement | null;
  hideWhileShown: () => (HTMLElement | null | undefined)[];
  src: string | null | undefined;
  active: boolean;
}) {
  const { container, hideWhileShown, src, active } = opts;
  const state = useRef<{ restore: (() => void) | null; shown: boolean }>({ restore: null, shown: false });
  useEffect(() => {
    if (!isNative()) return;
    const path = nativePathOf(src ?? undefined);
    const el = container();
    let cancelled = false, ro: ResizeObserver | null = null;
    const off = async () => {
      if (!state.current.shown) return;
      state.current.shown = false;
      state.current.restore?.(); state.current.restore = null;
      const api = await nativePlugin<NativePreviewApi>('NativePreview');
      await api?.hide().catch(() => {});
    };
    if (!active || !path || !el) { void off(); return; }
    void (async () => {
      if (!(await isHdr(path)) || cancelled) { void off(); return; }
      const api = await nativePlugin<NativePreviewApi>('NativePreview');
      if (!api || cancelled) return;
      const rect = () => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
      await api.show({ path, hdr: true, ...rect() }).catch(() => {});
      if (cancelled) return;
      if (!state.current.shown) {
        state.current.restore = punchThrough(el, hideWhileShown().filter((x): x is HTMLElement => !!x));
        state.current.shown = true;
      }
      ro = new ResizeObserver(() => { void api.update(rect()).catch(() => {}); });
      ro.observe(el);
    })();
    return () => { cancelled = true; ro?.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, active]);
  /* 離開編輯器時一定收掉 */
  useEffect(() => () => {
    if (!state.current.shown) return;
    state.current.restore?.();
    void nativePlugin<NativePreviewApi>('NativePreview').then(api => api?.hide());
  }, []);
}
