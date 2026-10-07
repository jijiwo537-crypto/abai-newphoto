import {drawSeamPreview,disposeSeamPreview,copySeamPreviewPixels,type SeamView} from './seamlessPreview';
import {get2dWide} from './colorSpace';
import {scenePixelEdge} from './scenePixelGrid';
import {regionRects,seamlessPhotoBase,paintPhotoRegion,type PhotoRegion} from './creativePhotoLayout';
import {CreativeFeatherSurface} from './creativeFeatherSurface';
const isWebKit=()=>/AppleWebKit/.test(navigator.userAgent)&&(!/Chrome\//.test(navigator.userAgent)||/iPhone|iPad|iPod/.test(navigator.userAgent));
/** One GPU surface per editor. Render just the visible physical-pixel viewport,
 * not an enormous zoomed composite. Source photos keep their original quality. */
export class CreativeSeamless {
  private surface:HTMLCanvasElement|null=null;
  private colorTile:HTMLCanvasElement|null=null;
  private presentation:HTMLCanvasElement|null=null;
  private interactive=new CreativeFeatherSurface();
  warm(region:PhotoRegion,decoded:Map<string,HTMLImageElement>){
    const base=seamlessPhotoBase(region);if(!base||this.presentation?.style.display==='block')return;
    const surface=this.presentation||(this.presentation=document.createElement('canvas'));
    surface.width=surface.height=1;
    drawSeamPreview(surface,base.photos.map(p=>({url:p.src,zoom:p.zoom||1,offsetX:p.offsetX||0,offsetY:p.offsetY||0,rotation:0})),regionRects(base,1000,1000),
      base.photos.map(p=>{const image=decoded.get(p.src);return image?{image,width:p.width,height:p.height}:null;}),0,{width:1000,height:1000,xx:1000,xy:0,x0:0,yx:0,yy:1000,y0:0},true);
    surface.style.display='none';
  }
  /** Resolve resident original photos INTO the main scene before the mask.
   * Never ask the DOM compositor to filter two complementary alpha layers.
   * Source uploads remain cached; there is no scene upload or CPU readback. */
  present(ctx:CanvasRenderingContext2D,region:PhotoRegion,decoded:Map<string,HTMLImageElement>,x:number,y:number,w:number,h:number,page:number[],viewport=[ctx.canvas.width,ctx.canvas.height]){
    const base=seamlessPhotoBase(region);if(!base||base.photos.some(p=>!p.src||!decoded.has(p.src)))return false;
    const m=ctx.getTransform();if(m.b||m.c||m.a<=0||m.d<=0)return false;
    if(this.presentation?.dataset.sourceUploads&&this.presentation.getContext('webgl2')?.isContextLost()){
      disposeSeamPreview(this.presentation);this.presentation.remove();this.presentation.width=this.presentation.height=1;this.presentation=null;
    }
    const surface=this.presentation||(this.presentation=document.createElement('canvas'));
    const main=ctx.canvas;
    // Main is already a bounded viewport (with reusable pinch capacity), not
    // a giant zoomed page. Use its IDENTICAL backing size and CSS rectangle.
    // A second crop/DOM measurement gives the two canvases different CSS
    // rounding and bilinear sample phases, even if logical edges agree.
    const l=0,t=0,W=main.width,H=main.height;
    if(surface.width!==W)surface.width=W;if(surface.height!==H)surface.height=H;
    const sources=base.photos.map(p=>{const image=decoded.get(p.src);return image?{image,width:p.width,height:p.height}:null;});
    const left=Math.max(0,page[0],x*m.a+m.e),top=Math.max(0,page[1],y*m.d+m.f);
    const right=Math.min(viewport[0],page[0]+page[2],(x+w)*m.a+m.e),bottom=Math.min(viewport[1],page[1]+page[3],(y+h)*m.d+m.f);
    // Keep identical physical-pixel sampling within the bounded editor raster,
    // including the main canvas's reusable pinch capacity.
    // Photo texels continue under the opaque mask's filter footprint, while
    // its exact half-open clip remains authoritative. No source crop changes.
    const view:SeamView={width:w,height:h,xx:W/m.a,xy:0,x0:(l-m.e)/m.a-x,yx:0,yy:H/m.d,y0:(t-m.f)/m.d-y,clip:[(left-l)/W,(top-t)/H,(right-l)/W,(bottom-t)/H],clipGuard:[2/W,2/H]};
    drawSeamPreview(surface,base.photos.map(p=>({url:p.src,zoom:p.zoom||1,offsetX:p.offsetX||0,offsetY:p.offsetY||0,rotation:0})),regionRects(base,w,h),sources,region.seamless?(region.seamlessAmount||0):-1,view,true);
    // The GPU buffer is private, not an independently scaled DOM layer.
    // Copy in the same task before its transient framebuffer is discarded.
    surface.remove();surface.style.display='none';
    main.dataset.creativePhotoComposition='single-canvas';
    const clearLeft=scenePixelEdge(left),clearTop=scenePixelEdge(top);
    const clearRight=scenePixelEdge(right),clearBottom=scenePixelEdge(bottom);
    ctx.save();ctx.setTransform(1,0,0,1,0,0);
    ctx.beginPath();ctx.rect(clearLeft,clearTop,Math.max(0,clearRight-clearLeft),Math.max(0,clearBottom-clearTop));ctx.clip();
    // WebKit applies a second colour conversion when drawing a Display-P3
    // WebGL canvas into 2D: already-P3 bytes are treated as sRGB and then
    // converted again, visibly washing out every seamless photo. Copy its
    // tagged raw pixels instead, exactly as the tiled path below does.
    let image:HTMLCanvasElement=surface;
    if(isWebKit()){
      const tile=this.colorTile||(this.colorTile=document.createElement('canvas'));
      if(tile.width!==W)tile.width=W;if(tile.height!==H)tile.height=H;
      copySeamPreviewPixels(surface,get2dWide(tile)!);image=tile;
    }
    ctx.drawImage(image,0,0);ctx.restore();return true;
  }
  beginFrame(){}
  flush(){}
  hide(){if(this.presentation){this.presentation.style.display='none';this.presentation.remove();}}
  get shown(){return false;}
  paint(ctx:CanvasRenderingContext2D,region:PhotoRegion,decoded:Map<string,HTMLImageElement>,x:number,y:number,w:number,h:number,dim=-1,preview=false){
    if(!region.seamless||region.photos.length<2)return false;
    const base=seamlessPhotoBase(region);if(!base)return false;
    const rects=regionRects(base,w,h);
    const overlays=base===region?[]:region.photos.slice(2).map((_,i)=>i+2);
    const m=ctx.getTransform();if(m.b||m.c||m.a<=0||m.d<=0)return false;
    if(preview){
      if(ctx.globalCompositeOperation==='copy'){ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);ctx.restore();}
      ctx.save();ctx.globalCompositeOperation='source-over';ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();
      try{const done=this.interactive.paint(ctx,base,decoded,x,y,w,h);
        if(done&&dim>=0&&dim<rects.length){const r=rects[dim];ctx.fillStyle='rgba(0,0,0,.65)';ctx.fillRect(x+r.x*w,y+r.y*h,r.w*w,r.h*h);}
        if(done&&overlays.length)paintPhotoRegion(ctx,region,decoded,x,y,w,h,dim,overlays);return done;
      }finally{ctx.restore();}
    }
    const left=Math.max(0,Math.floor(x*m.a+m.e)),top=Math.max(0,Math.floor(y*m.d+m.f));
    const right=Math.min(ctx.canvas.width,Math.ceil((x+w)*m.a+m.e)),bottom=Math.min(ctx.canvas.height,Math.ceil((y+h)*m.d+m.f));
    if(right<=left||bottom<=top)return true;
    // An evicted context never returns on the same element (iOS); start over.
    if(this.surface?.getContext('webgl2')?.isContextLost()){disposeSeamPreview(this.surface);this.surface.width=this.surface.height=1;this.surface=null;}
    const surface=this.surface||(this.surface=document.createElement('canvas'));
    const photos=base.photos.map(p=>({url:p.src,zoom:p.zoom||1,offsetX:p.offsetX||0,offsetY:p.offsetY||0,rotation:0}));
    const sources=base.photos.map(p=>{const image=decoded.get(p.src);return image?{image,width:p.width,height:p.height}:null;});
    // Tiles also bound full-resolution exports; every tile samples original
    // coordinates and the exact same feather weights as interactive preview.
    if(ctx.globalCompositeOperation==='copy'){
      ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);ctx.restore();
    }
    ctx.save();ctx.globalCompositeOperation='source-over';ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();
    try{
      for(let py=top;py<bottom;py+=1024)for(let px=left;px<right;px+=1024){
        const tw=Math.min(1024,right-px),th=Math.min(1024,bottom-py);
        if(surface.width!==tw)surface.width=tw;if(surface.height!==th)surface.height=th;
        drawSeamPreview(surface,photos,rects,sources,region.seamlessAmount||0,{width:w,height:h,
          xx:surface.width/m.a,xy:0,x0:(px-m.e)/m.a-x,yx:0,yy:surface.height/m.d,y0:(py-m.f)/m.d-y});
        let image=surface;
        if(isWebKit()){
          const tile=this.colorTile||(this.colorTile=document.createElement('canvas'));
          if(tile.width!==tw)tile.width=tw;if(tile.height!==th)tile.height=th;
          copySeamPreviewPixels(surface,get2dWide(tile)!);image=tile;
        }
        ctx.drawImage(image,(px-m.e)/m.a,(py-m.f)/m.d,surface.width/m.a,surface.height/m.d);
      }
      if(dim>=0&&dim<rects.length){const r=rects[dim];ctx.fillStyle='rgba(0,0,0,.65)';ctx.fillRect(x+r.x*w,y+r.y*h,r.w*w,r.h*h);}
      if(overlays.length)paintPhotoRegion(ctx,region,decoded,x,y,w,h,dim,overlays);
      return true;
    }finally{ctx.restore();}
  }
  dispose(){this.hide();this.interactive.dispose();if(this.presentation){disposeSeamPreview(this.presentation);this.presentation.remove();this.presentation.width=this.presentation.height=1;this.presentation=null;}if(this.surface){disposeSeamPreview(this.surface);this.surface.width=this.surface.height=1;this.surface=null;}if(this.colorTile){this.colorTile.width=this.colorTile.height=1;this.colorTile=null;}}
}
