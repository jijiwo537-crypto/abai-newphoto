import {applyPhotoFx, type PhotoFx} from './photoFx';
import {get2dWide} from './colorSpace';
import {awaitPhotoIdle} from './photoInteractionIdle';

// 跟 ImageEditor 一樣的完整密度互動策略：閒置時準備固定的端點，之後合成它們，
// 不必每次輸入都重新處理每個像素。存檔絕不走這個快取
export const BLEND_ADJUSTMENTS = new Set(['brightness','exposure','contrast','highlights','shadows','temp','tint','sat','vib']);
export class PhotoAdjustmentBlend {
  private signature = '';
  private source: CanvasImageSource | null = null;
  private stages: HTMLCanvasElement[] = [];
  private output: HTMLCanvasElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private anchor = 0;
  private values: number[] = [];
  private held = false;
  constructor(private ready:()=>void) {}
  get isReady() { return this.stages.length===3; }
  setHeld(value:boolean) { this.held=value; }
  prepare(source:CanvasImageSource,w:number,h:number,fx:PhotoFx,tool:string,project?:(photo:HTMLCanvasElement,fx:PhotoFx)=>HTMLCanvasElement) {
    if(!BLEND_ADJUSTMENTS.has(tool))return;
    // 限制的是快取記憶體，不是繪製畫質。很大的預覽照樣走精確的原解析度管線，不配置四張巨大的畫布。
    // 投影的拼圖存的是螢幕上的場景，不是比較大的解碼照片，所以兩者分開限制：4K 的來源超過四百萬像素是正常的，
    // 實際的預覽快取還是放得進 64MB
    if(w*h>(project?16_000_000:4_000_000)){if(this.source)this.clear();return;}
    const sig=JSON.stringify([w,h,tool,{...fx,[tool]:0}]);
    if(this.source===source&&this.signature===sig)return;
    this.clear();this.source=source;this.signature=sig;
    this.anchor=Math.max(-100,Math.min(100,Number(fx[tool])||0));
    this.values=[this.anchor,-100,100];
    const generation=this.generation;
    const build=async()=>{
      // 精確的端點快照可能觸發好幾百萬像素的 GPU 讀回。很短的計時器「不是」閒置：它會打斷下一次點分頁。
      // 等待後要重新檢查版本；已經過時的編輯器不能再做
      await awaitPhotoIdle();
      if(generation!==this.generation)return;
      // 不要整個手勢期間都暫停準備。使用者可能在閒置準備完成前就碰到滑桿；等到 pointer-up 的話，
      // 之後每次輸入都會卡在很慢的精確繪製備援。每個工作做一個固定的端點，同一個手勢就能用已經完成的快取；
      // 版本檢查照樣會取消過時的工具
      const i=this.stages.length;
      const stageFx={...fx,[tool]:this.values[i]};
      const processed=applyPhotoFx(source,w,h,stageFx,{cacheSource:true,gpuSurface:true});
      const projected=project?project(processed,stageFx):processed;
      if(projected.width*projected.height>4_000_000){this.clear();return;}
      const immutable=document.createElement('canvas');immutable.width=projected.width;immutable.height=projected.height;
      (project?get2dWide(immutable):immutable.getContext('2d'))!.drawImage(projected,0,0);
      if(project&&projected!==processed)projected.width=projected.height=1;
      this.stages.push(immutable);
      if(this.stages.length<3)this.timer=setTimeout(build,32);
      else {
        // Canvas 指令在 WebKit 裡可能還在排隊。宣告快取可用之前先把所有固定的階段上傳完，
        // 不然第一次拖動要付這筆延後的工作，就算它的 JS 繪製不到 1ms
        this.output=document.createElement('canvas');this.output.width=immutable.width;this.output.height=immutable.height;
        const ctx=(project?get2dWide(this.output):this.output.getContext('2d'))!;
        // 每次上傳各自 flush。三個都排在讀回前面的話，WebKit 可能丟掉前面的不透明繪製，
        // 基準和負向端點就會拖到第一次手指移動才上傳
        for(const stage of this.stages){ctx.drawImage(stage,0,0);ctx.getImageData(0,0,1,1);}
        // 實際的 alpha 合成路線也要預檢，不只是不透明的上傳；它第一次配置暫存一定要發生在閒置時
        for(const endpoint of [1,2]){
          this.paint(source,w,h,{...fx,[tool]:(this.anchor+this.values[endpoint])/2},tool);
          ctx.getImageData(0,0,1,1);
        }
        this.timer=null;this.ready();
      }
    };
    this.timer=setTimeout(build,80);
  }
  paint(source:CanvasImageSource,w:number,h:number,fx:PhotoFx,tool:string):HTMLCanvasElement|null {
    if(this.stages.length!==3||this.source!==source||this.signature!==JSON.stringify([w,h,tool,{...fx,[tool]:0}]))return null;
    const value=Math.max(-100,Math.min(100,Number(fx[tool])||0));
    const endpoint=value>=this.anchor?2:1;
    const span=this.values[endpoint]-this.anchor;
    const alpha=span?(value-this.anchor)/span:0;
    this.output??=document.createElement('canvas');
    const ow=this.stages[0].width,oh=this.stages[0].height;
    if(this.output.width!==ow||this.output.height!==oh){this.output.width=ow;this.output.height=oh;}
    const ctx=this.output.getContext('2d')!;ctx.globalAlpha=1;ctx.globalCompositeOperation='copy';ctx.drawImage(this.stages[0],0,0);
    ctx.globalCompositeOperation='source-over';ctx.globalAlpha=Math.max(0,Math.min(1,alpha));ctx.drawImage(this.stages[endpoint],0,0);ctx.globalAlpha=1;
    this.output.dataset.colorBackend='full-resolution-blend';
    return this.output;
  }
  clear() {
    this.generation++;if(this.timer!==null)clearTimeout(this.timer);this.timer=null;
    for(const canvas of this.stages){canvas.width=canvas.height=1;}this.stages=[];
    if(this.output){this.output.width=this.output.height=1;}this.output=null;
    this.source=null;this.signature='';
  }
}
