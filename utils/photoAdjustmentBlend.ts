import {applyPhotoFx, type PhotoFx} from './photoFx';
import {get2dWide} from './colorSpace';

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
  prepare(source:CanvasImageSource,w:number,h:number,fx:PhotoFx,tool:string,project?:(photo:HTMLCanvasElement,fx:PhotoFx)=>HTMLCanvasElement) {
    if(!BLEND_ADJUSTMENTS.has(tool))return;
    // Bound cache memory, not rendering quality. Very large previews keep the
    // exact full-resolution pipeline instead of allocating four huge surfaces.
    // A projected collage stores the on-screen scene, not the larger decoded
    // photograph. Bound those separately: a 4K source can legitimately exceed
    // four million pixels while the actual preview cache still fits in 64 MB.
    if(w*h>(project?16_000_000:4_000_000)){if(this.source)this.clear();return;}
    const sig=JSON.stringify([w,h,tool,{...fx,[tool]:0}]);
    if(this.source===source&&this.signature===sig)return;
    this.clear();this.source=source;this.signature=sig;
    this.anchor=Math.max(-100,Math.min(100,Number(fx[tool])||0));
    this.values=[this.anchor,-100,100];
    const generation=this.generation;
    const build=()=>{
      if(generation!==this.generation)return;
      // Do not suspend preparation for the entire gesture. A user can touch
      // the slider before idle preparation finishes; waiting for pointer-up
      // traps every subsequent input in the slow exact-render fallback.
      // Build one immutable endpoint per task, then let the same gesture use
      // the completed cache. Generation guards still cancel obsolete tools.
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
        // Canvas commands can remain queued in WebKit. Upload all immutable
        // stages before declaring the cache ready, otherwise the first drag
        // pays that deferred work even though its JS paint takes <1 ms.
        this.output=document.createElement('canvas');this.output.width=immutable.width;this.output.height=immutable.height;
        const ctx=(project?get2dWide(this.output):this.output.getContext('2d'))!;
        // Flush each upload independently. WebKit can discard earlier opaque
        // draws if all three are queued before the readback, leaving the anchor
        // and negative endpoint to upload on the first finger movement.
        for(const stage of this.stages){ctx.drawImage(stage,0,0);ctx.getImageData(0,0,1,1);}
        // Also preflight the actual alpha-composite path, not just opaque
        // uploads; its first backing-store allocation must happen while idle.
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
