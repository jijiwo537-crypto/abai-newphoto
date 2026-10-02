import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import ts from 'typescript';

const source=readFileSync(new URL('../utils/beauty/engine.ts',import.meta.url),'utf8');
const original=execFileSync('git',['show','5eaab4c:utils/beauty/engine.ts'],{encoding:'utf8'});
const load=async code=>import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
const [engine,previous]=await Promise.all([load(source),load(original)]);
const image=(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)});
const W=193,H=257,src=image(W,H);
for(let i=0;i<src.data.length;i++)src.data[i]=(i*37+(i%7)*19)%256;
for(const mode of ['push','bloat','pucker','restore']){
 const f=engine.createLiquifyField(W,H),old=previous.createLiquifyField(W,H);
 for(let k=0;k<15;k++){
  const args=[80,120,15,-9,48,.7,'push'];
  engine.liquifyDab(f,...args);previous.liquifyDab(old,...args);
 }
 for(let k=0;k<120;k++){
  const args=[33+k%113,29+k%177,Math.sin(k)*7,Math.cos(k)*9,22+k%61,.37,mode];
  engine.liquifyDab(f,...args);previous.liquifyDab(old,...args);
 }
 assert.deepEqual(f.data,old.data,`${mode}: identical displacement field`);
 const a=image(W,H),b=image(W,H),rect={x:0,y:0,w:W,h:H};
 engine.warpRegion(src,W,H,f,a,rect);previous.warpRegion(src,W,H,old,b,rect);
 assert.deepEqual(a.data,b.data,`${mode}: identical full-quality pixels`);
 const rect2={x:11,y:19,w:89,h:107},larger=image(130,150),tight=image(89,107);
 engine.warpRegion(src,W,H,f,larger,rect2);previous.warpRegion(src,W,H,f,tight,rect2);
 for(let y=0;y<rect2.h;y++)assert.deepEqual(larger.data.slice(y*130*4,(y*130+89)*4),tight.data.slice(y*89*4,(y+1)*89*4),'reused buffer stride');
 // Backward warping changes only the brush domain plus field interpolation cells.
 const before=image(W,H),after=image(W,H);
 engine.warpRegion(src,W,H,f,before,rect);
 const cx=79.2,cy=112.8,R=37.3;
 engine.liquifyDab(f,cx,cy,7,-6,R,.6,mode);
 engine.warpRegion(src,W,H,f,after,rect);
 const e=Math.ceil(R+2*engine.LIQUIFY_SCALE+2);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(x<cx-e||x>cx+e||y<cy-e||y>cy+e){
  const i=(y*W+x)*4;assert.deepEqual(after.data.slice(i,i+4),before.data.slice(i,i+4),'dirty region includes every changed pixel');
 }
}
assert.equal(engine.DEFAULT_BRUSH.liquify,150);
const beauty=readFileSync(new URL('../components/BeautyStudio.tsx',import.meta.url),'utf8');
assert.match(beauty,/id: 'slim'.*brush: 150/);
assert.match(beauty,/data-beauty-toolbar/);
assert.match(beauty,/useStandaloneToolViewport/);
assert.match(beauty,/beauty-swatch-outline.*viewBox="0 0 32 32"/);
const viewport=readFileSync(new URL('../utils/useStandaloneToolViewport.ts',import.meta.url),'utf8');
assert.match(viewport,/standalone.*===true/);
assert.match(viewport,/height:auto!important;max-height:none!important;margin-top:0/);
assert.match(viewport,/bottom:calc\(-1 \* \(env\(safe-area-inset-top/);
assert.match(viewport,/removeEventListener\('resize',align\)/);
console.log('PASS: four modes, byte-identical warping, buffer reuse, exact dirty coverage, default brush 150');
