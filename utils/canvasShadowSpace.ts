/* 畫布陰影（發光）的模糊量照規格是「不吃目前的變換矩陣」：shadowBlur = 8 就是
   螢幕上 8 個實體像素，不管 ctx 有沒有 scale。整個 App 的發光都照這條規則算
   （預覽先乘上解析度倍率再設 shadowBlur）。

   但不是每個瀏覽器都照規格：有的會把 shadowBlur／shadowOffset 再乘上目前矩陣的
   縮放。預覽的畫布是放大過矩陣在畫的（高解析＋預覽倍率，常常 3 倍以上），
   匯出時矩陣接近 1 —— 那種瀏覽器上預覽的光就被放大好幾倍、散到幾乎看不見，
   細細的邊框類圖形最明顯；匯出卻是正常的。

   這裡在開頭實際量一次：同樣的方塊、同樣的 shadowBlur，在 1 倍與 4 倍矩陣下
   各畫一次，看陰影散開的寬度有沒有跟著矩陣變。有跟著變的話，就把 shadowBlur／
   shadowOffset 的設定改成「先除掉目前矩陣的縮放」，結果就跟規格一樣；
   照規格的瀏覽器量出來一樣，什麼都不改。 */

const spread = (g: CanvasRenderingContext2D, scale: number, offset: number) => {
  const c = g.canvas;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, c.width, c.height);
  g.setTransform(scale, 0, 0, scale, 0, 0);
  g.fillStyle = '#000';
  g.shadowColor = '#000';
  g.shadowBlur = 6;
  g.shadowOffsetX = offset;
  g.shadowOffsetY = 0;
  // 方塊本身在實體像素 (60..64, 18..22)，跟矩陣無關
  g.fillRect(60 / scale, 18 / scale, 4 / scale, 4 / scale);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.shadowBlur = 0; g.shadowOffsetX = 0;
  const d = g.getImageData(0, 20, c.width, 1).data;
  let x0 = -1, x1 = -1;
  for (let x = 0; x < c.width; x++) if (d[x * 4 + 3] > 1) { if (x0 < 0) x0 = x; x1 = x; }
  return { x0, x1 };
};

let installed = false;
export const installCanvasShadowSpace = () => {
  // 測試用：比對「沒有修正時」的樣子
  if (installed || typeof document === 'undefined' || (globalThis as any).__ABAI_SHADOW_FIX_OFF) return;
  installed = true;
  try {
    const c = document.createElement('canvas');
    c.width = 240; c.height = 40;
    const g = c.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D | null;
    if (!g) return;
    const a = spread(g, 1, 0), b = spread(g, 4, 0);
    const blurFollows = a.x0 >= 0 && b.x0 >= 0 && (b.x1 - b.x0) > (a.x1 - a.x0) * 2;
    const oa = spread(g, 1, 30), ob = spread(g, 4, 30);
    const offsetFollows = oa.x1 >= 0 && ob.x1 >= 0 && ob.x1 - oa.x1 > 40;
    if (!blurFollows && !offsetFollows) return;
    const P = CanvasRenderingContext2D.prototype as any;
    const scaleOf = (ctx: CanvasRenderingContext2D) => {
      const m = ctx.getTransform();
      const s = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
      return s > 1e-6 && Number.isFinite(s) ? s : 1;
    };
    const patch = (name: string) => {
      const desc = Object.getOwnPropertyDescriptor(P, name);
      if (!desc?.get || !desc.set) return;
      Object.defineProperty(P, name, {
        configurable: true, enumerable: desc.enumerable,
        get(this: CanvasRenderingContext2D) { return desc.get!.call(this) * scaleOf(this); },
        set(this: CanvasRenderingContext2D, v: number) { desc.set!.call(this, Number(v) / scaleOf(this)); },
      });
    };
    if (blurFollows) patch('shadowBlur');
    if (offsetFollows) { patch('shadowOffsetX'); patch('shadowOffsetY'); }
    (globalThis as any).__ABAI_SHADOW_SPACE = { blurFollows, offsetFollows };
  } catch { /* 量不到就照原本的行為 */ }
};
