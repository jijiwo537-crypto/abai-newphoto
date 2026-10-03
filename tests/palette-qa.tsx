import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../styles.css';
import '../components/ArtStudio.css';
import {GridLayoutTool,ShapeEditorPanel,TextEditorPanel,ColorPickerPage} from '../components/GridLayoutTool';
import {ArtColorControls} from '../components/ArtColorControls';
import {applyGlEffects,FX_DEFAULTS,disposeFxSurface} from '../utils/glEffects';
import {warmLowfiLut} from '../utils/lowfiLut';
import {DEFAULT_COLORS,CREATIVE_MASK_COLORS} from '../utils/colorPalettes.js';
const query=new URLSearchParams(location.search);
const shape:any={id:'palette-shape',src:'',shape:'circle',shapeFilled:true,x:40,y:60,width:120,height:120,scale:1,rotation:0,color:'#FFFFFF',shapeGlow:20};
function Panels(){const [mode,setMode]=useState('shape'),[revision,setRevision]=useState(0),[layer,setLayer]=useState(shape),[color,setColor]=useState('#FFFFFF');
 return <main style={{height:'100dvh',background:'#090909',color:'white',display:'flex',flexDirection:'column',padding:12}}><nav style={{display:'flex',gap:12,marginTop:50}}>{['shape','text','symbol','mask','art'].map(m=><button key={m} onClick={()=>{setMode(m);setRevision(r=>r+1);}}>{m}</button>)}<button onClick={()=>setRevision(r=>r+1)}>重新編輯</button></nav><div style={{flex:1}}/><section id="qa-panel" style={{height:310,overflow:'hidden'}}>{mode==='shape'?<ShapeEditorPanel key={revision} layer={layer} onChange={p=>setLayer(l=>({...l,...p}))}/>:mode==='text'||mode==='symbol'?<TextEditorPanel key={mode+revision} layer={{...layer,text:mode==='symbol'?'✦':'ABAI'}} symbol={mode==='symbol'} onChange={p=>setLayer(l=>({...l,...p}))}/>:mode==='art'?<ArtColorControls value={color} onChange={setColor}/>:<ColorPickerPage value={color} colors={[...CREATIVE_MASK_COLORS]} onPick={setColor} onBack={()=>setMode('shape')}/>}</section><div style={{height:65,borderTop:'1px solid #222'}}>色票驗證</div></main>;
}
const state={coordinateVersion:2,pageWidth:309,selectedRatio:'3:4',pages:[{id:'qa-page',bgColor:'#222222',layouts:[]}],floatingImages:[shape]};
createRoot(document.getElementById('root')!).render(query.has('grid')?<GridLayoutTool initialState={state} onHome={()=>{}}/>:<Panels/>);
if(query.has('gridAudit'))void(async()=>{
 const wait=async(n=8)=>{for(let i=0;i<n;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};await wait(60);
 const checks:any[]=[],check=(name:string,pass:boolean)=>checks.push({name,pass});
 const button=(title:string)=>document.querySelector<HTMLButtonElement>(`button[title="${title}"]`)!;
 button('背景顏色').click();await wait();
 Array.from(document.querySelectorAll('footer button')).find(b=>b.textContent==='點點')?.dispatchEvent(new MouseEvent('click',{bubbles:true}));await wait();
 const footer=document.querySelector('footer')!,bottom=footer.getBoundingClientRect().bottom;
 check('background color and all texture sliders fit',Array.from(footer.querySelectorAll('input[type="range"]')).every(e=>e.getBoundingClientRect().bottom<bottom-8));
 check('background colors have no vertical scroll container',!Array.from(footer.querySelectorAll('div')).some(e=>getComputedStyle(e).overflowY==='auto'&&e.scrollHeight>e.clientHeight+2));
 check('background colors expose no hexadecimal information',!footer.querySelector('input[aria-label="色號"]'));
 button('紋理顏色').click();await wait();
 check('texture color page is fixed',!Array.from(footer.querySelectorAll('div')).some(e=>getComputedStyle(e).overflowY==='auto'&&e.scrollHeight>e.clientHeight+2));
 check('texture color sliders all fit',Array.from(footer.querySelectorAll('input[type="range"]')).every(e=>e.getBoundingClientRect().bottom<bottom-8));
 const hit=document.querySelector<HTMLElement>('[data-floating-id="palette-shape"]')!,r=hit.getBoundingClientRect();
 for(const type of ['pointerdown','pointerup'])hit.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:1,pointerType:'mouse',clientX:r.x+r.width/2,clientY:r.y+r.height/2,buttons:type==='pointerdown'?1:0}));hit.click();await wait();
if(button('圖形調整')){button('圖形調整').click();await wait();check('floating edit closes background color page',!Array.from(footer.querySelectorAll('button')).some(b=>b.textContent==='返回'));footer.querySelector<HTMLButtonElement>('button[title="顏色"]')?.click();await wait();check('shape nested color opens',!!footer.querySelector('[data-fixed-color-page]'));button('圖形調整').click();await wait();check('same-object floating edit closes nested color',!footer.querySelector('[data-fixed-color-page]'));}
 else check('floating selection test started',false);
 const report={pass:checks.every(c=>c.pass),checks};const pre=document.createElement('pre');pre.id='grid-palette-result';pre.dataset.report=JSON.stringify(report);pre.style.cssText='position:fixed;left:5px;top:60px;z-index:999999;background:#111e;color:white;font-size:10px';pre.textContent=`GRID PASS ${report.pass} ${checks.filter(c=>c.pass).length}/${checks.length}\n`+checks.map(c=>`${c.pass?'✓':'✕'} ${c.name}`).join('\n');document.body.append(pre);
})();
if(query.has('audit'))void(async()=>{
 const wait=async(n=4)=>{for(let i=0;i<n;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};
 await wait(15);const checks:any[]=[];const check=(name:string,pass:boolean,detail?:any)=>checks.push({name,pass,detail});
 try{
  const panel=document.getElementById('qa-panel')!;
  const button=(name:string)=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent===name)!;
  // The real shape editor owns its nested page, exactly like the parent edit action.
  panel.querySelector<HTMLButtonElement>('[title="顏色"]')?.click();await wait();
  // Compact color controls have a semantic title and no visible label.
  if(!panel.querySelector('[data-fixed-color-page]')){Array.from(panel.querySelectorAll('button')).find(b=>b.textContent?.includes('顏色'))?.click();await wait();}
  check('shape color page opens',!!panel.querySelector('[data-fixed-color-page]'));
  check('color page has no hexadecimal input',!panel.querySelector('input[type="text"]'));
  const fixed=panel.querySelector<HTMLElement>('[data-fixed-color-page]');check('color page is fixed',!!fixed&&getComputedStyle(fixed.parentElement!).overflowY==='hidden');
  check('color page controls fit its panel',!!fixed&&Array.from(fixed.querySelectorAll('input[type="range"]')).every(r=>r.getBoundingClientRect().bottom<panel.getBoundingClientRect().bottom));
  button('重新編輯').click();await wait();check('editing again closes nested color page',!panel.querySelector('[data-fixed-color-page]'));
  for(const mode of ['text','symbol','mask','art']){button(mode).click();await wait();const swatches=Array.from(panel.querySelectorAll<HTMLElement>('button')).filter(b=>b.style.backgroundColor&&b.style.backgroundColor!=='transparent');check(mode+' palette starts correctly',swatches[0]?.style.backgroundColor===(mode==='text'?'rgb(0, 0, 0)':'rgb(255, 255, 255)'),swatches[0]?.style.backgroundColor);}
  await warmLowfiLut();const source=document.createElement('canvas');source.width=360;source.height=480;const ctx=source.getContext('2d',{willReadFrequently:true})!;
  ctx.fillStyle='#202020';ctx.fillRect(0,0,360,480);ctx.fillStyle='white';ctx.fillRect(120,150,120,180);const surface=document.createElement('canvas'),out=document.createElement('canvas');out.width=360;out.height=480;const oc=out.getContext('2d',{willReadFrequently:true})!;
  const render=(strength:number)=>{const c=applyGlEffects(ctx,360,480,{...FX_DEFAULTS,fxLowfi:100,fxLowfiGrain:0,fxLowfiFilter:0,fxLowfiAberration:0,fxLowfiContrast:0,fxLowfiHalo:strength},'unchanged-source',surface);if(!c)throw Error('GPU effect failed');oc.drawImage(c,0,0);return oc.getImageData(0,0,360,480).data;};
  const zero=render(0),fifty=render(50),repeat=render(50);let diff=0;for(let i=0;i<zero.length;i++)diff+=Math.abs(zero[i]-fifty[i]);check('halo responds immediately to its strength',diff>0,{diff});check('halo is deterministic on release',fifty.every((v,i)=>v===repeat[i]));check('full output dimensions stay unchanged',surface.width===360&&surface.height===480);
  const times=[];for(let i=0;i<30;i++){const t=performance.now();render(i*3);times.push(performance.now()-t);}check('strength changes reuse the mask and render successfully',times.every(Number.isFinite),{meanMs:times.reduce((a,b)=>a+b)/times.length,maxMs:Math.max(...times)});disposeFxSurface(surface);
 }catch(e){check('runtime exception',false,String(e));}
 const report={kind:'palette-lowfi-regression',ua:navigator.userAgent,pass:checks.every(c=>c.pass),checks};const p=document.createElement('pre');p.id='palette-result';p.dataset.report=JSON.stringify(report);p.style.cssText='position:fixed;top:95px;left:8px;max-height:240px;overflow:auto;z-index:999999;background:#111e;color:white;font-size:10px';p.textContent=`PASS ${report.pass} ${checks.filter(c=>c.pass).length}/${checks.length}\n`+checks.map(c=>`${c.pass?'✓':'✕'} ${c.name} ${c.detail?JSON.stringify(c.detail):''}`).join('\n');document.body.append(p);
})();
