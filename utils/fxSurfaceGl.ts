/* 畫面上每張特效畫布一個 GPU context。
   glEffects 和顯示在同一張畫布上的 HalationLayer 都對它呼叫 getContext，共用瀏覽器回傳的那一個。
   用 preferWebgl2() 標記過的畫布會拿到 WebGL2，色彩階段（LutGpu，需要 3D 貼圖）才能畫進同一個 context，
   把結果當貼圖交給特效：每格滑桿不必把照片從一個 GPU context 複製到另一個。
   特效的 WebGL1 著色器在 WebGL2 上照樣能跑。一定要在任何地方跟它要 context 之前就先標記 */
const webgl2 = new WeakSet<HTMLCanvasElement>();

export function preferWebgl2(canvas: HTMLCanvasElement) { webgl2.add(canvas); }

export const SURFACE_ATTRS: WebGLContextAttributes = { premultipliedAlpha: false, preserveDrawingBuffer: true };

export function surfaceGl(canvas: HTMLCanvasElement, attrs: WebGLContextAttributes = SURFACE_ATTRS): WebGLRenderingContext | null {
  if (webgl2.has(canvas)) {
    const g = canvas.getContext('webgl2', attrs) as WebGLRenderingContext | null;
    if (g) return g;
  }
  return (canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs)) as WebGLRenderingContext | null;
}

export const isWebgl2 = (gl: WebGLRenderingContext | null | undefined): gl is WebGL2RenderingContext =>
  typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;

/**
 * 已經是這張畫布自己 context 裡的貼圖的照片。列是由下往上的，跟用 UNPACK_FLIP_Y_WEBGL 上傳的畫布一樣
 */
export type GpuImage = { texture: WebGLTexture; w: number; h: number };
