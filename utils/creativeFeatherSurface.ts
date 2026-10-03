import {get2dWide} from './colorSpace';
import {seamGeometry,seamImageTransform} from './seamlessLayout';
import {regionRects,type PhotoRegion} from './creativePhotoLayout';

/** Color-managed, physical-pixel compositor. No WebGL readback, photo decode,
 * shader compile or resolution switch is allowed on the interactive path.
 * Only the cell whose source/crop changed is rerasterized. */
export class CreativeFeatherSurface {
  private targets=new WeakMap<HTMLCanvasElement,number>();
  private serial=0;
  private scenes=new Map<string,{out:HTMLCanvasElement;cells:{canvas:HTMLCanvasElement;key:string;x:number;y:number;image?:HTMLImageElement}[]}>();
  paint(ctx:CanvasRenderingContext2D,region:PhotoRegion,decoded:Map<string,HTMLImageElement>,x:number,y:number,w:number,h:number){
    const m=ctx.getTransform();if(m.b||m.c||m.a<=0||m.d<=0)return false;
    const left=Math.max(0,Math.floor(x*m.a+m.e)),top=Math.max(0,Math.floor(y*m.d+m.f));
    const right=Math.min(ctx.canvas.width,Math.ceil((x+w)*m.a+m.e)),bottom=Math.min(ctx.canvas.height,Math.ceil((y+h)*m.d+m.f));
    if(right<=left||bottom<=top)return true;
    let id=this.targets.get(ctx.canvas);if(id===undefined){id=++this.serial;this.targets.set(ctx.canvas,id);}
    // A preview transform changes coordinates, not resource identity. Reuse
    // these backing stores in capacity buckets instead of allocating nine new
    // canvases per pinch frame. Pixel coordinates remain exact, never quantized.
    const key=[id,(x/w).toFixed(8),(y/h).toFixed(8),(w/h).toFixed(8),region.templateIndex,region.arrangement,region.photos.length].join('|');
    let scene=this.scenes.get(key);
    if(!scene){scene={out:document.createElement('canvas'),cells:[]};this.scenes.set(key,scene);}
    capacity(scene.out,right-left,bottom-top);
    this.scenes.delete(key);this.scenes.set(key,scene);
    while(this.scenes.size>3){const oldest=this.scenes.keys().next().value!;const old=this.scenes.get(oldest)!;old.out.width=old.out.height=1;old.cells.forEach(c=>c.canvas.width=c.canvas.height=1);this.scenes.delete(oldest);}
    const out=get2dWide(scene.out)!;out.setTransform(1,0,0,1,0,0);out.clearRect(0,0,scene.out.width,scene.out.height);out.globalCompositeOperation='lighter';
    const rects=regionRects(region,w,h);
    for(let i=0;i<rects.length;i++){
      const p=region.photos[i],g=seamGeometry(rects,i,w,h,region.seamlessAmount||0);
      const image=decoded.get(p.src),cropKey=JSON.stringify([p,g,x,y,m.a,m.d,m.e,m.f,left,top,right,bottom]);
      const l=Math.max(left,Math.floor((x+g.ex)*m.a+m.e)),t=Math.max(top,Math.floor((y+g.ey)*m.d+m.f));
      const r=Math.min(right,Math.ceil((x+g.ex+g.ew)*m.a+m.e)),b=Math.min(bottom,Math.ceil((y+g.ey+g.eh)*m.d+m.f));
      if(r<=l||b<=t)continue;
      let cell=scene.cells[i];if(!cell)cell=scene.cells[i]={canvas:document.createElement('canvas'),key:'',x:l,y:t};
      if(cell.key!==cropKey||cell.image!==image){
        const cv=cell.canvas;capacity(cv,r-l,b-t);
        const c=get2dWide(cv)!;c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,cv.width,cv.height);c.globalCompositeOperation='source-over';
        c.setTransform(m.a,0,0,m.d,(x*m.a+m.e)-l,(y*m.d+m.f)-t);
        c.save();c.beginPath();c.rect(g.ex,g.ey,g.ew,g.eh);c.clip();c.fillStyle='#121212';c.fillRect(g.ex,g.ey,g.ew,g.eh);
        if(image){const tr=seamImageTransform({url:p.src,zoom:p.zoom||1,offsetX:p.offsetX||0,offsetY:p.offsetY||0,rotation:0},p.width,p.height,g);
          c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';c.drawImage(image,tr.cx+tr.tx-p.width*tr.scale/2,tr.cy+tr.ty-p.height*tr.scale/2,p.width*tr.scale,p.height*tr.scale);}
        c.restore();c.globalCompositeOperation='destination-in';
        const gx=c.createLinearGradient(g.ex,0,g.ex+g.ew,0);stops(gx,g.left/g.ew,g.right/g.ew);c.fillStyle=gx;c.fillRect((l-m.e)/m.a-x,(t-m.f)/m.d-y,cv.width/m.a,cv.height/m.d);
        const gy=c.createLinearGradient(0,g.ey,0,g.ey+g.eh);stops(gy,g.top/g.eh,g.bottom/g.eh);c.fillStyle=gy;c.fillRect((l-m.e)/m.a-x,(t-m.f)/m.d-y,cv.width/m.a,cv.height/m.d);
        cell.key=cropKey;cell.x=l;cell.y=t;cell.image=image;
      }
      out.drawImage(cell.canvas,0,0,r-l,b-t,cell.x-left,cell.y-top,r-l,b-t);
    }
    // Fill only the sub-byte rounding residue of complementary alpha ramps.
    // This stays on the canvas compositor; no synchronous CPU pixel readback.
    out.globalCompositeOperation='destination-over';out.fillStyle='#121212';out.fillRect(0,0,scene.out.width,scene.out.height);out.globalCompositeOperation='source-over';
    ctx.drawImage(scene.out,0,0,right-left,bottom-top,(left-m.e)/m.a,(top-m.f)/m.d,(right-left)/m.a,(bottom-top)/m.d);
    const bytes=(s:typeof scene)=>4*(s.out.width*s.out.height+s.cells.reduce((n,c)=>n+c.canvas.width*c.canvas.height,0));
    let resident=[...this.scenes.values()].reduce((n,s)=>n+bytes(s),0);
    for(const [id,s] of this.scenes){if(resident<=64*1024*1024)break;if(s===scene)continue;resident-=bytes(s);s.out.width=s.out.height=1;s.cells.forEach(c=>c.canvas.width=c.canvas.height=1);this.scenes.delete(id);}
    return true;
  }
  dispose(){for(const s of this.scenes.values()){s.out.width=s.out.height=1;s.cells.forEach(c=>c.canvas.width=c.canvas.height=1);}this.scenes.clear();}
}
function capacity(canvas:HTMLCanvasElement,w:number,h:number){
  if(canvas.width<w||canvas.width>Math.max(256,w*2))canvas.width=Math.ceil(w/128)*128;
  if(canvas.height<h||canvas.height>Math.max(256,h*2))canvas.height=Math.ceil(h/128)*128;
}
function stops(g:CanvasGradient,start:number,end:number){
  g.addColorStop(0,start?'rgba(255,255,255,0)':'#fff');
  if(start)for(let n=1;n<=64;n++){const t=n/64;g.addColorStop(2*start*t,`rgba(255,255,255,${t*t*(3-2*t)})`);}
  if(end)for(let n=0;n<64;n++){const t=n/64;g.addColorStop(1-2*end+2*end*t,`rgba(255,255,255,${1-t*t*(3-2*t)})`);}
  g.addColorStop(1,end?'rgba(255,255,255,0)':'#fff');
}
