import {HalationLayer} from '../utils/halationLayer';
import {fastBlur,hslToRgb} from '../components/ImageEditor';
import {highlightHistogram,selectHighlights,highlightWeight,luminanceBin} from '../utils/highlightSelection';
import {applyGlEffects,disposeFxSurface} from '../utils/glEffects';

export async function auditHalation(){
 const src=document.createElement('canvas');src.width=600;src.height=800;const s=src.getContext('2d')!;
 const grad=s.createLinearGradient(0,0,600,800);grad.addColorStop(0,'#163950');grad.addColorStop(1,'#e9bd99');s.fillStyle=grad;s.fillRect(0,0,600,800);
 s.fillStyle='white';s.fillRect(70,45,90,600);s.beginPath();s.arc(405,355,120,0,Math.PI*2);s.fill();
 const pixels=s.getImageData(0,0,600,800),raw=pixels.data;
 const reference=(p:any)=>{
  const mask=new ImageData(600,800);
  for(let i=0;i<raw.length;i+=4){const l=raw[i]*.299+raw[i+1]*.587+raw[i+2]*.114;
   if(l>160){mask.data[i]=mask.data[i+1]=mask.data[i+2]=255;mask.data[i+3]=Math.pow((l-160)/95,1.5)*255;}}
  fastBlur(mask,600,800,Math.max(1,600*.08*.8553125*p.fringeSize/100),null);
  const output=new ImageData(600,800),c=hslToRgb(p.fringeHue/360,.8,.35);
  for(let i=0;i<raw.length;i+=4){const a=mask.data[i+3]/255,l=raw[i]*.299+raw[i+1]*.587+raw[i+2]*.114;
   const strength=Math.min(1,a*Math.pow(Math.max(0,255-l)/255,1+(100-p.fringeFeather)/100*4)*p.fringeIntensity/50*3);
   if(a>.005&&strength>.001){for(let k=0;k<3;k++)output.data[i+k]=c[k]*strength;output.data[i+3]=255;}}
  return output;
 };
 const renderer=new HalationLayer(),out=document.createElement('canvas');out.width=600;out.height=800;const ctx=out.getContext('2d',{willReadFrequently:true})!;
 const surface=document.createElement('canvas'),presenter=new HalationLayer(surface);
 const params={fringeIntensity:35,fringeHue:8,fringeSize:10,fringeFeather:100},checks:any[]=[];
 for(const patch of [{},{fringeSize:100},{fringeFeather:0},{fringeHue:250},{fringeSize:1,fringeHue:80,fringeFeather:50}]){
  const p={...params,...patch},expected=reference(p),actual=renderer.render(s,600,800,'fixture',p,hslToRgb(p.fringeHue/360,.8,.35));
  if(!actual)throw Error('WebGL unavailable');ctx.clearRect(0,0,600,800);ctx.drawImage(actual,0,0);const got=ctx.getImageData(0,0,600,800).data;
  let max=0,sum=0,differentAlpha=0;for(let i=0;i<got.length;i++){const d=Math.abs(got[i]-expected.data[i]);if(i%4===3){if(d)differentAlpha++;}else{max=Math.max(max,d);sum+=d;}}
  checks.push({patch,max,mean:sum/(600*800*3),differentAlpha});
  const full=presenter.render(s,600,800,'fixture',p,hslToRgb(p.fringeHue/360,.8,.35));
  ctx.globalCompositeOperation='copy';ctx.drawImage(src,0,0);ctx.globalCompositeOperation='screen';ctx.drawImage(actual,0,0);ctx.globalCompositeOperation='source-over';
  const want=ctx.getImageData(0,0,600,800).data;ctx.globalCompositeOperation='copy';ctx.drawImage(full!,0,0);ctx.globalCompositeOperation='source-over';const complete=ctx.getImageData(0,0,600,800).data;
  let maxComposite=0;for(let i=0;i<want.length;i++)maxComposite=Math.max(maxComposite,Math.abs(want[i]-complete[i]));checks.push({direct:patch,max:maxComposite,differentAlpha:0});
 }
 const soft=new HalationLayer(),bins=highlightHistogram(raw);
 for(const p of [{softThreshold:80,softRadius:100,softColor:0},{softThreshold:20,softRadius:34,softColor:73},{softThreshold:95,softRadius:0,softColor:0}]){
  const expected=new ImageData(600,800),select=selectHighlights(bins,100-p.softThreshold),color=hslToRgb(p.softColor/100,1,.5);
  for(let i=0;i<raw.length;i+=4){for(let k=0;k<3;k++)expected.data[i+k]=p.softColor>0?color[k]:raw[i+k];expected.data[i+3]=255*highlightWeight(luminanceBin(raw[i],raw[i+1],raw[i+2]),select);}
  fastBlur(expected,600,800,p.softRadius/100*80*800/1080,null);
  const actual=soft.renderSoft(s,600,800,'fixture',p,color);ctx.clearRect(0,0,600,800);ctx.drawImage(actual!,0,0);
  // Canvas pixel storage is premultiplied: compare against the same storage
  // path, not invisible RGB in the raw ImageData at alpha zero.
  const ref=document.createElement('canvas');ref.width=600;ref.height=800;ref.getContext('2d')!.putImageData(expected,0,0);
  const want=ref.getContext('2d')!.getImageData(0,0,600,800).data,got=ctx.getImageData(0,0,600,800).data;
  // Unpremultiplication magnifies an invisible rounding difference at alpha
  // 1 into 255 RGB levels. Compare the actual compositing contribution.
  let max=0,sum=0,differentAlpha=0;for(let i=0;i<got.length;i++){const a=i-i%4+3;const d=i%4===3?Math.abs(want[i]-got[i]):Math.abs(want[i]*want[a]/255-got[i]*got[a]/255);if(i%4===3){if(d)differentAlpha++;}else{max=Math.max(max,d);sum+=d;}}
  checks.push({soft:p,max,mean:sum/(600*800*3),differentAlpha});
 }
 soft.dispose();
 const leakSurface=document.createElement('canvas'),leakRenderer=new HalationLayer(leakSurface);
 for(const p of [{leakOpacity:75,leakAngle:45,leakHue:15},{leakOpacity:75,leakAngle:269,leakHue:269}]){
  ctx.globalCompositeOperation='copy';ctx.drawImage(src,0,0);ctx.globalCompositeOperation='screen';const a=(p.leakAngle-180)*Math.PI/180,r=1200,c=hslToRgb(p.leakHue/360,1,.5),g=ctx.createLinearGradient(300+Math.cos(a)*r,400+Math.sin(a)*r,300-Math.cos(a)*r,400-Math.sin(a)*r);g.addColorStop(0,`rgba(${c.join(',')},${p.leakOpacity/100})`);g.addColorStop(.5,`rgba(${c.join(',')},0)`);ctx.fillStyle=g;ctx.fillRect(0,0,600,800);const want=ctx.getImageData(0,0,600,800).data;
  const actual=leakRenderer.renderLeak(s,600,800,'fixture',p,c);ctx.globalCompositeOperation='copy';ctx.drawImage(actual!,0,0);const got=ctx.getImageData(0,0,600,800).data;ctx.globalCompositeOperation='source-over';let max=0;for(let i=0;i<got.length;i++)max=Math.max(max,Math.abs(got[i]-want[i]));checks.push({leak:p,max,differentAlpha:0});
 }
 leakRenderer.dispose();
 const optimized=document.createElement('canvas'),baseline=document.createElement('canvas');
 for(const p of [{fxExposureSpill:60,fxSpillRange:20,fxSpillDiffusion:50},{fxExposureSpill:90,fxSpillRange:75,fxSpillDiffusion:85,fxSpillHue:73}]){
  applyGlEffects(s,600,800,p,undefined,optimized);applyGlEffects(s,600,800,p,undefined,baseline,true);
  ctx.globalCompositeOperation='copy';ctx.drawImage(baseline,0,0);const want=ctx.getImageData(0,0,600,800).data;ctx.drawImage(optimized,0,0);const got=ctx.getImageData(0,0,600,800).data;ctx.globalCompositeOperation='source-over';
  let max=0;for(let i=0;i<got.length;i++)max=Math.max(max,Math.abs(got[i]-want[i]));checks.push({spill:p,max,differentAlpha:0});
 }
 disposeFxSurface(optimized);disposeFxSurface(baseline);
 (window as any).__halationProgress={checks,timings:[]};
 const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())),timings:any[]=[];
 for(const key of ['fringeIntensity','fringeSize','fringeFeather','fringeHue']){
  const times:number[]=[],frames:number[]=[];let previous=performance.now();
  for(let i=0;i<75;i++){await frame();const now=performance.now();if(i>10)frames.push(now-previous);previous=now;const p={...params,[key]:Math.round((key==='fringeHue'?360:100)*(.5+.4*Math.sin(i*.1)))};
   const start=performance.now();presenter.render(s,600,800,'fixture',p,hslToRgb(p.fringeHue/360,.8,.35));if(i>10)times.push(performance.now()-start);}
  times.sort((a,b)=>a-b);frames.sort((a,b)=>a-b);timings.push({key,cpuP50:times[Math.floor(times.length*.5)],cpuP95:times[Math.floor(times.length*.95)],frameP50:frames[Math.floor(frames.length*.5)],frameP95:frames[Math.floor(frames.length*.95)]});
  (window as any).__halationProgress={checks,timings};
 }
 // Four GPU RGBA8 passes and Canvas premultiplication can round a composite
 // contribution by under two byte levels on WebKit; never permit alpha loss.
 renderer.dispose();presenter.dispose();const report={ua:navigator.userAgent,checks,timings,passed:checks.every(c=>c.max<=(c.soft||c.leak?2:1)&&c.differentAlpha===0)};
 (window as any).__halationAudit=report;
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify({kind:'halation-performance',...report})}).catch(()=>{});
 const el=document.createElement('pre');el.textContent=JSON.stringify(report,null,2);Object.assign(el.style,{position:'fixed',inset:'90px 8px 10px',background:'#111',color:'white',fontSize:'10px',overflow:'auto',zIndex:99999});document.body.append(el);
}
