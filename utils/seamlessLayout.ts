import { applyPhotoFx, hasPhotoFx, type PhotoFx } from './photoFx';

export type SeamRect = { x: number; y: number; w: number; h: number };
export type SeamPhoto = { url: string; zoom: number; offsetX: number; offsetY: number; rotation: number; fx?: PhotoFx; opacity?: number };
const images = new Map<string, Promise<HTMLImageElement>>();
const processed = new WeakMap<HTMLImageElement, { key: string; source: CanvasImageSource }>();
function load(url: string) {
  if (!images.has(url)) {
    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img); img.onerror = () => { images.delete(url); reject(new Error('無法載入無縫拼圖相片')); }; img.src = url;
    });
    images.set(url, promise);
    if (images.size > 48) images.delete(images.keys().next().value!);
  }
  return images.get(url)!;
}

/** Shared preview/export renderer. Complementary separable weights form a partition
 * of unity, including T junctions: photos blend into each other, never into the page. */
export async function renderSeamlessLayout(cells: SeamPhoto[], rects: SeamRect[], width: number, height: number, amount = 0, revision = 0, cancelled = () => false) {
  const sources = await Promise.all(cells.map(c => c.url ? load(c.url) : null));
  if (cancelled()) throw new DOMException('Superseded render', 'AbortError');
  const out = document.createElement('canvas'); out.width = Math.max(1, Math.round(width)); out.height = Math.max(1, Math.round(height));
  const ctx = out.getContext('2d')!;
  const layer = document.createElement('canvas'); layer.width = out.width; layer.height = out.height;
  const lc = layer.getContext('2d')!;
  const w = out.width, h = out.height;
  const smallest = Math.min(...rects.map(r => Math.min(r.w * w, r.h * h)));
  // Even the minimum is a subtle blend; no additional image zoom beyond covering
  // the expanded cell. Exterior edges stay sharp and at their original positions.
  const band = smallest * (.012 + Math.max(0, Math.min(100, amount)) / 100 * .238);
  for (let i=0; i<rects.length; i++) {
    // Yield between photos: switching the feature off must not wait for the
    // remaining full-resolution layers of a now-obsolete render.
    if (i) await new Promise<void>(resolve => setTimeout(resolve, 0));
    if (cancelled()) throw new DOMException('Superseded render', 'AbortError');
    const r = rects[i], c = cells[i], img = sources[i]; if (!c) continue;
    const x = r.x*w, y = r.y*h, rw = r.w*w, rh = r.h*h;
    const left = r.x > .00001 ? band : 0, top = r.y > .00001 ? band : 0;
    const right = r.x+r.w < .99999 ? band : 0, bottom = r.y+r.h < .99999 ? band : 0;
    const ex=x-left, ey=y-top, ew=rw+left+right, eh=rh+top+bottom;
    lc.clearRect(0,0,w,h); lc.save(); lc.beginPath(); lc.rect(ex,ey,ew,eh); lc.clip();
    lc.fillStyle='#121212'; lc.fillRect(ex,ey,ew,eh);
    if (img) {
      const key=revision+JSON.stringify(c.fx || {}); let cached=processed.get(img);
      if (!cached || cached.key!==key) {
        cached={key,source:hasPhotoFx(c.fx) ? applyPhotoFx(img,img.naturalWidth,img.naturalHeight,c.fx!) : img}; processed.set(img,cached);
      }
      const a=c.rotation*Math.PI/180, cos=Math.abs(Math.cos(a)), sin=Math.abs(Math.sin(a));
      const scale=Math.max((ew*cos+eh*sin)/img.naturalWidth,(ew*sin+eh*cos)/img.naturalHeight)*Math.max(1,c.zoom);
      const dx=c.offsetX*rw, dy=c.offsetY*rh;
      // Clamp offsets in the image's axes so no uncovered strip is introduced.
      const ux=dx*Math.cos(a)+dy*Math.sin(a), uy=-dx*Math.sin(a)+dy*Math.cos(a);
      const mx=Math.max(0,(img.naturalWidth*scale-ew*cos-eh*sin)/2), my=Math.max(0,(img.naturalHeight*scale-ew*sin-eh*cos)/2);
      const tx=Math.max(-mx,Math.min(mx,ux)), ty=Math.max(-my,Math.min(my,uy));
      lc.translate(ex+ew/2,ey+eh/2); lc.rotate(a); lc.translate(tx,ty); lc.scale(scale,scale);
      lc.globalAlpha=(c.opacity ?? 100)/100; lc.imageSmoothingQuality='high';
      lc.drawImage(cached.source,-img.naturalWidth/2,-img.naturalHeight/2,img.naturalWidth,img.naturalHeight);
    }
    lc.restore(); lc.globalCompositeOperation='destination-in';
    const gx=lc.createLinearGradient(ex,0,ex+ew,0);
    featherStops(gx, left / ew, right / ew);
    lc.fillStyle=gx; lc.fillRect(0,0,w,h);
    const gy=lc.createLinearGradient(0,ey,0,ey+eh);
    featherStops(gy, top / eh, bottom / eh);
    lc.fillStyle=gy; lc.fillRect(0,0,w,h); lc.globalCompositeOperation='source-over';
    ctx.globalCompositeOperation='lighter'; ctx.drawImage(layer,0,0);
  }
  // Canvas alpha is quantized to 8 bits. Normalize its rounding residue so even
  // high-contrast page backgrounds cannot show through a junction.
  const pixels=ctx.getImageData(0,0,w,h);
  for(let i=3;i<pixels.data.length;i+=4) if(pixels.data[i]) pixels.data[i]=255;
  ctx.putImageData(pixels,0,0); ctx.globalCompositeOperation='source-over';
  return out;
}

// Complementary smoothstep ramps have zero slope at both ends. The outermost
// image edge is fully transparent, with no abrupt linear-ramp shoulder.
function featherStops(g: CanvasGradient, start: number, end: number) {
  g.addColorStop(0, start ? 'rgba(255,255,255,0)' : '#fff');
  if (start) for (let n=1;n<=32;n++) {
    const t=n/32, a=t*t*(3-2*t);
    g.addColorStop(2*start*t, `rgba(255,255,255,${a})`);
  }
  if (end) for (let n=0;n<32;n++) {
    const t=n/32, a=1-t*t*(3-2*t);
    g.addColorStop(1-2*end+2*end*t, `rgba(255,255,255,${a})`);
  }
  g.addColorStop(1, end ? 'rgba(255,255,255,0)' : '#fff');
}
