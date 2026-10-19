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
