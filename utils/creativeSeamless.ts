import {drawSeamPreview,disposeSeamPreview,copySeamPreviewPixels,type SeamView} from './seamlessPreview';
import {get2dWide} from './colorSpace';
import {regionRects,seamlessPhotoBase,paintPhotoRegion,type PhotoRegion} from './creativePhotoLayout';
import {CreativeFeatherSurface} from './creativeFeatherSurface';
/** One GPU surface per editor. Render just the visible physical-pixel viewport,
 * not an enormous zoomed composite. Source photos keep their original quality. */
export class CreativeSeamless {
  private surface:HTMLCanvasElement|null=null;
  private colorTile:HTMLCanvasElement|null=null;
  private presentation:HTMLCanvasElement|null=null;
  private firstView:SeamView|null=null;
  private pendingPresentation:(()=>void)|null=null;
  private interactive=new CreativeFeatherSurface();
  warm(region:PhotoRegion,decoded:Map<string,HTMLImageElement>){
    const base=seamlessPhotoBase(region);if(!base||this.presentation?.style.display==='block')return;
    const surface=this.presentation||(this.presentation=document.createElement('canvas'));
    surface.width=surface.height=1;
    drawSeamPreview(surface,base.photos.map(p=>({url:p.src,zoom:p.zoom||1,offsetX:p.offsetX||0,offsetY:p.offsetY||0,rotation:0})),regionRects(base,1000,1000),
      base.photos.map(p=>{const image=decoded.get(p.src);return image?{image,width:p.width,height:p.height}:null;}),0,{width:1000,height:1000,xx:1000,xy:0,x0:0,yx:0,yy:1000,y0:0},true);
    surface.style.display='none';
  }
  /** Display the original-texture compositor beneath the transparent photo
   * window. Main-canvas vector objects and selection chrome remain above it.
   * This avoids WebKit's synchronous GPU-to-2D readback on every seam input. */
  present(ctx:CanvasRenderingContext2D,region:PhotoRegion,decoded:Map<string,HTMLImageElement>,x:number,y:number,w:number,h:number,page:number[]){
    const base=seamlessPhotoBase(region);if(!base||base.photos.some(p=>!p.src||!decoded.has(p.src)))return false;
    const m=ctx.getTransform();if(m.b||m.c||m.a<=0||m.d<=0)return false;
    if(this.presentation?.dataset.sourceUploads&&this.presentation.getContext('webgl2')?.isContextLost()){
      disposeSeamPreview(this.presentation);this.presentation.remove();this.presentation.width=this.presentation.height=1;this.presentation=null;
    }
    const surface=this.presentation||(this.presentation=document.createElement('canvas'));
    const main=ctx.canvas;
    const visible=main.closest('[data-creative-stage]')?.getBoundingClientRect(),box=main.getBoundingClientRect();
    const sx=box.width?main.width/box.width:1,sy=box.height?main.height/box.height:1;
    // Include the filter footprint at the surface's outer edge too. Extending
    // only the shader clip cannot protect an edge where the texture ends.
    const l=visible?Math.max(-1,Math.floor((visible.left-box.left)*sx)-1):-1,t=visible?Math.max(-1,Math.floor((visible.top-box.top)*sy)-1):-1;
    const r=visible?Math.min(main.width+1,Math.ceil((visible.right-box.left)*sx)+1):main.width+1,b=visible?Math.min(main.height+1,Math.ceil((visible.bottom-box.top)*sy)+1):main.height+1;
    const W=Math.max(1,r-l),H=Math.max(1,b-t);
    if(surface.width!==W)surface.width=W;if(surface.height!==H)surface.height=H;
    const sources=base.photos.map(p=>{const image=decoded.get(p.src);return image?{image,width:p.width,height:p.height}:null;});
    const left=Math.max(0,page[0],x*m.a+m.e),top=Math.max(0,page[1],y*m.d+m.f);
    const right=Math.min(main.width,page[0]+page[2],(x+w)*m.a+m.e),bottom=Math.min(main.height,page[1]+page[3],(y+h)*m.d+m.f);
    // Keep identical physical-pixel sampling, but allocate only pixels visible
    // in the editor. A retained pinch capacity must not enlarge this GPU plane.
    // The DOM compositor can interpolate a transparent neighbour even when
    // every interior framebuffer pixel is filled. Retain one physical texel
    // of edge colour under the mask to cover that interpolation footprint.
    const view:SeamView={width:w,height:h,xx:W/m.a,xy:0,x0:(l-m.e)/m.a-x,yx:0,yy:H/m.d,y0:(t-m.f)/m.d-y,clip:[(left-l)/W,(top-t)/H,(right-l)/W,(bottom-t)/H],clipGuard:[1/W,1/H]};
    const first=this.firstView;if(!first)this.firstView=view;
    // A split canvas draws the same photos twice (image and mask window).
    // Submit the combined two-window shader once, after both placements have
    // been collected, instead of shading the entire viewport twice per frame.
    this.pendingPresentation=()=>drawSeamPreview(surface,base.photos.map(p=>({url:p.src,zoom:p.zoom||1,offsetX:p.offsetX||0,offsetY:p.offsetY||0,rotation:0})),regionRects(base,w,h),sources,region.seamless?(region.seamlessAmount||0):-1,first?{...first,other:{...view,clip:view.clip!}}:view,true);
    const parent=main.parentElement?.getBoundingClientRect();
    Object.assign(surface.style,{position:'absolute',left:`${box.left-(parent?.left||box.left)+l/sx}px`,top:`${box.top-(parent?.top||box.top)+t/sy}px`,width:`${W/sx}px`,height:`${H/sy}px`,zIndex:'0',pointerEvents:'none',display:'block'});
    surface.dataset.presentationX=String(l);surface.dataset.presentationY=String(t);
    surface.dataset.creativeSeamPresentation='1';if(surface.parentElement!==main.parentElement)main.parentElement?.prepend(surface);
    // Remove opaque main-canvas pixels at exactly the same pixel centres as
    // the shader's photo window. Fractional clearRect/clip edges otherwise
    // leave a varying alpha fringe above an already-filled GPU photograph.
    const clearLeft=Math.ceil(left-.5),clearTop=Math.ceil(top-.5);
    const clearRight=Math.ceil(right-.5),clearBottom=Math.ceil(bottom-.5);
    ctx.save();ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(clearLeft,clearTop,Math.max(0,clearRight-clearLeft),Math.max(0,clearBottom-clearTop));ctx.restore();return true;
  }
  beginFrame(){this.firstView=null;this.pendingPresentation=null;}
  flush(){const draw=this.pendingPresentation;this.pendingPresentation=null;if(draw)draw();else this.hide();}
  hide(){this.firstView=null;this.pendingPresentation=null;if(this.presentation)this.presentation.style.display='none';}
  get shown(){return this.presentation?.style.display==='block';}
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
        if(/AppleWebKit/.test(navigator.userAgent)&&(!/Chrome\//.test(navigator.userAgent)||/iPhone|iPad|iPod/.test(navigator.userAgent))){
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
  dispose(){this.interactive.dispose();if(this.presentation){disposeSeamPreview(this.presentation);this.presentation.remove();this.presentation.width=this.presentation.height=1;this.presentation=null;}if(this.surface){disposeSeamPreview(this.surface);this.surface.width=this.surface.height=1;this.surface=null;}if(this.colorTile){this.colorTile.width=this.colorTile.height=1;this.colorTile=null;}}
}
