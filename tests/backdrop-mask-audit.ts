import {drawBackdropMask,MASK_SHAPE_ITEMS,disposeBackdropMasks,backdropMaskDiagnostics} from '../utils/backdropMasks';
import {ClassicVectorScene} from '../components/ClassicVectorScene';
const root=document.getElementById('root')!;
const title=document.createElement('h2');title.textContent='六種動態遮罩驗證';root.append(title);
const report:any={kind:'backdrop-masks-v33',ua:navigator.userAgent,checks:[]};
const check=(name:string,pass:boolean,detail?:any)=>report.checks.push({name,pass,detail});
const c=document.createElement('canvas');c.width=720;c.height=960;c.style.cssText='width:100%;max-width:360px';root.append(c);
const g=c.getContext('2d',{willReadFrequently:true})!;
const base=()=>{g.setTransform(1,0,0,1,0,0);g.fillStyle='#204060';g.fillRect(0,0,720,960);for(let y=0;y<960;y+=12)for(let x=0;x<720;x+=12){g.fillStyle=(x/12+y/12)%2?'#e84b20':'#20bd84';g.fillRect(x,y,12,12);}};
const pix=(x:number,y:number)=>Array.from(g.getImageData(x,y,1,1).data);
const wait=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));
void(async()=>{try{
 for(const item of MASK_SHAPE_ITEMS){base();const before=g.getImageData(200,300,300,300).data,outside=pix(20,20);g.save();g.translate(360,480);drawBackdropMask(g,item.kind,400,500,{maskCells:12,maskAmount:100,maskFeather:40});g.restore();const after=g.getImageData(200,300,300,300).data;let diff=0;for(let i=0;i<before.length;i+=4)diff+=Math.abs(before[i]-after[i])+Math.abs(before[i+1]-after[i+1])+Math.abs(before[i+2]-after[i+2]);check(item.label+' changes lower ink',diff>1000,{difference:diff});check(item.label+' leaves outside unchanged',JSON.stringify(outside)===JSON.stringify(pix(20,20)));await wait();}
 base();const before=pix(360,480);g.save();g.translate(360,480);drawBackdropMask(g,'mask-negative',400,500);g.restore();check('negative inverts exact sampled RGB',pix(360,480).slice(0,3).every((v,i)=>Math.abs(v-(255-before[i]))<2));
 g.fillStyle='#fff';g.fillRect(340,460,40,40);check('higher object stays above material',pix(350,470).slice(0,3).every(v=>v===255));
 base();g.save();g.translate(360,480);g.rotate(.37);g.scale(1.6,.5);drawBackdropMask(g,'mask-frost-feather',300,300,{maskAmount:60,maskFeather:70});g.restore();check('rotated and squeezed feather mask renders without black output',pix(360,480).slice(0,3).every(v=>v>10));
 base();g.save();g.translate(360,480);g.scale(100,100);const start=performance.now();drawBackdropMask(g,'mask-frost-circle',300,300,{maskAmount:50});g.restore();check('huge offscreen mask remains viewport bounded',performance.now()-start<3000,{ms:performance.now()-start});
 const host=document.createElement('div');host.style.cssText='position:absolute;left:0;top:0;width:240px;height:240px';const page=document.createElement('div');page.dataset.pageId='qa';page.style.cssText='width:240px;height:240px;background:rgb(20,40,60)';host.append(page);root.append(host);
 const scene=new ClassicVectorScene();const off=scene.attach(host,host,()=>1);scene.set('lower',{z:60,paint:ctx=>{ctx.fillStyle='#c02040';ctx.fillRect(0,0,100,100);}});scene.set('higher',{z:100,paint:ctx=>{ctx.fillStyle='#fff';ctx.fillRect(0,0,240,240);}});
 const sample=document.createElement('canvas');sample.width=sample.height=240;const sg=sample.getContext('2d')!;const snapshot=scene.backdrop(sg,80,1,new DOMMatrix());const probe=snapshot.getContext('2d')!.getImageData(40,40,1,1).data;check('classic snapshot includes lower but excludes higher entries',probe[0]===192&&probe[1]===32&&probe[2]===64,{pixel:Array.from(probe)});const bg=snapshot.getContext('2d')!.getImageData(180,180,1,1).data;check('classic snapshot includes page background',bg[0]===20&&bg[1]===40&&bg[2]===60);off();host.remove();
 const timings=[];for(let i=0;i<30;i++){base();g.save();g.translate(300+i*2,480);const t=performance.now();drawBackdropMask(g,'mask-frost-circle',400,500,{maskAmount:50});timings.push(performance.now()-t);g.restore();await wait();}report.timings={mean:timings.reduce((a,b)=>a+b,0)/timings.length,max:Math.max(...timings)};check('moving frosted mask stays inside a 60fps render budget',report.timings.mean<16.7&&report.timings.max<25,report.timings);
 report.backend={...backdropMaskDiagnostics};check('GPU renderer runs without fallback',backdropMaskDiagnostics.cpuFrames===0,report.backend);report.pass=report.checks.every((x:any)=>x.pass);title.textContent=report.pass?'遮罩驗證全部通過':'遮罩驗證有失敗項目';
 }catch(e){report.pass=false;report.error=String(e);title.textContent=String(e);}await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});console.log(report);})();
window.addEventListener('pagehide',()=>disposeBackdropMasks(c));
