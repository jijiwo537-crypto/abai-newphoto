import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'abai-selected-motion-'));
try {
 const out=join(dir,'motion.mjs');
 await build({entryPoints:['utils/selectedAnimations.ts'],bundle:true,platform:'node',format:'esm',outfile:out});
 const m=await import(pathToFileURL(out));
 assert.equal(m.SELECTED_ANIMATIONS.length,17);
 assert.equal(new Set(m.SELECTED_ANIMATIONS.map(x=>x.id)).size,17);
 assert.deepEqual(m.SELECTED_ANIMATIONS.map(({id,name})=>[id,name]),[
  ['lab-T-E03','淡入ll'],['lab-T-E07','果凍ll'],
  ['lab-T-L01','呼吸'],['lab-T-L04','閃爍'],['lab-T-L15','波浪ll'],['lab-T-L20','搖晃'],
  ['lab-S-E03','淡入'],['lab-S-E04','足跡'],['lab-S-E10','旋轉'],
  ['lab-S-L01','呼吸'],['lab-S-L03','搖擺'],['lab-S-L07','翻面'],['lab-S-L20','搖晃'],
  ['lab-P-L02','閃爍'],['lab-P-L04','發光'],['lab-P-L07','翻面'],['lab-P-L20','搖晃'],
 ]);
 for(const target of ['text','symbol','pattern'])assert.ok(m.selectedKinds(target,'idle').length);
 assert.equal(m.selectedKinds('shape','idle').length,0,'retired shape animations are absent');
 const ctx={globalAlpha:1,filter:'none',save(){this.depth=(this.depth||0)+1;},restore(){this.depth--;},getTransform(){return {a:2,b:0};}};
 for(const name of ['translate','rotate','scale','rect','fillRect'])ctx[name]=(...v)=>{assert.ok(v.every(Number.isFinite),`${name} finite`);};
 ctx.beginPath=ctx.clip=()=>{};
 for(const spec of m.SELECTED_ANIMATIONS){
  for(const t of [-1,0,.001,.2,.7,1,1.001,2,17,1000]){
   const cfg={in:spec.phase==='entry'?spec.id:'none',idle:spec.phase==='idle'?spec.id:'none',delay:0,dur:1,amp:100,speed:1};
   const frame=m.selectedFrame(cfg,t,.4);
   let calls=0;m.paintSelectedAnimation(ctx,frame,40,50,()=>calls++,1,4);
   assert.equal(ctx.depth||0,0,`${spec.code}: balanced context`);
   if(spec.phase==='entry'&&t<=0)assert.equal(calls,0,`${spec.code}: hidden before entry`);
   if(spec.phase==='entry'&&t>=1)assert.equal(calls,1,`${spec.code}: complete identity`);
  }
 }
 assert.equal(m.selectedFrame({in:'pop',idle:'breathe',delay:0,dur:1,amp:50,speed:1},.5),undefined,'legacy motions untouched');
 const cfg={in:'none',idle:'lab-P-L02',delay:0,dur:1,amp:100,speed:1};
 assert.equal(m.selectedPatternOffset(m.selectedFrame(cfg,0),100),0,'pattern starts at rest');
 assert.equal(m.selectedPatternOffset(m.selectedFrame(cfg,2),100),0,'pattern blink does not shift positions');
 m.setCanvasBlurSupportedForTest(true);
 for(const id of ['lab-T-L20','lab-S-L20']){
  // 文字／符號的失焦自己做模糊，不能依賴 Safari 會忽略的 ctx.filter。
  ctx.filter='none';let n=0;m.paintSelectedAnimation(ctx,m.selectedFrame({...cfg,idle:id},2,.4),40,50,()=>n++);
  assert.equal(ctx.filter,'none',`${id} does not rely on canvas filter`);
  assert.equal(n,1,`${id} paints once`);
 }
 assert.ok(m.defocusLevel(2,1,0,1)>.9,'defocus is blurred at t=2');
 ctx.filter='none';let pd=0;
 m.paintSelectedPattern(ctx,m.selectedFrame({...cfg,idle:'lab-P-L20'},2,.4),40,0,0,()=>pd++);
 assert.equal(ctx.filter,'none','pattern defocus does not rely on canvas filter');
 assert.equal(pd,1,'pattern defocus paints once');
 // 失焦：單一目標一個時機；兩個目標兩組；三個以上固定三組，且每組人數平均、相鄰不同組。
 assert.deepEqual(m.defocusGroup(0,1),{group:0,groups:1});
 assert.deepEqual([0,1].map(i=>m.defocusGroup(i,2).group),[0,1]);
 for(const n of [3,5,9,24]){
  const g=Array.from({length:n},(_,i)=>m.defocusGroup(i,n));
  assert.ok(g.every(x=>x.groups===3),'at most three timings');
  assert.equal(new Set(g.map(x=>x.group)).size,3,`${n} targets use all three timings`);
  for(let i=1;i<n;i++)assert.notEqual(g[i].group,g[i-1].group,'neighbours differ');
 }
 // 同一個規律：每組曲線相同，只是錯開 1/組數 週期；並且有完全清楚與完全模糊的時段。
 const P=Math.PI*2/1.5;
 for(const t of [0,.3,1.1,2.2,3.9])assert.ok(Math.abs(m.defocusLevel(t,1,1,3)-m.defocusLevel(t-P/3,1,0,3))<1e-9);
 const samples=Array.from({length:4200},(_,i)=>m.defocusLevel(i/1000,1,0,1));
 assert.equal(m.defocusLevel(0,1,0,1),0,'starts sharp');
 for(let i=1;i<samples.length;i++)assert.ok(Math.abs(samples[i]-samples[i-1])<.01,'no sudden jumps');
 // 對稱：變模糊與變清楚花一樣的時間（以週期中點為鏡像）
 for(const t of [.3,.9,1.7])assert.ok(Math.abs(m.defocusLevel(t,1,0,1)-m.defocusLevel(P-t,1,0,1))<1e-9,'symmetric rise and fall');
 // 跟呼吸同一條曲線：(1−cos)/2，週期 2π/(1.5×速度)
 for(const t of [.37,1.2,2.5,3.9])assert.ok(Math.abs(m.defocusLevel(t,1,0,1)-(1-Math.cos(t*1.5))/2)<1e-9,'defocus follows the breathing curve');
 // 交疊接棒：下一組在上一組還沒完全清楚前就開始模糊。
 for(const G of [2,3]){
  let overlap=false;for(let i=0;i<4200;i++){const t=i/1000;if(m.defocusLevel(t,1,0,G)>.05&&m.defocusLevel(t,1,1,G)>.05)overlap=true;}
  assert.ok(overlap,`${G} groups overlap their hand-off`);
 }
 // 搖晃（取代失焦）：只用位移／旋轉／縮放，連續、從靜止平順帶起、每個單位錯開；圖案的漂移寫在位置裡（發光跟著）
 {const c={in:'none',idle:'lab-S-L20',delay:0,dur:1,amp:100,speed:1};
  assert.equal(m.floatPose(m.selectedFrame(c,0),0,50).dx,0,'float starts at rest');
  let prev=null;for(let i=0;i<4000;i++){const f=m.floatPose(m.selectedFrame(c,i/1000),0,50);
   if(prev)assert.ok(Math.abs(f.dx-prev.dx)<.2&&Math.abs(f.dy-prev.dy)<.2&&Math.abs(f.rot-prev.rot)<.002,'float is continuous');prev=f;}
  const a=m.floatPose(m.selectedFrame(c,3),0,50),b=m.floatPose(m.selectedFrame(c,3),1,50);
  assert.ok(Math.abs(a.dx-b.dx)>1e-3,'units are out of phase');
  const pf=m.selectedFrame({...c,idle:'lab-P-L20'},3);
  assert.ok(Math.abs(m.selectedPatternOffset(pf,100))>1e-3,'pattern float moves the shared position (glow follows)');}
 m.setCanvasBlurSupportedForTest(false);
 let painted=0;const fb={...ctx,getTransform(){return {a:2,b:0};}};
 m.paintSelectedAnimation(fb,m.selectedFrame({...cfg,idle:'lab-T-L20'},2,.4),40,50,()=>painted++);
 assert.equal(painted,1,'fallback still paints once when no canvas filter');
 m.setCanvasBlurSupportedForTest(undefined);
 // 足跡：起始 0 的第一格什麼都不畫，之後依序一顆一顆出現，最後全部出現。
 {const c={in:'lab-S-E04',idle:'none',delay:0,dur:1,amp:50,speed:1};
  const drawn=t=>{const f=m.selectedFrame(c,t);let n=0;for(let i=0;i<5;i++)m.paintSelectedAnimation(ctx,f,40,50,()=>n++,i,5);return n;};
  assert.equal(drawn(0),0,'footprint: nothing on the first frame');assert.equal(drawn(.001),0,'footprint: first step waits one beat');
  assert.equal(drawn(.2),1,'footprint: first step after one beat');assert.equal(drawn(.5),3);assert.equal(drawn(.99),5,'footprint: all steps by the end');}
 // 失焦：連續、沒有停在清楚或模糊的平台。
 {let flat=0;for(let i=1;i<4200;i++){const a=m.defocusLevel(i/1000,1,0,1),b=m.defocusLevel((i-1)/1000,1,0,1);if(Math.abs(a-b)<1e-7)flat++;}
  assert.ok(flat<5,'defocus never holds still');}
 // 拖速度滑桿：相位必須連續，不可整段跳走；時間倒退（重播）則回到純時間。
 {const c={in:'none',idle:'lab-T-L20',delay:0,dur:1,amp:100,speed:1};
  const a=m.selectedFrame(c,10,9.9),b=m.selectedFrame({...c,speed:3},10.001,9.9);
  assert.ok(Math.abs(a.clock*1-b.clock*3)<.01,'phase continuous across speed change');
  const r=m.selectedFrame({...c,speed:3},1,9.9);assert.equal(r.clock,1,'replay resets to pure time');}
 assert.ok(m.selectedPatternGlow(m.selectedFrame({...cfg,idle:'lab-P-L04'},2,.4))>0,'pattern glow animates');
 const uiSources=(await Promise.all(['components/CollageTool.tsx','components/GridLayoutTool.tsx'].map(path=>readFile(path,'utf8')))).join('\n');
 for(const retired of ['lab-T-E01','lab-T-E04','lab-S-E07','lab-S-L02','lab-S-L04','lab-S-L11','lab-S-L18','lab-G-L04','lab-G-L06','lab-G-L11','lab-G-L20'])
  assert.ok(!uiSources.includes(retired),`${retired} is absent from both production panels`);
 assert.ok(uiSources.includes("['fade','淡入l'],['lab-T-E03','淡入ll']"),'text fade pair stays adjacent');
 assert.ok(uiSources.includes("['pop','果凍l'],['lab-T-E07','果凍ll']"),'text jelly pair stays adjacent');
 console.log('17 active animation timelines: context balance, finite transforms, entry boundaries and legacy bypass passed');
} finally {await rm(dir,{recursive:true,force:true});}
