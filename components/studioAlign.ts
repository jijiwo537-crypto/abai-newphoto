import { useLayoutEffect, useState, type RefObject } from 'react';

/* 人像、仿色嵌在編輯器裡時，照片要擺在跟編輯器預覽「同一組像素」上：
   編輯器把它算好的框（螢幕座標）傳進來，這裡換成舞台裡的四邊內距。
   內距一設，照片的內容框就剛好等於那個框 —— 自己用 max-w／max-h 去 contain 的話
   會算出 357.98 × 477.3 這種小數，切過去時圖片就會「動一下」。
   比例對不上（例如編輯器已經裁切過）就不套，照舊自己置中。 */
export type AlignRect = { left: number; top: number; width: number; height: number };

export function useAlignPad(align: AlignRect | null | undefined, stage: RefObject<HTMLElement | null>, aspect: number | null) {
  const [pad, setPad] = useState<{ paddingTop: number; paddingLeft: number; paddingRight: number; paddingBottom: number } | null>(null);
  useLayoutEffect(() => {
    const el = stage.current;
    const measure = () => {
      if (!el || !align || !aspect || Math.abs(align.width / align.height - aspect) > 0.006 * aspect) { setPad(p => p === null ? p : null); return; }
      const s = el.getBoundingClientRect();
      const next = {
        paddingTop: align.top - s.top,
        paddingLeft: align.left - s.left,
        paddingRight: s.right - (align.left + align.width),
        paddingBottom: s.bottom - (align.top + align.height),
      };
      if (next.paddingTop < 0 || next.paddingLeft < 0 || next.paddingRight < 0 || next.paddingBottom < 0) { setPad(p => p === null ? p : null); return; }
      setPad(p => p && Math.abs(p.paddingTop - next.paddingTop) < 0.01 && Math.abs(p.paddingLeft - next.paddingLeft) < 0.01
        && Math.abs(p.paddingRight - next.paddingRight) < 0.01 && Math.abs(p.paddingBottom - next.paddingBottom) < 0.01 ? p : next);
    };
    measure();
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [align?.left, align?.top, align?.width, align?.height, aspect, stage]);
  return pad;
}

/** 有對齊框時，舞台裡的照片元素一律撐滿內容框（不再自己 contain） */
export const ALIGN_FILL_CSS = `.studio-fit > canvas, .studio-fit > img, .studio-fit > div, .studio-fit > div > canvas { width:100% !important; height:100% !important; max-width:none !important; max-height:none !important; object-fit:fill; }`;

/* ── 編輯器與人像／仿色共用預覽的縮放 ─────────────────────────────
   三邊的照片在沒縮放時擺在螢幕上一模一樣的位置（見 useAlignPad），所以縮放可以用一個跟元件無關的
   形式交換：「縮放後的螢幕座標 ＝ k × 沒縮放時的螢幕座標 ＋ (bx, by)」。
   切分頁時把離開那一邊的換算成這個，再套到要去的那一邊，照片就停在一模一樣的大小與位置。 */
export type StudioView = { k: number; bx: number; by: number };
export type StudioViewApi = { get: () => StudioView; set: (v: StudioView) => void };
/** 以元素中心為原點的 translate(tx, ty) scale(k)（CSS 預設 transform-origin）←→ 共用形式；c 是那個元素中心的螢幕座標 */
export const centerViewToShared = (k: number, tx: number, ty: number, c: { x: number; y: number }): StudioView =>
  ({ k, bx: (1 - k) * c.x + tx, by: (1 - k) * c.y + ty });
export const sharedToCenterView = (v: StudioView, c: { x: number; y: number }) =>
  ({ k: v.k, tx: v.bx - (1 - v.k) * c.x, ty: v.by - (1 - v.k) * c.y });

/** 佔位用的照片真的「解碼好、畫得出來」才回報。只看 complete 的話，那一格可能還是空的（就是一進去黑一下） */
export function paintedWhenDecoded(el: HTMLImageElement | null, done: () => void) {
  if (!el || !el.complete || !el.naturalWidth) return;
  const d = (el as any).__decoding as Promise<void> | undefined;
  if (d) return;
  (el as any).__decoding = (el.decode ? el.decode() : Promise.resolve()).then(done, done);
}
