/**
 * 廣色域（Display P3）支援。
 *
 * iPhone 從 iPhone 7 起拍的照片就是 Display P3，色域比 sRGB 大約寬 25%。
 * canvas 沒有指定 colorSpace 的話預設是 sRGB —— 照片畫進去的那一刻，
 * 落在 sRGB 之外的顏色（夕陽、霓虹燈、鮮豔的花）就被裁掉了，之後再也拿不回來。
 *
 * 但這只用在「不做調色的地方」：拼圖、經典拼圖這類單純把圖拼起來再導出的流程。
 * 編輯頁的濾鏡是拿「像素數字」去查表的，同一個顏色在 P3 裡的數字跟 sRGB 不一樣
 * （純紅從 255,0,0 變成約 234,51,35），整組濾鏡的成品都會跟著變 —— 所以編輯頁
 * 維持 sRGB，看起來的樣子完全不動。
 */

let supported: boolean | null = null;

/** 這個瀏覽器的 2D canvas 支不支援 display-p3 */
export function supportsP3(): boolean {
  if (supported !== null) return supported;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d', { colorSpace: 'display-p3' } as CanvasRenderingContext2DSettings);
    supported = !!ctx && (ctx.getContextAttributes?.() as any)?.colorSpace === 'display-p3';
  } catch {
    supported = false;
  }
  return supported;
}

/**
 * 取 2D 繪圖環境，支援的話用 Display P3。
 * 不支援的瀏覽器會拿到跟以前一模一樣的 sRGB 環境，行為不變。
 */
export function get2dWide(
  canvas: HTMLCanvasElement,
  opts: CanvasRenderingContext2DSettings = {},
): CanvasRenderingContext2D | null {
  if (supportsP3()) {
    const ctx = canvas.getContext('2d', { ...opts, colorSpace: 'display-p3' } as CanvasRenderingContext2DSettings);
    if (ctx) return ctx;
  }
  return canvas.getContext('2d', opts);
}
