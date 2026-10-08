/* One GPU context per on-screen effect surface.
 *
 * glEffects and the HalationLayers that present on the same canvas all call
 * getContext on it and share the one context the browser returns. A canvas
 * marked with preferWebgl2() gets a WebGL2 context instead, so the colour
 * stage (LutGpu, which needs 3D textures) can render into the same context
 * and hand its result to the effects as a texture: no copy of the photo from
 * one GPU context to another on every slider step.
 *
 * The WebGL1 shaders of the effects run unchanged on WebGL2. A canvas must
 * be marked before anything asks it for a context.
 */
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

/** A photo that is already a texture in the surface's own context. Rows are
 *  bottom-up, as a canvas uploaded with UNPACK_FLIP_Y_WEBGL. */
export type GpuImage = { texture: WebGLTexture; w: number; h: number };
