export type SceneWindow={x:number;y:number;w:number;h:number};
/**
 * x/y/w/h：繪製的範圍。show：顯示的部分，也就是核心加上過濾用的保護邊。每個圖塊四邊都比這個多畫 `reach`，
 * 因為有些圖層（背景遮罩：馬賽克、玻璃磚折射、毛玻璃模糊）會取樣每個像素「周圍」的場景；沒有這圈邊的話，
 * 它們讀到的是被夾住的圖塊邊緣，在每條接縫附近都會跟即時繪製不一樣
 */
type Tile=SceneWindow&{canvas:HTMLCanvasElement;show:SceneWindow};
/** 邊比這個大的話，還不如直接即時畫場景 */
export const SCENE_TILE_MAX_REACH=384;
/** 整組磚塊最多幾個像素（4 bytes/px ⇒ 12M ≈ 48MB）。 */
export const SCENE_TILE_MAX_PIXELS=12_000_000;
/**
 * 只有一套固定的點陣座標。圖塊含過濾保護邊；它們只是儲存的分區，絕不是各自變換的場景物件
 */
export class StableSceneTiles {
  key='';scale=1;width=0;height=0;status='empty';
  private tiles:Tile[]=[];private generation=0;
  /* 場景準備被打斷時（任何觸控都會取消）已經畫好的圖塊。同一個場景會從這些接著做，不必全部重畫，
     有慢圖層（背景遮罩）的場景也能在兩次手勢之間準備好。場景、大小或密度一變就丟掉 */
  private partial:{key:string;width:number;height:number;scale:number;tiles:Map<string,Tile>}|null=null;
  private dropPartial(){if(!this.partial)return;for(const t of this.partial.tiles.values())t.canvas.width=t.canvas.height=1;this.partial=null;}
  dispose(){this.generation++;for(const t of this.tiles)t.canvas.width=t.canvas.height=1;this.tiles=[];this.key='';this.dropPartial();}
  async prepare(key:string,width:number,height:number,scale:number,paint:(c:HTMLCanvasElement,v:SceneWindow)=>void,valid:()=>boolean,reach=0){
    this.generation++;for(const t of this.tiles)t.canvas.width=t.canvas.height=1;this.tiles=[];this.key='';
    const generation=this.generation;this.status='preparing';
    if(this.partial&&(this.partial.key!==key||this.partial.width!==width||this.partial.height!==height||this.partial.scale!==scale))this.dropPartial();
    const extra=Math.ceil(Math.max(0,reach));
    if(!(extra<=SCENE_TILE_MAX_REACH)){this.dropPartial();this.status='sampling reach';return false;}
    // 跟瀏覽器或 App 的記憶體無關：場景太大就直接不做，不降低密度，也不配置沒有上限的背景快取
    /* 上限不用 256MB：預覽靜止時這組磚塊在 iPhone 上就會吃掉一百多 MB，再加上解碼的原圖、
       GPU 畫面，分頁很容易被系統砍掉重開。磚塊只是「靜止時的快取」，呼叫端已經把解析度
       壓在 SCENE_TILE_MAX_PIXELS 以內；這裡留一個同量級的保險。 */
    const budget=SCENE_TILE_MAX_PIXELS*4*1.25;
    if(!Number.isFinite(width*height)||width<=0||height<=0||width*height*4>budget){this.dropPartial();this.status='size budget';return false;}
    const partial=this.partial??={key,width,height,scale,tiles:new Map()};
    const done=partial.tiles,ordered:Tile[]=[];
    let bytes=0;const guard=16;
    try{
      for(let y=0;y<height;y+=768)for(let x=0;x<width;x+=768){
        const id=x+','+y,existing=done.get(id);
        if(existing){ordered.push(existing);bytes+=existing.w*existing.h*4;continue;}
        await new Promise<void>(r=>requestAnimationFrame(()=>r()));
        // 被打斷：保留做好的圖塊，下次做這個場景時接著用
        if(generation!==this.generation||!valid()){if(generation===this.generation)this.status='cancelled';return false;}
        const sl=x-guard,st=y-guard,sr=Math.min(width,x+768)+guard,sb=Math.min(height,y+768)+guard;
        const left=sl-extra,top=st-extra,right=sr+extra,bottom=sb+extra;
        const tile={x:left,y:top,w:right-left,h:bottom-top,canvas:document.createElement('canvas'),show:{x:sl,y:st,w:sr-sl,h:sb-st}};
        bytes+=tile.w*tile.h*4;if(bytes>budget){tile.canvas.width=tile.canvas.height=1;this.dropPartial();this.status='tile budget';return false;}
        paint(tile.canvas,tile);
        if(tile.canvas.width!==tile.w||tile.canvas.height!==tile.h){tile.canvas.width=tile.canvas.height=1;throw Error('scene tile mapping mismatch');}
        // 頁面邊界是裁切，不是透明的貼圖邊界。把最後一個取樣延伸到過濾保護邊裡：
        // 雙線性、雙三次縮小時不能把頁面跟外面的透明像素混在一起
        const g=tile.canvas.getContext('2d');
        if(g){g.save();g.setTransform(1,0,0,1,0,0);g.globalAlpha=1;g.globalCompositeOperation='source-over';g.imageSmoothingEnabled=false;
          const pl=-left,pt=-top,pr=width-left,pb=height-top;
          if(x===0)g.drawImage(tile.canvas,pl,0,1,tile.h,0,0,pl,tile.h);
          if(y===0)g.drawImage(tile.canvas,0,pt,tile.w,1,0,0,tile.w,pt);
          if(right>width)g.drawImage(tile.canvas,pr-1,0,1,tile.h,pr,0,tile.w-pr,tile.h);
          if(bottom>height)g.drawImage(tile.canvas,0,pb-1,tile.w,1,0,pb,tile.w,tile.h-pb);
          g.restore();
        }
        done.set(id,tile);ordered.push(tile);
      }
      if(generation!==this.generation||!valid()){if(generation===this.generation)this.status='cancelled';return false;}
      this.partial=null;this.tiles=ordered;this.key=key;this.width=width;this.height=height;this.scale=scale;this.status='ready';return true;
    }catch(e){this.dropPartial();this.status=String(e);return false;}
  }
  /** 照目前的畫布矩陣，磚塊的解析度夠不夠（不用放大就畫得出來）。不夠就該畫即時的，不要糊。 */
  sharpFor(ctx:CanvasRenderingContext2D,width:number,height:number){
    if(!this.tiles.length)return false;
    const m=ctx.getTransform(),kx=width/this.width,ky=height/this.height;
    const a=m.a??1,b=m.b??0,c=m.c??0,d=m.d??1;
    return Math.hypot(a,b)*kx<=1.001&&Math.hypot(c,d)*ky<=1.001;
  }
  paint(ctx:CanvasRenderingContext2D,key:string,width:number,height:number){
    if(this.key!==key||!this.tiles.length||!this.sharpFor(ctx,width,height))return false;
    const kx=width/this.width,ky=height/this.height,m=ctx.getTransform();ctx.save();ctx.scale(kx,ky);
    // 所有圖塊用同一個上層矩陣和有保護邊的原始取樣。頁面內的場景是不透明的，所以重疊的地方不會疊加 alpha
    const inverse=m.inverse();const a=new DOMPoint(0,0).matrixTransform(inverse),b=new DOMPoint(ctx.canvas.width,ctx.canvas.height).matrixTransform(inverse);
    for(const t of this.tiles){const v=t.show;if(v.x*kx<b.x&&v.y*ky<b.y&&(v.x+v.w)*kx>a.x&&(v.y+v.h)*ky>a.y)ctx.drawImage(t.canvas,v.x-t.x,v.y-t.y,v.w,v.h,v.x,v.y,v.w,v.h);}
    ctx.restore();return true;
  }
}
