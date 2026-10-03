import {drawSeamPreview,disposeSeamPreview,copySeamPreviewPixels} from './seamlessPreview';
import {get2dWide} from './colorSpace';
import {regionRects,type PhotoRegion} from './creativePhotoLayout';
/** One GPU surface per editor. Render just the visible physical-pixel viewport,
 * not an enormous zoomed composite. Source photos keep their original quality. */
export class CreativeSeamless {
  private surface:HTMLCanvasElement|null=null;
  private colorTile:HTMLCanvasElement|null=null;
  paint(ctx:CanvasRenderingContext2D,region:PhotoRegion,decoded:Map<string,HTMLImageElement>,x:number,y:number,w:number,h:number,dim=-1){
    if(!region.seamless||region.photos.length<2)return false;
    const rects=regionRects(region,w,h);
    if(Math.abs(rects.reduce((a,r)=>a+r.w*r.h,0)-1)>1e-5)return false;
    const m=ctx.getTransform();if(m.b||m.c||m.a<=0||m.d<=0)return false;
    const left=Math.max(0,Math.floor(x*m.a+m.e)),top=Math.max(0,Math.floor(y*m.d+m.f));
    const right=Math.min(ctx.canvas.width,Math.ceil((x+w)*m.a+m.e)),bottom=Math.min(ctx.canvas.height,Math.ceil((y+h)*m.d+m.f));
    if(right<=left||bottom<=top)return true;
    const surface=this.surface||(this.surface=document.createElement('canvas'));
    const photos=region.photos.map(p=>({url:p.src,zoom:p.zoom||1,offsetX:p.offsetX||0,offsetY:p.offsetY||0,rotation:0}));
    const sources=region.photos.map(p=>{const image=decoded.get(p.src);return image?{image,width:p.width,height:p.height}:null;});
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
      if(dim>=0){const r=rects[dim];ctx.fillStyle='rgba(0,0,0,.65)';ctx.fillRect(x+r.x*w,y+r.y*h,r.w*w,r.h*h);}
      return true;
    }finally{ctx.restore();}
  }
  dispose(){if(this.surface){disposeSeamPreview(this.surface);this.surface.width=this.surface.height=1;this.surface=null;}if(this.colorTile){this.colorTile.width=this.colorTile.height=1;this.colorTile=null;}}
}
