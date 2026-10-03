import {applyPhotoFx, type PhotoFx} from './photoFx';

// Same full-density interaction strategy as ImageEditor: prepare immutable
// endpoints while idle, then composite them instead of reprocessing every pixel
// on every input event. Exports never enter this cache.
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
  prepare(source:CanvasImageSource,w:number,h:number,fx:PhotoFx,tool:string) {
    if(!BLEND_ADJUSTMENTS.has(tool))return;
    // Bound cache memory, not rendering quality. Very large previews keep the
    // exact full-resolution pipeline instead of allocating four huge surfaces.
    if(w*h>4_000_000){if(this.source)this.clear();return;}
    const sig=JSON.stringify([w,h,tool,{...fx,[tool]:0}]);
    if(this.source===source&&this.signature===sig)return;
    this.clear();this.source=source;this.signature=sig;
    this.anchor=Math.max(-100,Math.min(100,Number(fx[tool])||0));
    this.values=[this.anchor,-100,100];
    const generation=this.generation;
    const build=()=>{
      if(generation!==this.generation)return;
      if(this.held){this.timer=setTimeout(build,80);return;}
      const i=this.stages.length;
      const processed=applyPhotoFx(source,w,h,{...fx,[tool]:this.values[i]},{cacheSource:true,preferSeparableCpu:true});
      const immutable=document.createElement('canvas');immutable.width=w;immutable.height=h;
      immutable.getContext('2d')!.drawImage(processed,0,0,w,h);
      this.stages.push(immutable);
      if(this.stages.length<3)this.timer=setTimeout(build,32);
      else {this.timer=null;this.ready();}
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
    if(this.output.width!==w||this.output.height!==h){this.output.width=w;this.output.height=h;}
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
