import { applyPhotoFx, hasPhotoFx, type PhotoFx } from './photoFx';
import { get2dWide } from './colorSpace';

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

export type SeamSource = { image: CanvasImageSource; width: number; height: number } | null;
const previewSources = new Map<string, Promise<SeamSource>>();
/** 解碼和特效處理只跟來源變動有關，絕不跟融合手勢有關 */
export function prepareSeamSource(cell: SeamPhoto, revision: number): Promise<SeamSource> {
  if (!cell.url) return Promise.resolve(null);
  const key = JSON.stringify([cell.url, cell.fx || {}, revision]);
  let task = previewSources.get(key);
  if (!task) {
    task = load(cell.url).then(async img => {
      if (!hasPhotoFx(cell.fx)) return { image: img, width: img.naturalWidth, height: img.naturalHeight };
      const processed = applyPhotoFx(img, img.naturalWidth, img.naturalHeight, cell.fx!);
      // 特效管線會重用暫存畫布。把它的全尺寸結果凍結一次，不降畫質，也不必每個手勢都序列化像素
      const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;canvas.getContext('2d')!.drawImage(processed,0,0);
      return { image: canvas, width: img.naturalWidth, height: img.naturalHeight };
    }).catch(error => { previewSources.delete(key); throw error; });
    previewSources.set(key, task);
    if (previewSources.size > 24) previewSources.delete(previewSources.keys().next().value!);
  }
  return task;
}

/** 同一套連續的版面本地座標，SVG 和存檔共用 */
export function seamGeometry(rects: SeamRect[], index: number, w: number, h: number, amount: number) {
  const r = rects[index];
  const smallest = Math.min(...rects.map(r => Math.min(r.w * w, r.h * h)));
  // 負數代表同一個原圖 GPU 合成器、不做融合。介面和存檔的無縫數值維持 0..100，羽化曲線也不變
  const band = amount<0?0:smallest * (.012 + Math.max(0, Math.min(100, amount)) / 100 * .238);
  const x = r.x*w, y = r.y*h, rw = r.w*w, rh = r.h*h;
  const left = r.x > .00001 ? band : 0, top = r.y > .00001 ? band : 0;
  const right = r.x+r.w < .99999 ? band : 0, bottom = r.y+r.h < .99999 ? band : 0;
  return { rw, rh, left, top, right, bottom, ex:x-left, ey:y-top, ew:rw+left+right, eh:rh+top+bottom };
}

export function seamImageTransform(c: SeamPhoto, iw: number, ih: number, g: ReturnType<typeof seamGeometry>) {
  const a=c.rotation*Math.PI/180, cos=Math.abs(Math.cos(a)), sin=Math.abs(Math.sin(a));
  const scale=Math.max((g.ew*cos+g.eh*sin)/iw,(g.ew*sin+g.eh*cos)/ih)*Math.max(1,c.zoom);
  const dx=c.offsetX*g.rw, dy=c.offsetY*g.rh;
  const ux=dx*Math.cos(a)+dy*Math.sin(a), uy=-dx*Math.sin(a)+dy*Math.cos(a);
  const mx=Math.max(0,(iw*scale-g.ew*cos-g.eh*sin)/2), my=Math.max(0,(ih*scale-g.ew*sin-g.eh*cos)/2);
  return { scale, tx:Math.max(-mx,Math.min(mx,ux)), ty:Math.max(-my,Math.min(my,uy)), cx:g.ex+g.ew/2, cy:g.ey+g.eh/2, angle:a };
}

/**
 * 預覽和存檔共用的繪製。互補的可分離權重加起來剛好是 1，T 字交界也一樣：照片之間互相融合，絕不融進頁面
 */
export async function renderSeamlessLayout(cells: SeamPhoto[], rects: SeamRect[], width: number, height: number, amount = 0, revision = 0, cancelled = () => false, sourceResolution = false) {
  const sources = await Promise.all(cells.map(c => c.url ? load(c.url) : null));
  if (cancelled()) throw new DOMException('Superseded render', 'AbortError');
  if (sourceResolution) {
    // 預覽縮放不能重新取樣，也不能非同步換掉融合結果。改成在版面本地座標做一份來源解析度的母版
    const aspect = width / Math.max(.000001, height);
    let masterH = 1024;
    sources.forEach((img, i) => {
      const r = rects[i]; if (!img || !r) return;
      const turn = Math.abs((cells[i].rotation || 0) % 180) === 90;
      const iw = turn ? img.naturalHeight : img.naturalWidth;
      const ih = turn ? img.naturalWidth : img.naturalHeight;
      masterH = Math.max(masterH, Math.min(iw / Math.max(.000001, r.w * aspect), ih / Math.max(.000001, r.h)));
    });
    width = masterH * aspect; height = masterH;
  }
  try {
    const textures=await Promise.all(cells.map(c=>prepareSeamSource(c,revision)));
    if(cancelled())throw new DOMException('Superseded render','AbortError');
    // 延後匯入，模組載入時才不會先初始化預覽繪製
    const {renderSeamlessGpu}=await import('./seamlessPreview');
    return await renderSeamlessGpu(cells,rects,textures,width,height,amount,cancelled);
  } catch(error) {
    if(cancelled()||(error instanceof DOMException&&error.name==='AbortError'))throw error;
    // 沒有可用 WebGL 的裝置保留有色彩管理的 2D 備援
    console.warn('Seamless export GPU unavailable; using 2D fallback',error);
  }
  const out = document.createElement('canvas'); out.width = Math.max(1, Math.round(width)); out.height = Math.max(1, Math.round(height));
  const ctx = get2dWide(out)!;
  const layer = document.createElement('canvas'); layer.width = out.width; layer.height = out.height;
  const lc = get2dWide(layer)!;
  const w = out.width, h = out.height;
  // 最小值也是輕微的融合；除了蓋滿擴大的格子，不再額外放大圖片。外緣維持銳利、位置不變
  for (let i=0; i<rects.length; i++) {
    // 每張照片之間讓出執行緒：關掉功能時，不必等已經過時的那次繪製把剩下的原解析度圖層做完
    if (i) await new Promise<void>(resolve => setTimeout(resolve, 0));
    if (cancelled()) throw new DOMException('Superseded render', 'AbortError');
    const r = rects[i], c = cells[i], img = sources[i]; if (!c) continue;
    const geometry=seamGeometry(rects,i,w,h,amount);
    const {left,top,right,bottom,ex,ey,ew,eh}=geometry;
    lc.clearRect(0,0,w,h); lc.save(); lc.beginPath(); lc.rect(ex,ey,ew,eh); lc.clip();
    lc.fillStyle='#121212'; lc.fillRect(ex,ey,ew,eh);
    if (img) {
      const key=revision+JSON.stringify(c.fx || {}); let cached=processed.get(img);
      if (!cached || cached.key!==key) {
        cached={key,source:hasPhotoFx(c.fx) ? applyPhotoFx(img,img.naturalWidth,img.naturalHeight,c.fx!) : img}; processed.set(img,cached);
      }
      const {cx,cy,angle,tx,ty,scale}=seamImageTransform(c,img.naturalWidth,img.naturalHeight,geometry);
      lc.translate(cx,cy); lc.rotate(angle); lc.translate(tx,ty); lc.scale(scale,scale);
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
  // 畫布的 alpha 只有 8 位元。把取整的殘差補正，對比很強的頁面背景也不會從交界透出來
  const pixels=ctx.getImageData(0,0,w,h);
  for(let i=3;i<pixels.data.length;i+=4) if(pixels.data[i]) pixels.data[i]=255;
  ctx.putImageData(pixels,0,0); ctx.globalCompositeOperation='source-over';
  return out;
}

// 互補的 smoothstep 漸層兩端斜率都是 0，最外側的圖片邊緣完全透明，沒有線性漸層那種突兀的肩
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
