/** One coordinate system and one screen-density surface per stacking run.
 * Interaction DOM is deliberately not used to measure or place object ink.
 * Pinch, scroll and animation all repaint the same logical scene coordinates.
 */
import { ClassicPhotoLayer, type PhotoPaint } from './ClassicPhotoLayer';
import {disposeBackdropMasks} from '../utils/backdropMasks';

export type SceneBounds = { x: number; y: number; width: number; height: number };
export const sceneRectBounds = (ctx: CanvasRenderingContext2D, x: number, y: number,
  width: number, height: number, pixelPad = 2): SceneBounds => {
  const m = ctx.getTransform();
  const points = [[x,y],[x+width,y],[x,y+height],[x+width,y+height]]
    .map(([px,py]) => [m.a*px+m.c*py+m.e,m.b*px+m.d*py+m.f]);
  const left = Math.floor(Math.min(...points.map(p=>p[0]))-pixelPad);
  const top = Math.floor(Math.min(...points.map(p=>p[1]))-pixelPad);
  return {x:left,y:top,width:Math.ceil(Math.max(...points.map(p=>p[0]))+pixelPad)-left,
    height:Math.ceil(Math.max(...points.map(p=>p[1]))+pixelPad)-top};
};
export const unionSceneBounds = (a: SceneBounds, b: SceneBounds): SceneBounds => {
  if (!a.width || !a.height) return b;
  if (!b.width || !b.height) return a;
  const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);
  return {x,y,width:Math.max(a.x+a.width,b.x+b.width)-x,height:Math.max(a.y+a.height,b.y+b.height)-y};
};

export type SceneEntry = {
  nativePhoto?: string;
  z: number;
  opacity?: number | (() => number);
  animateUntil?: number | (() => number);
  /** Lower-ink revision; undefined opts dynamic/unknown content out of caching. */
  backdropKey?: () => unknown;
  paint: (ctx: CanvasRenderingContext2D, pixelsPerUnit: number) => void | SceneBounds;
};

export class ClassicVectorScene {
  private entries = new Map<string, SceneEntry>();
  private surfaces: HTMLCanvasElement[] = [];
  private damage = new WeakMap<HTMLCanvasElement, SceneBounds | null>();
  private host: HTMLElement | null = null;
  private viewport: HTMLElement | null = null;
  private frame = 0;
  private alphaSurface: HTMLCanvasElement | null = null;
  private observer: ResizeObserver | null = null;
  private scale = () => 1;
  private photos = new Map<string, ClassicPhotoLayer>();
  private photoContext: CanvasRenderingContext2D | null = null;
  private activePhoto: ClassicPhotoLayer | null = null;
  private pageMatrices: DOMMatrixReadOnly[] = [];
  private pageRects: { x: number; y: number; width: number; height: number }[] = [];
  private paintedScrollLeft = NaN;
  private paintedScrollTop = NaN;
  imageResolver: (src: string) => HTMLImageElement = src => { const image=new Image();image.src=src;return image; };
  pagePatternPainter?: (ctx:CanvasRenderingContext2D,id:string,width:number,height:number)=>void;
  pagePatternKey?: (id:string)=>unknown;
  private backdropSurface: HTMLCanvasElement | null = null;
  private capturingBackdrop = false;
  backdropCacheStamp: string | undefined;
  private backdropTokens = new WeakMap<object,number>();
  private backdropSerial = 0;

  /** Replay lower ink into the same physical viewport. DOM photos/layouts and
   * vector entries share this snapshot; UI, guides and higher ink are excluded. */
  backdrop(target: CanvasRenderingContext2D, z: number, density: number, root: DOMMatrix) {
    if(this.capturingBackdrop || !this.host)return target.canvas;
    const host=this.host, hr=host.getBoundingClientRect(), k=Math.max(.0001,this.scale());
    const canvas=this.backdropSurface??(this.backdropSurface=document.createElement('canvas'));
    if(canvas.width!==target.canvas.width)canvas.width=target.canvas.width;
    if(canvas.height!==target.canvas.height)canvas.height=target.canvas.height;
    const g=canvas.getContext('2d')!;
    g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,canvas.width,canvas.height);
    const screenToScene=new DOMMatrix([1/k,0,0,1/k,-hr.left/k,-hr.top/k]);
    const jobs:{z:number;paint:()=>void}[]=[];
    const tokens=this.backdropTokens,token=(o:object)=>{if(!tokens.has(o))tokens.set(o,++this.backdropSerial);return tokens.get(o);};
    const keys:unknown[]=[z,density,root.toString(),hr.left,hr.top,k,canvas.width,canvas.height];let cacheable=true;
    const cssMatrix=(node:Element)=>{
      let linear=new DOMMatrix();
      for(let n:Element|null=node;n;n=n.parentElement){const t=getComputedStyle(n).transform;if(t!=='none')linear=new DOMMatrix(t).multiply(linear);}
      linear.e=linear.f=0;
      const rect=node.getBoundingClientRect(),w=(node as HTMLElement).offsetWidth||rect.width,h=(node as HTMLElement).offsetHeight||rect.height;
      const corners=[[0,0],[w,0],[0,h],[w,h]].map(([x,y])=>linear.transformPoint({x,y}));
      const minX=Math.min(...corners.map(p=>p.x)),minY=Math.min(...corners.map(p=>p.y));
      const spanX=Math.max(...corners.map(p=>p.x))-minX,spanY=Math.max(...corners.map(p=>p.y))-minY;
      const q=spanX>0?rect.width/spanX:spanY>0?rect.height/spanY:1;
      return {m:new DOMMatrix([linear.a*q,linear.b*q,linear.c*q,linear.d*q,rect.left-minX*q,rect.top-minY*q]),w,h};
    };
    const setScreen=(m:DOMMatrix)=>g.setTransform(root.multiply(screenToScene).multiply(m));
    const alpha=(node:Element)=>{let a=1;for(let n:Element|null=node;n&&n!==host;n=n.parentElement)a*=Number(getComputedStyle(n).opacity);return a;};
    const level=(node:Element)=>{
      const wrapper=node.closest<HTMLElement>('[data-layout-wrapper], [data-floating-id]');
      const ink=Number(wrapper?.style.zIndex||0),page=Number(node.closest<HTMLElement>('[data-page-id]')?.style.zIndex||0);
      return page>ink?page+ink:ink;
    };
    const owned=(node:Element)=>{const id=node.closest('[data-floating-id]')?.getAttribute('data-floating-id');return !!id&&this.entries.has(id);};
    for(const page of host.querySelectorAll<HTMLElement>(':scope > [data-page-id]')){
      const pageZ=Number(page.style.zIndex||-1000);if(pageZ>=z)continue;
      const pose=cssMatrix(page);keys.push(['page',page.dataset.pageId,pageZ,pose.m.toString(),pose.w,pose.h,getComputedStyle(page).backgroundColor,this.pagePatternPainter&&token(this.pagePatternPainter),this.pagePatternKey?.(page.dataset.pageId!)]);
      jobs.push({z:pageZ,paint:()=>{const {m,w,h}=cssMatrix(page);setScreen(m);g.fillStyle=getComputedStyle(page).backgroundColor;g.fillRect(0,0,w,h);this.pagePatternPainter?.(g,page.dataset.pageId!,w,h);}});
    }
    // Layout SVG image CTMs include cell cropping, rotation, page pose and zoom.
    for(const node of host.querySelectorAll<SVGGraphicsElement>('[data-layout-wrapper] svg image, [data-layout-wrapper] svg rect')){
      if(node.closest('defs')||owned(node)||level(node)>=z)continue;
      // Layout clips/materials can update independently of entry registration.
      cacheable=false;
      jobs.push({z:level(node),paint:()=>{
        const m=node.getScreenCTM();if(!m)return;g.globalAlpha=alpha(node);
        for(let n:Element|null=node.parentElement;n&&n!==host;n=n.parentElement){
          const clip=n.getAttribute('clip-path')?.match(/url\(#(.+)\)/)?.[1];
          if(!clip)continue;
          const definition=document.getElementById(clip),nm=(n as SVGGraphicsElement).getScreenCTM?.();
          if(!definition||!nm)continue;setScreen(nm);g.beginPath();
          for(const r of definition.querySelectorAll('rect'))g.roundRect(r.x.baseVal.value,r.y.baseVal.value,r.width.baseVal.value,r.height.baseVal.value,r.rx.baseVal.value||0);
          g.clip();
        }
        setScreen(m);
        if(node.tagName==='image'){
          const image=node as SVGImageElement,src=this.imageResolver(image.href.baseVal);
          if(src.complete&&src.naturalWidth)g.drawImage(src,image.x.baseVal.value,image.y.baseVal.value,image.width.baseVal.value,image.height.baseVal.value);
        }else{const rect=node as SVGRectElement;g.fillStyle=getComputedStyle(rect).fill;g.beginPath();g.roundRect(rect.x.baseVal.value,rect.y.baseVal.value,rect.width.baseVal.value,rect.height.baseVal.value,rect.rx.baseVal.value||0);g.fill();}
      }});
    }
    for(const node of host.querySelectorAll<HTMLCanvasElement|HTMLImageElement|HTMLVideoElement>('[data-layout-wrapper] canvas, [data-floating-id] canvas, [data-floating-id] img, [data-floating-id] video')){
      if(owned(node)||level(node)>=z||!node.getBoundingClientRect().width||getComputedStyle(node).visibility==='hidden')continue;
      cacheable=false;
      jobs.push({z:level(node),paint:()=>{
        if(node instanceof HTMLImageElement&&(!node.complete||!node.naturalWidth))return;
        if(node instanceof HTMLVideoElement&&node.readyState<2)return;
        for(let n:HTMLElement|null=node.parentElement;n&&n!==host;n=n.parentElement){const style=getComputedStyle(n);if(style.overflow==='hidden'||style.overflow==='clip'){const c=cssMatrix(n);setScreen(c.m);g.beginPath();g.roundRect(0,0,c.w,c.h,Math.min(parseFloat(style.borderRadius)||0,c.w/2,c.h/2));g.clip();}}
        const {m,w,h}=cssMatrix(node);setScreen(m);g.globalAlpha=alpha(node);g.drawImage(node,0,0,w,h);
      }});
    }
    for(const entry of this.entries.values())if(entry.z<z){
      const revision=entry.backdropKey?.();if(revision===undefined)cacheable=false;
      keys.push([token(entry),entry.z,revision,typeof entry.opacity==='function'?entry.opacity():entry.opacity??1]);
      jobs.push({z:entry.z,paint:()=>{g.setTransform(root);g.globalAlpha=typeof entry.opacity==='function'?entry.opacity():entry.opacity??1;entry.paint(g,density);}});
    }
    this.backdropCacheStamp=cacheable?JSON.stringify(keys):undefined;
    const active=this.activePhoto;this.activePhoto=null;this.capturingBackdrop=true;
    try{for(const job of jobs.sort((a,b)=>a.z-b.z)){g.save();try{job.paint();}finally{g.restore();}}}
    finally{this.capturingBackdrop=false;this.activePhoto=active;}
    return canvas;
  }

  private onScroll = () => {
    const viewport = this.viewport;
    // Pinch applies scrollLeft and then synchronously paints the final pose.
    // The browser delivers its scroll event afterwards; repainting that already
    // committed position would render every layer twice for the same gesture.
    if (viewport && (viewport.scrollLeft !== this.paintedScrollLeft
      || viewport.scrollTop !== this.paintedScrollTop)) this.invalidate();
  };

  pageBounds() {
    return this.pageRects;
  }

  pageTransform(index: number) {
    return this.pageMatrices[index];
  }

  paintPhoto(ctx: CanvasRenderingContext2D, photo: PhotoPaint) {
    if (!this.activePhoto) return false;
    this.activePhoto.update(ctx.getTransform(), photo);
    return true;
  }


  attach(host: HTMLElement, viewport: HTMLElement, scale: () => number) {
    this.detach();
    this.host = host;
    this.viewport = viewport;
    this.scale = scale;
    viewport.addEventListener('scroll', this.onScroll, { passive: true });
    // Geometry changes must repaint before the same frame is composited. Queuing
    // another rAF here leaves the old inverse scale visible for one frame.
    host.parentElement?.addEventListener('abai-preview-transform', this.flush);
    this.observer = new ResizeObserver(this.invalidate);
    this.observer.observe(viewport);
    this.invalidate();
    return () => this.detach();
  }

  set(id: string, entry: SceneEntry) {
    this.entries.set(id, entry);
    this.invalidate();
  }

  remove(id: string) {
    this.entries.delete(id);
    this.invalidate();
  }

  invalidate = () => {
    if (!this.frame) this.frame = requestAnimationFrame(this.draw);
  };

  flush = () => {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.draw();
  };

  private detach() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.viewport?.removeEventListener('scroll', this.onScroll);
    this.host?.parentElement?.removeEventListener('abai-preview-transform', this.flush);
    this.observer?.disconnect();
    this.surfaces.forEach(canvas => { disposeBackdropMasks(canvas);canvas.remove(); canvas.width = canvas.height = 1; });
    if(this.backdropSurface){disposeBackdropMasks(this.backdropSurface);this.backdropSurface.width=this.backdropSurface.height=1;this.backdropSurface=null;}
    this.surfaces = [];
    this.photos.forEach(photo => photo.remove()); this.photos.clear();
    this.photoContext = null; this.activePhoto = null;
    this.pageMatrices = [];
    this.pageRects = [];
    this.paintedScrollLeft = this.paintedScrollTop = NaN;
    if (this.alphaSurface) {disposeBackdropMasks(this.alphaSurface);this.alphaSurface.width = this.alphaSurface.height = 1;}
    this.alphaSurface = null;
    this.host = this.viewport = null;
  }

  private draw = () => {
    this.frame = 0;
    const host = this.host, viewport = this.viewport;
    if (!host || !viewport) return;
    const k = Math.max(.0001, this.scale());
    const hr = host.getBoundingClientRect(), vr = viewport.getBoundingClientRect();
    this.paintedScrollLeft = viewport.scrollLeft;
    this.paintedScrollTop = viewport.scrollTop;
    // Snapshot geometry before any photo/SVG/canvas writes. Every object on a
    // page consumes the same pose, avoiding read/write layout thrashing N times
    // per frame during page dragging and settle (including very small shapes).
    const pages = Array.from(host.querySelectorAll<HTMLElement>(':scope > [data-page-id]'));
    this.pageMatrices = pages.map(page => {
      const transform = getComputedStyle(page).transform;
      return new DOMMatrixReadOnly(transform === 'none' ? undefined : transform);
    });
    // Separators use the same pre-paint snapshot as page content. Reading their
    // bounds after updating native SVG photos would force layout during paint.
    this.pageRects = pages.map(page => {
      const rect = page.getBoundingClientRect();
      return { x: (rect.left - hr.left) / k, y: (rect.top - hr.top) / k,
        width: rect.width / k, height: rect.height / k };
    });
    // Keep the same supersampling during gestures, animation and at rest.
    const dpr = Math.max(1, window.devicePixelRatio || 1) * 1.5;
    // Constant screen-sized backing stores, never object-sized textures. A large
    // object therefore does not allocate a huge bitmap or change resolution on up.
    const w = Math.max(1, Math.ceil(vr.width + 64));
    const h = Math.max(1, Math.ceil(vr.height + 64));
    const x = (vr.left - hr.left - 32) / k;
    const y = (vr.top - hr.top - 32) / k;
    const entries = [...this.entries.values()].sort((a, b) => a.z - b.z);
    const photoIds = new Set(entries.map(e => e.nativePhoto).filter(Boolean));
    for (const [id, photo] of this.photos) if (!photoIds.has(id)) { photo.remove(); this.photos.delete(id); }
    const barriers = [...host.children, ...host.querySelectorAll('[data-layout-wrapper]')]
      .filter(node => !(node instanceof HTMLCanvasElement && node.dataset.classicScene))
      .filter(node => !(node as SVGSVGElement).dataset.classicPhoto)
      .filter(node => !(node as HTMLElement).dataset.classicSceneHit)
      .map(node => Number((node as HTMLElement).style.zIndex)).filter(Number.isFinite);
    // Native photographs are stacking barriers, not pixels in a 2D framebuffer.
    barriers.push(...entries.filter(e => e.nativePhoto).map(e => e.z));
    for (const entry of entries) if (entry.nativePhoto) {
      let photo = this.photos.get(entry.nativePhoto);
      if (!photo) { photo = new ClassicPhotoLayer(host); this.photos.set(entry.nativePhoto, photo); }
      photo.root.dataset.classicPhoto = entry.nativePhoto;
      photo.root.style.zIndex = String(entry.z);
      photo.root.style.opacity = String(typeof entry.opacity === 'function' ? entry.opacity() : entry.opacity ?? 1);
      // This 1x1 context is only an affine-transform stack; no image is painted
      // into it. Sorting and motion use exactly the existing scene transforms.
      if (!this.photoContext) {
        const scratch = document.createElement('canvas'); scratch.width = scratch.height = 1;
        this.photoContext = scratch.getContext('2d')!;
      }
      const ctx = this.photoContext; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.activePhoto = photo;
      try { entry.paint(ctx, dpr * k); } finally { this.activePhoto = null; ctx.restore(); }
    }
    const runs: SceneEntry[][] = [];
    for (const entry of entries) {
      if (entry.nativePhoto) continue;
      const run = runs[runs.length - 1];
      if (!run || barriers.some(z => z > run[run.length - 1].z && z <= entry.z)) runs.push([entry]);
      else run.push(entry);
    }
    while (this.surfaces.length > runs.length) {
      const canvas = this.surfaces.pop()!;
      disposeBackdropMasks(canvas);canvas.remove(); canvas.width = canvas.height = 1;
    }
    // Prepare every stacking surface before measuring any of them. Alternating
    // photo/vector layers otherwise force a fresh layout for each surface on
    // every pinch/sort frame, even when the vector itself is only a few pixels.
    const prepared = runs.map((run, i) => {
      let canvas = this.surfaces[i];
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.dataset.classicScene = String(i);
        canvas.style.cssText = 'position:absolute;pointer-events:none;transform-origin:0 0;max-width:none;';
        host.appendChild(canvas);
        this.surfaces[i] = canvas;
      }
      const nativeZoom = !!(host.parentElement?.style as any)?.zoom;
      // Cancel native layout zoom on the framebuffer itself. Repeatedly changing
      // width / k made WebKit round its layout width differently at each pinch
      // step, then resample that framebuffer a second time in the compositor.
      (canvas.style as any).zoom = nativeZoom ? String(1 / k) : '';
      canvas.style.left = '0px';
      canvas.style.top = '0px';
      // Keep CSS layout and backing-store dimensions constant during a pinch.
      // Cancelling the ancestor scale in the same affine transform avoids
      // independently rounded width/k, height/k, left and top layout values.
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.style.transform = nativeZoom ? 'none' : `translate(${x}px, ${y}px) scale(${1 / k})`;
      if (nativeZoom) {
        const origin = canvas.getBoundingClientRect();
        const localToScreen = origin.width / w;
        canvas.style.left = `${(vr.left - 32 - origin.left) / localToScreen}px`;
        canvas.style.top = `${(vr.top - 32 - origin.top) / localToScreen}px`;
      }
      canvas.style.zIndex = String(run[0].z);
      const pw = Math.ceil(w * dpr), ph = Math.ceil(h * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw; canvas.height = ph;
        this.damage.delete(canvas);
      }
      return { run, canvas, pw, ph };
    });
    const measured = prepared.map(surface => ({ ...surface, rect: surface.canvas.getBoundingClientRect() }));
    measured.forEach(({ run, canvas, pw, ph, rect }) => {
      // CSS layout is rounded by WebKit; map the actual surface rectangle back
      // onto scene coordinates instead of assuming requested CSS values stuck.
      const sx = pw / Math.max(.0001, rect.width);
      const sy = ph / Math.max(.0001, rect.height);
      const matrix: [number, number, number, number, number, number] =
        [sx * k, 0, 0, sy * k, (hr.left - rect.left) * sx, (hr.top - rect.top) * sy];
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // Erase the previous ink footprint, not a whole high-density viewport
      // for a handful of tiny rings. Pixel density and vector drawing are
      // unchanged. Unknown/animated painters retain the full-surface fallback.
      const old = this.damage.get(canvas);
      if (old) {
        const left=Math.max(0,old.x),top=Math.max(0,old.y);
        ctx.clearRect(left,top,Math.max(0,Math.min(pw,old.x+old.width)-left),
          Math.max(0,Math.min(ph,old.y+old.height)-top));
      } else ctx.clearRect(0, 0, pw, ph);
      let damage: SceneBounds | null = {x:0,y:0,width:0,height:0};
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.setTransform(...matrix);
      for (const entry of run) {
        const opacity = Math.max(0, Math.min(1,
          typeof entry.opacity === 'function' ? entry.opacity() : entry.opacity ?? 1));
        if (opacity === 0) continue;
        ctx.save();
        if (opacity < 1) {
          damage = null;
          const scratch = this.alphaSurface ?? (this.alphaSurface = document.createElement('canvas'));
          if (scratch.width !== pw) scratch.width = pw;
          if (scratch.height !== ph) scratch.height = ph;
          const sg = scratch.getContext('2d')!;
          sg.setTransform(1, 0, 0, 1, 0, 0); sg.clearRect(0, 0, pw, ph);
          sg.save();
          sg.setTransform(...matrix);
          entry.paint(sg, dpr * k);
          sg.restore();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = opacity;
          ctx.drawImage(scratch, 0, 0);
        } else {
          const bounds = entry.paint(ctx, dpr * k);
          damage = damage && bounds ? unionSceneBounds(damage, bounds) : null;
        }
        ctx.restore();
      }
      this.damage.set(canvas, damage);
    });
    if (entries.some(entry => (typeof entry.animateUntil === 'function'
      ? entry.animateUntil() : entry.animateUntil ?? 0) > performance.now())) this.invalidate();
  };
}
