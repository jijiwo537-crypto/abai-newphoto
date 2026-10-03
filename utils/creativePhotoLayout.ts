/** A photo region is one scene surface, not a stack of floating objects.
 * Coordinates are continuous and shared by painting and swapping. Originals are
 * drawn directly at the requested preview/export scale; no composite thumbnail
 * is substituted while zooming. */
import { TEMPLATE_MAP } from './layoutTemplates';
export const CREATIVE_PHOTO_LIMIT = 9;
export const PHOTO_SWAP_HOLD_MS = 304;
export type PhotoArrangement = 'grid' | 'horizontal' | 'vertical' | 'feature';
export type RegionPhoto = { src: string; width: number; height: number; zoom?: number; offsetX?: number; offsetY?: number };
export type PhotoRegion = { photos: RegionPhoto[]; arrangement: PhotoArrangement; landscape: boolean; templateIndex?: number; multi?: boolean; overflowPhotos?: RegionPhoto[]; seamless?: boolean; seamlessAmount?: number };
export type PhotoRect = { x: number; y: number; w: number; h: number; squareOverlay?:boolean; overlayAspect?:number };

/** Creative-only additions: persisted cross-page template indices remain unchanged. */
const overlayTemplate=(name:string,positions:('top'|'bottom')[],aspect:number)=>{const width=aspect===1?.32:.384;return {name,rects:[
  {x:0,y:0,w:1,h:.5},{x:0,y:.5,w:1,h:.5},
  ...positions.map(side=>({x:(1-width)/2,y:(side==='top'?.25:.75)-width/(2*aspect),w:width,h:width/aspect,overlayAspect:aspect})),
]};};
const CREATIVE_TEMPLATE_MAP:Record<number,{name:string;rects:PhotoRect[]}[]>={...TEMPLATE_MAP,
  3:[...TEMPLATE_MAP[3],overlayTemplate('上層方形',['top'],1),overlayTemplate('上層橫式',['top'],4/3),overlayTemplate('下層橫式',['bottom'],4/3)],
  4:[...TEMPLATE_MAP[4],overlayTemplate('上下雙層橫式',['top','bottom'],4/3)],
};

export function photoTemplates(count: number) {
  return CREATIVE_TEMPLATE_MAP[count] || [];
}
/** Picker choices exclude single-photo layouts, without invalidating old drafts. */
export const PHOTO_LAYOUT_COUNTS=[2,3,4,5,6,7,8,9,10] as const;
let dimSource:CanvasImageSource|null=null,dimCanvas:HTMLCanvasElement|null=null;
/** Darken RGB while retaining the source alpha; one full-resolution cached
 * source only. In particular, an opaque overlay photo remains opaque. */
export function dimmedPhotoSource(source:CanvasImageSource):CanvasImageSource{
  if(source===dimSource&&dimCanvas)return dimCanvas;
  const image=source as any,w=image.naturalWidth||image.videoWidth||image.width,h=image.naturalHeight||image.videoHeight||image.height;
  if(!w||!h)return source;
  const canvas=dimCanvas||(dimCanvas=document.createElement('canvas'));canvas.width=w;canvas.height=h;
  let g:CanvasRenderingContext2D|null=null;
  try{g=canvas.getContext('2d',{colorSpace:'display-p3'});}catch{}
  g ||= canvas.getContext('2d');if(!g)return source;
  g.drawImage(source,0,0,w,h);g.globalCompositeOperation='source-atop';g.fillStyle='rgba(0,0,0,.65)';g.fillRect(0,0,w,h);g.globalCompositeOperation='source-over';
  dimSource=source;return canvas;
}
export function clearPhotoDimmer(){if(dimCanvas)dimCanvas.width=dimCanvas.height=1;dimSource=null;}
/** Quick choices do not change persisted catalog indices. */
export function quickPhotoTemplateIndices(count:number){
  const templates=photoTemplates(count);
  return count===4?[0,1,2,templates.findIndex(t=>t.name==='上下雙層方形')]:[0,1,2,3];
}
export function regionRects(region: PhotoRegion, width = 1, height = 1): PhotoRect[] {
  if (region.templateIndex === undefined) return photoRegionRects(region.photos.length, region.arrangement);
  return (photoTemplates(region.photos.length)[region.templateIndex] || photoTemplates(region.photos.length)[0]).rects.map(r => {
    if (!r.squareOverlay && !r.overlayAspect) return r;
    const side = Math.min(width, height) * .3328 * (r.overlayAspect&&r.overlayAspect!==1?1.2:1), w = side / width, h = side / (r.overlayAspect||1) / height;
    return { ...r, x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
  });
}
/** Feather the two background halves only; foreground insets stay untouched. */
export function seamlessPhotoBase(region:PhotoRegion):PhotoRegion|null{
  const rects=regionRects(region),overlay=rects.findIndex(r=>r.squareOverlay||r.overlayAspect);
  if(overlay===2&&rects.slice(2).every(r=>r.squareOverlay||r.overlayAspect))
    return {...region,photos:region.photos.slice(0,2),templateIndex:undefined,arrangement:'vertical'};
  return Math.abs(rects.reduce((sum,r)=>sum+r.w*r.h,0)-1)<1e-5?region:null;
}
export function changePhotoTemplate(region: PhotoRegion, count: number, templateIndex: number): PhotoRegion {
  count = Math.max(2, Math.min(10, count));
  const all = [...region.photos, ...(region.overflowPhotos || [])];
  const photos = Array.from({length: count}, (_, i) => all[i] || {src: '', width: 1, height: 1});
  return {...region, photos, overflowPhotos: all.slice(count).filter(p => p.src), templateIndex, multi: true};
}
export function photoCrop(photo: RegionPhoto, w: number, h: number) {
  const zoom = Math.max(1, Math.min(8, photo.zoom || 1));
  const scale = Math.max(w / photo.width, h / photo.height) * zoom;
  const sw = w / scale, sh = h / scale;
  const sx = Math.max(0, Math.min(photo.width - sw, (photo.width - sw) / 2 - (photo.offsetX || 0) * sw));
  const sy = Math.max(0, Math.min(photo.height - sh, (photo.height - sh) / 2 - (photo.offsetY || 0) * sh));
  return {sx, sy, sw, sh};
}

export function photoRegionRects(count: number, arrangement: PhotoArrangement = 'grid'): PhotoRect[] {
  const n = Math.min(CREATIVE_PHOTO_LIMIT, Math.max(0, Math.floor(count)));
  if (!n) return [];
  if (n === 1) return [{ x: 0, y: 0, w: 1, h: 1 }];
  if (arrangement === 'horizontal' || arrangement === 'vertical') {
    return Array.from({ length: n }, (_, i) => arrangement === 'horizontal'
      ? { x: i / n, y: 0, w: (i + 1) / n - i / n, h: 1 }
      : { x: 0, y: i / n, w: 1, h: (i + 1) / n - i / n });
  }
  if (arrangement === 'feature') {
    const tail = photoRegionRects(n - 1, 'grid');
    return [{ x: 0, y: 0, w: .6, h: 1 }, ...tail.map(r => ({ x: .6 + r.x * .4, y: r.y, w: r.w * .4, h: r.h }))];
  }
  const rows = Math.ceil(Math.sqrt(n));
  // Balance the final row; there are no blank cells when importing 5/7/8 photos.
  const perRow = Math.floor(n / rows), extra = n % rows;
  return Array.from({ length: rows }, (_, row) => {
    const cols = perRow + (row < extra ? 1 : 0);
    return Array.from({ length: cols }, (_, col) => ({
      x: col / cols, y: row / rows,
      w: (col + 1) / cols - col / cols, h: (row + 1) / rows - row / rows,
    }));
  }).flat();
}

export function photoRegionHit(rects: PhotoRect[], x: number, y: number): number {
  if (x < 0 || y < 0 || x > 1 || y > 1) return -1;
  // Overlay templates are painted last and must own their frontmost hit.
  for(let i = rects.length - 1; i >= 0; i--){const r=rects[i];if(x >= r.x && y >= r.y && x < r.x+r.w+1e-10 && y < r.y+r.h+1e-10)return i;}
  return -1;
}

export function swapRegionPhotos(region: PhotoRegion, a: number, b: number): PhotoRegion {
  if (a === b || a < 0 || b < 0 || a >= region.photos.length || b >= region.photos.length) return region;
  const photos = [...region.photos];
  [photos[a], photos[b]] = [photos[b], photos[a]];
  return { ...region, photos };
}

export function paintPhotoRegion(ctx: CanvasRenderingContext2D, region: PhotoRegion,
  decoded: Map<string, HTMLImageElement>, x: number, y: number, w: number, h: number, dimIndex = -1, indices?:readonly number[]) {
  const rects = regionRects(region, w, h);
  const previousComposite = ctx.globalCompositeOperation;
  // A multi-image draw must not use `copy` per cell (it erases previous cells).
  if (previousComposite === 'copy') {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }
  rects.forEach((r, i) => {
    if(indices&&!indices.includes(i))return;
    const photo = region.photos[i], img = decoded.get(photo.src);
    const dx = x + r.x * w, dy = y + r.y * h, dw = r.w * w, dh = r.h * h;
    if (!img) {ctx.save();ctx.fillStyle='#0c0c0c';ctx.fillRect(dx,dy,dw,dh);ctx.restore();return;}
    const {sx,sy,sw,sh}=photoCrop(photo,dw,dh);
    ctx.drawImage(i===dimIndex?dimmedPhotoSource(img):img, sx, sy, sw, sh, dx, dy, dw, dh);
  });
  ctx.globalCompositeOperation = previousComposite;
}
