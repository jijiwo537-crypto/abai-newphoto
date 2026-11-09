import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
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
  ['lab-T-L01','呼吸'],['lab-T-L04','閃爍'],['lab-T-L15','波浪ll'],['lab-T-L20','失焦'],
  ['lab-S-E03','淡入'],['lab-S-E04','足跡'],['lab-S-E10','旋轉'],
  ['lab-S-L01','呼吸'],['lab-S-L03','搖擺'],['lab-S-L07','翻面'],['lab-S-L20','失焦'],
  ['lab-P-L02','閃爍'],['lab-P-L04','發光'],['lab-P-L07','翻面'],['lab-P-L20','失焦'],
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
 for(const id of ['lab-T-L20','lab-S-L20']){
  ctx.filter='none';m.paintSelectedAnimation(ctx,m.selectedFrame({...cfg,idle:id},2,.4),40,50,()=>{});
  assert.match(ctx.filter,/blur\([1-9]/,`${id} has visible defocus`);
 }
 ctx.filter='none';
 m.applySelectedPatternAppearance(ctx,m.selectedFrame({...cfg,idle:'lab-P-L20'},2,.4),40,0,0);
 assert.match(ctx.filter,/blur\([1-9]/,'pattern defocus is visible');
 assert.ok(m.selectedPatternGlow(m.selectedFrame({...cfg,idle:'lab-P-L04'},2,.4))>0,'pattern glow animates');
 console.log('17 active animation timelines: context balance, finite transforms, entry boundaries and legacy bypass passed');
} finally {await rm(dir,{recursive:true,force:true});}
