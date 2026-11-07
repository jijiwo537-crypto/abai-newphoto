type Glow = { canvas: HTMLCanvasElement; pad: number; width: number; height: number; bytes: number };
const cache = new Map<string, Glow>();
let bytes = 0;
const BUDGET = 64 * 1024 * 1024;

/**
 * 只快取柔光的光場，銳利的線條每次都在目前場景裡用向量畫。整個預覽縮放範圍用同一個密度，
 * 開始、結束手勢時不會換畫質
 */
export function paintCachedClassicGlow(ctx: CanvasRenderingContext2D, path: Path2D,
  key: string, width: number, height: number, lineWidth: number, dash: number[],
  color: string, blurs: number[]) {
  const density = Math.max(1, window.devicePixelRatio || 1) * 1.5 * 3;
  const id = `${key}|${density}`;
  let glow = cache.get(id);
  if (!glow) {
    const pad = Math.max(...blurs) * 3 + lineWidth * 2 + 2;
    const w = Math.ceil((width + pad * 2) * density), h = Math.ceil((height + pad * 2) * density);
    const size = w * h * 4;
    if (!Number.isFinite(size) || size > BUDGET || w > 8192 || h > 8192) return false;
    while (bytes + size > BUDGET && cache.size) {
      const oldest = cache.keys().next().value!;
      const old = cache.get(oldest)!;bytes -= old.bytes;
      old.canvas.width = old.canvas.height = 1;cache.delete(oldest);
    }
    const canvas = document.createElement('canvas');canvas.width = w;canvas.height = h;
    const g = canvas.getContext('2d');if (!g) return false;
    // 陰影投到貼圖裡，原本的線條留在外面，快取的點陣線條才不會取代即時的向量邊緣
    const offset = w + (width + pad * 2) * density;
    g.setTransform(density,0,0,density,pad*density-offset,pad*density);
    g.strokeStyle = color;g.lineWidth = lineWidth;g.lineCap = 'butt';g.setLineDash(dash);
    g.shadowColor = color;g.shadowOffsetX = offset;
    for (const blur of blurs) {g.shadowBlur = blur*density;g.stroke(path);}
    glow = {canvas,pad,width:w/density,height:h/density,bytes:size};
    cache.set(id,glow);bytes += size;
  } else {cache.delete(id);cache.set(id,glow);}
  ctx.drawImage(glow.canvas,-glow.pad,-glow.pad,glow.width,glow.height);
  return true;
}
