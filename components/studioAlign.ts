import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

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

/* ── 前後對比要看的是「照片最原始的樣子」──────────────────────────
   人像／仿色拿到的照片可能已經是改過的（另一個工具交回來、合併過）。編輯器給一個網址（最一開始那張），
   這裡先載好、解碼好，按下前後對比那一下就能直接畫，跟其他分頁一模一樣。 */
const originalCache = new Map<string, HTMLImageElement>();
export function useOriginalImage(src: string | null | undefined) {
  const ref = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) { ref.current = null; return; }
    const hit = originalCache.get(src);
    if (hit) { ref.current = hit.complete && hit.naturalWidth ? hit : null; if (ref.current) return; }
    let live = true;
    const im = hit || new Image();
    if (!hit) {
      if (!src.startsWith('blob:') && !src.startsWith('data:')) im.crossOrigin = 'anonymous';
      im.src = src;
      originalCache.set(src, im);
      while (originalCache.size > 6) originalCache.delete(originalCache.keys().next().value!);
    }
    (im.decode ? im.decode() : Promise.resolve()).then(() => { if (live) ref.current = im; }, () => {});
    return () => { live = false; };
  }, [src]);
  return ref;
}
/** 把原圖等比放進 w×h（比例不同時其餘留黑，跟編輯器的前後對比同一個畫法） */
export function drawOriginalInto(ctx: CanvasRenderingContext2D, im: HTMLImageElement, w: number, h: number) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  const r = Math.min(w / im.naturalWidth, h / im.naturalHeight);
  const dw = im.naturalWidth * r, dh = im.naturalHeight * r;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(im, (w - dw) / 2, (h - dh) / 2, dw, dh);
  ctx.restore();
}
