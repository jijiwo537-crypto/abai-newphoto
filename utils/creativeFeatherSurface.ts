import {get2dWide} from './colorSpace';
import {seamGeometry,seamImageTransform} from './seamlessLayout';
import {regionRects,type PhotoRegion} from './creativePhotoLayout';
import {CreativeViewportFeatherSurface} from './creativeViewportFeatherSurface';

/**
 * 有色彩管理、用實體像素的合成器。互動路線上不允許 WebGL 讀回、解碼照片、編譯著色器或切換解析度；
 * 只重新點陣化來源或裁切有變的那一格
 */
export class CreativeFeatherSurface {
  private targets=new WeakMap<HTMLCanvasElement,number>();
  private serial=0;
  private fallback=new CreativeViewportFeatherSurface();
  private usingFallback=false;
  private scenes=new Map<string,{out:HTMLCanvasElement;cells:{canvas:HTMLCanvasElement;key:string;x:number;y:number;scale:number;image?:HTMLImageElement}[]}>();
  paint(ctx:CanvasRenderingContext2D,region:PhotoRegion,decoded:Map<string,HTMLImageElement>,x:number,y:number,w:number,h:number){
    const m=ctx.getTransform();if(m.b||m.c||m.a<=0||m.d<=0)return false;
    const logicalW=1000,logicalH=Math.round(1000*h/w*1e6)/1e6,ratio=w/logicalW;
    const rects=regionRects(region,logicalW,logicalH);
    const nativeBytes=rects.reduce((bytes,_,i)=>{
      const p=region.photos[i],g=seamGeometry(rects,i,logicalW,logicalH,region.seamlessAmount||0);
      const tr=seamImageTransform({url:p.src,zoom:p.zoom||1,offsetX:p.offsetX||0,offsetY:p.offsetY||0,rotation:0},p.width,p.height,g);
      const density=decoded.has(p.src)?1/tr.scale:1;
      return bytes+4*(Math.ceil(g.ew*density)+2)*(Math.ceil(g.eh*density)+2);
    },0);
    // 大的原圖不能再多做一整組沒有上限的解碼照片。退回原本用實體 viewport 的合成器，不是較低 DPI 的快照；
    // 預覽和存檔照樣取樣同樣的原圖像素
    if(import.meta.env.DEV)ctx.canvas.dataset.featherBytes=String(nativeBytes);
    if(nativeBytes>448*1024*1024){
      if(import.meta.env.DEV)ctx.canvas.dataset.featherMode='viewport';
      if(!this.usingFallback){this.clearNative();this.usingFallback=true;}
      return this.fallback.paint(ctx,region,decoded,x,y,w,h);
    }
    if(this.usingFallback){this.fallback.dispose();this.usingFallback=false;}
    if(import.meta.env.DEV)ctx.canvas.dataset.featherMode='native';
    const left=Math.max(0,Math.floor(x*m.a+m.e)),top=Math.max(0,Math.floor(y*m.d+m.f));
    const right=Math.min(ctx.canvas.width,Math.ceil((x+w)*m.a+m.e)),bottom=Math.min(ctx.canvas.height,Math.ceil((y+h)*m.d+m.f));
    if(right<=left||bottom<=top)return true;
    let id=this.targets.get(ctx.canvas);if(id===undefined){id=++this.serial;this.targets.set(ctx.canvas,id);}
    // 預覽變換改的是座標，不是資源本身。這些暫存依容量級距重用，不要每個縮放畫格配置九張新畫布；
    // 像素座標維持精確，不量化
    const key=[id,(w/h).toFixed(8),region.templateIndex,region.arrangement,region.photos.length].join('|');
    let scene=this.scenes.get(key);
    if(!scene){this.clearNative();scene={out:document.createElement('canvas'),cells:[]};this.scenes.set(key,scene);}
    capacity(scene.out,right-left,bottom-top);
    this.scenes.delete(key);this.scenes.set(key,scene);
    while(this.scenes.size>3){const oldest=this.scenes.keys().next().value!;const old=this.scenes.get(oldest)!;old.out.width=old.out.height=1;old.cells.forEach(c=>c.canvas.width=c.canvas.height=1);this.scenes.delete(oldest);}
    const out=get2dWide(scene.out)!;out.setTransform(1,0,0,1,0,0);out.clearRect(0,0,scene.out.width,scene.out.height);out.globalCompositeOperation='lighter';
    // 在原圖像素空間羽化一次。預覽放大不屬於格子的身分：縮放時取樣這些固定的原圖，
    // 不是每個指標畫格都改大小、重建每個遮罩
    for(let i=0;i<rects.length;i++){
      const p=region.photos[i],g=seamGeometry(rects,i,logicalW,logicalH,region.seamlessAmount||0);
      const image=decoded.get(p.src),cropKey=JSON.stringify([p,g]);
      const l=Math.max(left,Math.floor((x+g.ex*ratio)*m.a+m.e)),t=Math.max(top,Math.floor((y+g.ey*ratio)*m.d+m.f));
      const r=Math.min(right,Math.ceil((x+(g.ex+g.ew)*ratio)*m.a+m.e)),b=Math.min(bottom,Math.ceil((y+(g.ey+g.eh)*ratio)*m.d+m.f));
      if(r<=l||b<=t)continue;
      let cell=scene.cells[i];if(!cell)cell=scene.cells[i]={canvas:document.createElement('canvas'),key:'',x:0,y:0,scale:1};
      if(cell.key!==cropKey||cell.image!==image){
        const tr=seamImageTransform({url:p.src,zoom:p.zoom||1,offsetX:p.offsetX||0,offsetY:p.offsetY||0,rotation:0},p.width,p.height,g);
        const ix=tr.cx+tr.tx-p.width*tr.scale/2,iy=tr.cy+tr.ty-p.height*tr.scale/2;
        // 整數的來源像素原點讓快取的照片是 1:1 的複本，唯一的內插就是跟照片一樣的最後 viewport 取樣
        const density=image?1/tr.scale:1;
        const sx=Math.floor((g.ex-ix)*density),sy=Math.floor((g.ey-iy)*density);
        const dx=ix+sx/density,dy=iy+sy/density;
        const cv=cell.canvas;cv.width=Math.max(1,Math.ceil((g.ex+g.ew-dx)*density));cv.height=Math.max(1,Math.ceil((g.ey+g.eh-dy)*density));
        const c=get2dWide(cv)!;c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,cv.width,cv.height);c.globalCompositeOperation='source-over';
        c.setTransform(density,0,0,density,-dx*density,-dy*density);
        c.save();c.beginPath();c.rect(g.ex,g.ey,g.ew,g.eh);c.clip();c.fillStyle='#121212';c.fillRect(g.ex,g.ey,g.ew,g.eh);
        if(image){c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';c.drawImage(image,ix,iy,p.width*tr.scale,p.height*tr.scale);}
        c.restore();c.globalCompositeOperation='destination-in';
        const gx=c.createLinearGradient(g.ex,0,g.ex+g.ew,0);stops(gx,g.left/g.ew,g.right/g.ew);c.fillStyle=gx;c.fillRect(dx,dy,cv.width/density,cv.height/density);
        const gy=c.createLinearGradient(0,g.ey,0,g.ey+g.eh);stops(gy,g.top/g.eh,g.bottom/g.eh);c.fillStyle=gy;c.fillRect(dx,dy,cv.width/density,cv.height/density);
        cell.key=cropKey;cell.x=dx;cell.y=dy;cell.scale=1/density;cell.image=image;
        if(import.meta.env.DEV)ctx.canvas.dataset.featherBuilds=String(Number(ctx.canvas.dataset.featherBuilds||0)+1);
      }
      out.save();out.setTransform(m.a*ratio,0,0,m.d*ratio,x*m.a+m.e-left,y*m.d+m.f-top);
      out.beginPath();out.rect(g.ex,g.ey,g.ew,g.eh);out.clip();out.imageSmoothingEnabled=true;out.imageSmoothingQuality='high';
      out.drawImage(cell.canvas,cell.x,cell.y,cell.canvas.width*cell.scale,cell.canvas.height*cell.scale);out.restore();
    }
    // 只補互補 alpha 漸層取整後不到一個位元組的殘差。這留在畫布合成器上做，不同步讀回 CPU 像素
    out.globalCompositeOperation='destination-over';out.fillStyle='#121212';out.fillRect(0,0,scene.out.width,scene.out.height);out.globalCompositeOperation='source-over';
    ctx.drawImage(scene.out,0,0,right-left,bottom-top,(left-m.e)/m.a,(top-m.f)/m.d,(right-left)/m.a,(bottom-top)/m.d);
    const bytes=(s:typeof scene)=>4*(s.out.width*s.out.height+s.cells.reduce((n,c)=>n+c.canvas.width*c.canvas.height,0));
    let resident=[...this.scenes.values()].reduce((n,s)=>n+bytes(s),0);
    for(const [id,s] of this.scenes){if(resident<=448*1024*1024)break;if(s===scene)continue;resident-=bytes(s);s.out.width=s.out.height=1;s.cells.forEach(c=>c.canvas.width=c.canvas.height=1);this.scenes.delete(id);}
    return true;
  }
  private clearNative(){for(const s of this.scenes.values()){s.out.width=s.out.height=1;s.cells.forEach(c=>c.canvas.width=c.canvas.height=1);}this.scenes.clear();}
  dispose(){this.clearNative();this.fallback.dispose();this.usingFallback=false;}
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
