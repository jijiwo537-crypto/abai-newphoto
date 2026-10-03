import {paintMaskTexture} from '../utils/maskTexture';
import {spacedTextureRadius,maskTextureGapFromUi,maskTextureGapToUi} from '../utils/textureSpacing';
void(async()=>{
 const report:any={kind:'mask-texture',ua:navigator.userAgent,checks:[]};
 const check=(name:string,pass:boolean,detail?:any)=>report.checks.push({name,pass,detail});
 const wait=async(n=1)=>{for(let i=0;i<n;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};
 try{
  const c=document.createElement('canvas');c.width=80;c.height=40;
  const g=c.getContext('2d')!;g.fillStyle='#fff';
  const draw=(v:number)=>{g.clearRect(0,0,80,40);paintMaskTexture(g,'dot',80,40,10,40,v);};
  const a=(x:number,y:number)=>g.getImageData(x,y,1,1).data[3];
  draw(50);check('half-covered left and right glyphs disappear',a(0,20)===0&&a(79,20)===0);
  check('neutral circle has full horizontal and vertical radius',a(47,20)>240&&a(40,27)>240);
  draw(0);check('left squashes each glyph vertically only',a(45,20)>120&&a(40,27)===0,{along:a(45,20),across:a(40,27)});
  draw(100);check('right squashes each glyph horizontally only',a(47,20)===0&&a(40,25)>120,{along:a(40,25),across:a(47,20)});
  let wrap:HTMLElement|null=null;for(let i=0;i<400;i++){wrap=document.querySelector('[data-mask-texture-squash]');if(wrap)break;await wait();}
  const input=wrap?.querySelector<HTMLInputElement>('input');
  check('real editor full-width squash slider defaults to centre',!!input&&input.value==='50'&&wrap!.classList.contains('col-span-2'));
  check('real editor texture remains visible',!document.querySelector<HTMLElement>('[data-creative-texture]')?.hidden);
  if(new URLSearchParams(location.search).has('spacingAudit')){
   const sliders=Array.from(document.querySelectorAll<HTMLInputElement>('[data-creative-texture] input[type=range]'));
   check('minimum displayed gap maps to physical -10',maskTextureGapFromUi(0)===-10&&Math.abs(maskTextureGapToUi(-10))<1e-8);
   for(const kind of ['dot','star','heart']){
    const low=spacedTextureRadius(12.25,40,1,600,600,kind),high=spacedTextureRadius(12.25,140,1,600,600,kind);
    check(kind+' maximum physical size doubles without touching neighbours',low===12.25&&high===24.5&&high*2*(kind==='star'?1.38:kind==='heart'?1.22:1)<140);
    check(kind+' radius is invariant across zoom and narrow layouts constrain size',Math.abs(spacedTextureRadius(12.25*7,140*7,7,600*7,600*7,kind)/7-high)<1e-8&&spacedTextureRadius(12.25,140,1,30,600,kind)<high);
   }
   const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
   for(const el of sliders.slice(0,2)){set.call(el,'100');el.dispatchEvent(new Event('input',{bubbles:true}));await wait(4);}
   check('real size and spacing controls retain displayed 0–100',sliders.slice(0,2).every(el=>el.min==='0'&&el.max==='100'&&el.value==='100'));
  }
  wrap?.scrollIntoView({block:'end'});
  if(new URLSearchParams(location.search).has('sliderAudit')){
   const sliders=Array.from(document.querySelectorAll<HTMLInputElement>('[data-creative-texture] input[type=range]'));
   const cv=document.querySelector<HTMLCanvasElement>('[data-creative-stage] canvas')!;
   const sample=()=>{const g=cv.getContext('2d')!;const d=g.getImageData(0,0,cv.width,cv.height).data;let sum=0;for(let i=0;i<d.length;i+=16)sum+=d[i];return sum;};
   for(let index=0;index<sliders.length;index++){
    const el=sliders[index],host=el.closest('.slider-wrap')!,r=el.getBoundingClientRect(),y=r.top+r.height/2;
    const x=r.left+r.width*.2,before=sample();
    host.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:91,pointerType:'touch',clientX:x,clientY:y}));
    const observed=[];
    for(let j=0;j<14;j++){window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:91,pointerType:'touch',clientX:r.left+r.width*(.2+j*.05),clientY:y}));await wait(2);observed.push(el.value);}
    window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:91,pointerType:'touch',clientX:r.left+r.width*.85,clientY:y}));await wait(4);
    check('slider '+index+' continuously updates value and canvas',new Set(observed).size>8&&before!==sample(),{observed,before,after:sample()});
   }
  }
  report.pass=report.checks.every((v:any)=>v.pass);
 }catch(e){report.pass=false;report.error=String(e);}
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
