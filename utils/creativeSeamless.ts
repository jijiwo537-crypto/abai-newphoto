import {drawSeamPreview,disposeSeamPreview,copySeamPreviewPixels,seamTextureEpoch,type SeamView} from './seamlessPreview';
import {get2dWide} from './colorSpace';
import {scenePixelEdge} from './scenePixelGrid';
import {regionRects,seamlessPhotoBase,paintPhotoRegion,type PhotoRegion} from './creativePhotoLayout';
import {CreativeFeatherSurface} from './creativeFeatherSurface';
const isWebKit=()=>/AppleWebKit/.test(navigator.userAgent)&&(!/Chrome\//.test(navigator.userAgent)||/iPhone|iPad|iPod/.test(navigator.userAgent));
/**
 * 每個編輯器一張 GPU 畫布。只畫看得到的實體像素 viewport，不畫巨大的放大合成；來源照片維持原畫質
 */
export class CreativeSeamless {
  private surface:HTMLCanvasElement|null=null;
  private colorTile:HTMLCanvasElement|null=null;
  private presentation:HTMLCanvasElement|null=null;
  /** 拖滑桿時直接疊在畫面上的那層：跟放開後同一個色彩空間（同一組像素），自己的 context 直接顯示 */
  private liveLayer:HTMLCanvasElement|null=null;
  /** 這一次畫面（同一個同步的繪製過程）裡直接顯示的 GPU 層已經被一塊照片區用掉了 */
  private liveTaken=false;
  /** 最近一次畫面裡，除了直接顯示的那一塊，還有沒有第二塊（例如另一側遮罩底下那份照片）。
      有的話，拖滑桿時只重畫 GPU 那一層不夠 —— 第二塊在主畫布上，要整張重畫才會跟著變 */
  secondPiece=false;
  private interactive=new CreativeFeatherSurface();
  /* 畫好的結果留一份 2D 快照：無縫的參數、照片、位置、畫布大小都沒變時（移動別的物件、動畫、調別的東西），
     直接貼這張就好 —— 不重跑 GPU、也不再把 GPU 畫面複製回 2D 畫布（iPhone 上那一步要等 GPU 畫完，每一格都做就卡）。
     跨頁拼圖的無縫拼圖也是這樣做的。 */
  private snap:HTMLCanvasElement|null=null;
  /** 拖無縫滑桿時：只重畫直接顯示的那層（換融合量），不動 React、不重畫整張主畫布。跟跨頁拼圖同一種做法 */
  private liveRepaint:((amount:number)=>boolean)|null=null;
  /** 回傳 false＝目前沒有直接顯示的那層可以更新，呼叫的一方照原本的方式整張重畫 */
  updateLiveAmount(amount:number){return this.liveRepaint?this.liveRepaint(amount):false;}
  private snapKey='';
  warm(region:PhotoRegion,decoded:Map<string,HTMLImageElement>){
    const base=seamlessPhotoBase(region);if(!base||this.presentation?.style.display==='block')return;
    const surface=this.presentation||(this.presentation=document.createElement('canvas'));
    surface.width=surface.height=1;
    drawSeamPreview(surface,base.photos.map(p=>({url:p.src,zoom:p.zoom||1,offsetX:p.offsetX||0,offsetY:p.offsetY||0,rotation:0})),regionRects(base,1000,1000),
      base.photos.map(p=>{const image=decoded.get(p.src);return image?{image,width:p.width,height:p.height}:null;}),0,{width:1000,height:1000,xx:1000,xy:0,x0:0,yx:0,yy:1000,y0:0},true,isWebKit());
    surface.style.display='none';
  }
  /**
   * 常駐的原圖在遮罩之前就畫「進」主場景，絕不讓 DOM 合成器去濾兩層互補的 alpha。來源上傳照樣快取，
   * 不上傳場景、也不從 CPU 讀回
   */
  /** live：手指還在滑桿上（無縫、佔比）。GPU 這層直接以 DOM 疊在主畫布正下方顯示、
   *  主畫布把照片那一塊挖空 —— 省掉每一格把 GPU 畫面複製進 2D 畫布（iOS 上那是一次
   *  同步讀回）。尺寸、像素格與主畫布完全相同；放開後回到下面那條單一畫布的路。 */
  present(ctx:CanvasRenderingContext2D,region:PhotoRegion,decoded:Map<string,HTMLImageElement>,x:number,y:number,w:number,h:number,page:number[],viewport=[ctx.canvas.width,ctx.canvas.height],live=false){
    const base=seamlessPhotoBase(region);if(!base||base.photos.some(p=>!p.src||!decoded.has(p.src)))return false;
    const m=ctx.getTransform();if(m.b||m.c||m.a<=0||m.d<=0)return false;
    /* 直接顯示的 GPU 層只有一張，每畫一次整張都會重來。同一格畫面裡如果還有第二塊要畫（例如遮罩排版下方那一條），
       用同一層的話後畫的會把先畫的整個清掉 —— 拖無縫滑桿時照片整塊變黑就是這樣。第二塊之後改走一般的路
       （畫進主畫布），各畫各的範圍。同步繪製結束（microtask）就放開，下一格重新來。 */
    if(!live)this.liveRepaint=null;
    if(live){
      if(this.liveTaken){this.secondPiece=true;return false;}
      this.liveTaken=true;this.secondPiece=false;queueMicrotask(()=>{this.liveTaken=false;});
    }
    if(this.presentation?.dataset.sourceUploads&&this.presentation.getContext('webgl2')?.isContextLost()){
      disposeSeamPreview(this.presentation);this.presentation.remove();this.presentation.width=this.presentation.height=1;this.presentation=null;
    }
    const surface=this.presentation||(this.presentation=document.createElement('canvas'));
    const main=ctx.canvas;
    // 主畫布本來就是有範圍的 viewport（加上可以重用的縮放容量），不是巨大的放大頁面，
    // 所以用跟它「完全一樣」的暫存大小和 CSS 矩形。另外裁一次、量一次 DOM，
    // 兩張畫布的 CSS 取整和雙線性取樣相位就會不同，就算邏輯邊緣一樣
    const l=0,t=0,W=main.width,H=main.height;
    const left0=Math.max(0,page[0],x*m.a+m.e),top0=Math.max(0,page[1],y*m.d+m.f);
    const right0=Math.min(viewport[0],page[0]+page[2],(x+w)*m.a+m.e),bottom0=Math.min(viewport[1],page[1]+page[3],(y+h)*m.d+m.f);
    const key=JSON.stringify([W,H,m.a,m.d,m.e,m.f,x,y,w,h,left0,top0,right0,bottom0,region.seamless?(region.seamlessAmount||0):-1,
      base.photos.map(p=>[p.src,p.zoom||1,p.offsetX||0,p.offsetY||0,p.width,p.height,(decoded.get(p.src) as any)?.dataset?.seamRevision||'']),
      regionRects(base,w,h),seamTextureEpoch()]);
    if(!live&&this.snap&&key===this.snapKey){
      const cl=scenePixelEdge(left0),ct=scenePixelEdge(top0),cr=scenePixelEdge(right0),cb=scenePixelEdge(bottom0);
      if(this.presentation){this.presentation.remove();this.presentation.style.display='none';}
      if(this.liveLayer){this.liveLayer.remove();this.liveLayer.style.display='none';}
      main.dataset.creativePhotoComposition='single-canvas';
      ctx.save();ctx.setTransform(1,0,0,1,0,0);
      ctx.beginPath();ctx.rect(cl,ct,Math.max(0,cr-cl),Math.max(0,cb-ct));ctx.clip();
      ctx.drawImage(this.snap,cl,ct);ctx.restore();return true;
    }
    if(surface.width!==W)surface.width=W;if(surface.height!==H)surface.height=H;
    const sources=base.photos.map(p=>{const image=decoded.get(p.src);return image?{image,width:p.width,height:p.height}:null;});
    const left=Math.max(0,page[0],x*m.a+m.e),top=Math.max(0,page[1],y*m.d+m.f);
    const right=Math.min(viewport[0],page[0]+page[2],(x+w)*m.a+m.e),bottom=Math.min(viewport[1],page[1]+page[3],(y+h)*m.d+m.f);
    // 在有範圍的編輯器點陣裡維持一模一樣的實體像素取樣，包含主畫布可重用的縮放容量。
    // 照片像素延伸到不透明遮罩的濾鏡範圍下面，而它精確的半開區間裁切照樣說了算；來源裁切不變
    const view:SeamView={width:w,height:h,xx:W/m.a,xy:0,x0:(l-m.e)/m.a-x,yx:0,yy:H/m.d,y0:(t-m.f)/m.d-y,clip:[(left-l)/W,(top-t)/H,(right-l)/W,(bottom-t)/H],clipGuard:[2/W,2/H]};
    const parent=main.parentElement,liveLayer=live&&!!parent;
    /* WebKit（iPhone）：拖曳中直接把「已經有照片貼圖的那張 GPU 畫面」疊上去，不再另開一個
       WebGL context 把每張原圖重新上傳一次 —— 手機上那個新 context 常常畫不出來（一片黑）
       或被系統收掉，還會多吃一份原圖大小的記憶體。這張本來就輸出 sRGB，直接顯示跟複製進
       主畫布看到的是同一組顏色。 */
    const reuseSurface=liveLayer&&isWebKit();
    const paintSurface=(target:HTMLCanvasElement,noTransfer=false)=>drawSeamPreview(target,base.photos.map(p=>({url:p.src,zoom:p.zoom||1,offsetX:p.offsetX||0,offsetY:p.offsetY||0,rotation:0})),regionRects(base,w,h),sources,region.seamless?(region.seamlessAmount||0):-1,view,true,isWebKit(),noTransfer);
    if(!liveLayer)paintSurface(surface);
    const clearLeft=scenePixelEdge(left),clearTop=scenePixelEdge(top);
    const clearRight=scenePixelEdge(right),clearBottom=scenePixelEdge(bottom);
    if(liveLayer&&parent&&!(reuseSurface&&surface.getContext('webgl2')?.isContextLost())){
      let layer:HTMLCanvasElement;
      if(reuseSurface){
        layer=surface;
        if(this.liveLayer){this.liveLayer.remove();this.liveLayer.style.display='none';}
      }else{
        if(this.liveLayer?.dataset.sourceUploads&&this.liveLayer.getContext('webgl2')?.isContextLost()){disposeSeamPreview(this.liveLayer);this.liveLayer.remove();this.liveLayer=null;}
        layer=this.liveLayer||(this.liveLayer=document.createElement('canvas'));
        if(layer.width!==W)layer.width=W;if(layer.height!==H)layer.height=H;
        surface.remove();surface.style.display='none';
      }
      layer.dataset.creativeLiveSeam='1';
      // 小數像素也要一樣（offset* 會取整，差一條像素）
      const mr=main.getBoundingClientRect(),pr=parent.getBoundingClientRect();
      // 跟主畫布同一層級、緊貼在它下面：中間不能夾任何別的圖層把它蓋住
      Object.assign(layer.style,{display:'block',position:'absolute',pointerEvents:'none',zIndex:getComputedStyle(main).zIndex==='auto'?'0':getComputedStyle(main).zIndex,margin:'0',
        left:`${mr.left-pr.left-parent.clientLeft}px`,top:`${mr.top-pr.top-parent.clientTop}px`,width:`${mr.width}px`,height:`${mr.height}px`,
        transform:main.style.transform||'none',transformOrigin:main.style.transformOrigin||''});
      if(layer.parentElement!==parent||layer.nextSibling!==main)parent.insertBefore(layer,main);
      // 先放進畫面再畫：WebKit 對「離開畫面時畫好、之後才接上」的 WebGL 畫布可能整片不顯示
      paintSurface(layer,!reuseSurface);
      {
        const target=layer,noTransfer=!reuseSurface;
        this.liveRepaint=(amount:number)=>{
          if(!target.isConnected||target.style.display==='none')return false;
          if(reuseSurface&&target.getContext('webgl2')?.isContextLost())return false;
          drawSeamPreview(target,base.photos.map(p=>({url:p.src,zoom:p.zoom||1,offsetX:p.offsetX||0,offsetY:p.offsetY||0,rotation:0})),regionRects(base,w,h),sources,amount,view,true,isWebKit(),noTransfer);
          return true;
        };
      }
      main.dataset.creativePhotoComposition='live-layer';
      ctx.save();ctx.setTransform(1,0,0,1,0,0);
      ctx.beginPath();ctx.rect(clearLeft,clearTop,Math.max(0,clearRight-clearLeft),Math.max(0,clearBottom-clearTop));ctx.clip();
      ctx.clearRect(clearLeft,clearTop,Math.max(0,clearRight-clearLeft),Math.max(0,clearBottom-clearTop));ctx.restore();
      return true;
    }
    // GPU 暫存是私有的，不是另外縮放的 DOM 圖層。在它暫時的畫面暫存被丟掉之前，同一個工作裡就複製出來
    if(liveLayer)paintSurface(surface);
    surface.remove();surface.style.display='none';delete surface.dataset.creativeLiveSeam;
    if(this.liveLayer){this.liveLayer.remove();this.liveLayer.style.display='none';}
    main.dataset.creativePhotoComposition='single-canvas';
    ctx.save();ctx.setTransform(1,0,0,1,0,0);
    ctx.beginPath();ctx.rect(clearLeft,clearTop,Math.max(0,clearRight-clearLeft),Math.max(0,clearBottom-clearTop));ctx.clip();
    // 直接畫進 2D 場景。WebKit 上這張畫布輸出 sRGB（見 drawSeamPreview 的 srgbOutput），drawImage 讀得正確；
    // 不從 GPU 讀回，那可能讀到空的、讓照片變空白
    ctx.drawImage(surface,0,0);ctx.restore();
    /* 留快照（只留照片那一塊）。拖滑桿那幾格不留：每一格都在變 */
    if(!live){
      const cw=Math.max(0,clearRight-clearLeft),ch=Math.max(0,clearBottom-clearTop);
      if(cw>0&&ch>0){
        const space=(ctx as any).getContextAttributes?.()?.colorSpace||'srgb';
        const snap=this.snap||(this.snap=document.createElement('canvas'));
        if(snap.width!==cw)snap.width=cw;if(snap.height!==ch)snap.height=ch;
        const sg=snap.getContext('2d',{colorSpace:space} as CanvasRenderingContext2DSettings) as CanvasRenderingContext2D;
        sg.setTransform(1,0,0,1,0,0);sg.globalCompositeOperation='copy';
        /* 從主畫布拿（剛剛貼上去的那一塊就是結果，色彩空間也一樣），不從 GPU 畫布再讀一次 */
        sg.drawImage(main,clearLeft,clearTop,cw,ch,0,0,cw,ch);sg.globalCompositeOperation='source-over';
        this.snapKey=key;
      }
    }else this.snapKey='';
    return true;
  }
  beginFrame(){}
  flush(){}
  hide(){this.liveRepaint=null;if(this.presentation){this.presentation.style.display='none';this.presentation.remove();}if(this.liveLayer){this.liveLayer.style.display='none';this.liveLayer.remove();}}
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
    // 被收掉的 context 在同一個元素上永遠不會回來（iOS），重新開始
    if(this.surface?.getContext('webgl2')?.isContextLost()){disposeSeamPreview(this.surface);this.surface.width=this.surface.height=1;this.surface=null;}
    const surface=this.surface||(this.surface=document.createElement('canvas'));
    const photos=base.photos.map(p=>({url:p.src,zoom:p.zoom||1,offsetX:p.offsetX||0,offsetY:p.offsetY||0,rotation:0}));
    const sources=base.photos.map(p=>{const image=decoded.get(p.src);return image?{image,width:p.width,height:p.height}:null;});
    // 圖塊也限制原解析度存檔的範圍；每個圖塊都取樣原本的座標，羽化權重跟互動預覽完全一樣
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
  dispose(){this.hide();if(this.snap){this.snap.width=this.snap.height=1;this.snap=null;}this.snapKey='';if(this.liveLayer){disposeSeamPreview(this.liveLayer);this.liveLayer.width=this.liveLayer.height=1;this.liveLayer=null;}this.interactive.dispose();if(this.presentation){disposeSeamPreview(this.presentation);this.presentation.remove();this.presentation.width=this.presentation.height=1;this.presentation=null;}if(this.surface){disposeSeamPreview(this.surface);this.surface.width=this.surface.height=1;this.surface=null;}if(this.colorTile){this.colorTile.width=this.colorTile.height=1;this.colorTile=null;}}
}
