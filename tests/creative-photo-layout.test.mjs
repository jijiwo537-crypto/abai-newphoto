import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../utils/creativePhotoLayout.ts',import.meta.url),'utf8');
const catalog=ts.transpileModule(readFileSync(new URL('../utils/layoutTemplates.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace("'./layoutTemplates'",`'data:text/javascript;base64,${Buffer.from(catalog).toString('base64')}'`);
const {photoRegionRects,photoRegionHit,swapRegionPhotos,paintPhotoRegion,PHOTO_SWAP_HOLD_MS,regionRects,photoTemplates,changePhotoTemplate,photoCrop}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
test('all four arrangements fill exactly one region, in import order, for 2 through 9 photos',()=>{
 for(const mode of ['grid','horizontal','vertical','feature'])for(let n=1;n<=9;n++){
  const rects=photoRegionRects(n,mode); assert.equal(rects.length,n);
  assert.ok(Math.abs(rects.reduce((sum,r)=>sum+r.w*r.h,0)-1)<1e-12);
  rects.forEach((r,i)=>{assert.equal(photoRegionHit(rects,r.x+r.w/2,r.y+r.h/2),i);
   assert.ok(r.x>=0&&r.y>=0&&r.x+r.w<=1+1e-12&&r.y+r.h<=1+1e-12);
   rects.slice(i+1).forEach(b=>assert.ok(Math.min(r.x+r.w,b.x+b.w)-Math.max(r.x,b.x)<1e-12||Math.min(r.y+r.h,b.y+b.h)-Math.max(r.y,b.y)<1e-12));});
 }
 assert.equal(photoRegionRects(20).length,9);
 assert.equal(photoRegionHit(photoRegionRects(9),-0.01,.5),-1);
});
test('swapping is immutable, preserves the layout and first-import orientation, and ignores cancelled drops',()=>{
 const region={photos:Array.from({length:9},(_,i)=>({src:`p${i}`,width:900,height:600})),arrangement:'grid',landscape:true};
 const next=swapRegionPhotos(region,0,8);assert.equal(next.photos[0].src,'p8');assert.equal(next.photos[8].src,'p0');assert.equal(region.photos[0].src,'p0');
 assert.equal(next.landscape,true);assert.equal(swapRegionPhotos(region,0,-1),region);
 assert.equal(PHOTO_SWAP_HOLD_MS,380*.8);
});
test('painting uses the original decoded images, exact shared boundaries and cover crops without a temporary composite',()=>{
 const region={photos:[{src:'a',width:1200,height:800},{src:'b',width:800,height:1200}],arrangement:'horizontal'},images=new Map([['a',{}],['b',{}]]),calls=[];
 const ctx={canvas:{width:1000,height:1000},globalCompositeOperation:'copy',save(){},restore(){},setTransform(){},clearRect(){},drawImage(...args){calls.push(args)}};
 paintPhotoRegion(ctx,region,images,17.3,29.8,309.71,411.09);
 assert.equal(calls.length,2);assert.equal(calls[0][0],images.get('a'));assert.equal(calls[1][0],images.get('b'));
 assert.ok(Math.abs(calls[0][5]+calls[0][7]-calls[1][5])<1e-12);
 assert.equal(ctx.globalCompositeOperation,'copy');assert.ok(calls[0][3]<1200);
});
test('imports, gestures, drafts and readonly IG statistics are wired into the mounted tools',()=>{
 const app=readFileSync(new URL('../App.tsx',import.meta.url),'utf8'),creative=readFileSync(new URL('../components/CollageTool.tsx',import.meta.url),'utf8'),grid=readFileSync(new URL('../components/GridLayoutTool.tsx',import.meta.url),'utf8'),ig=readFileSync(new URL('../components/IgPreview.tsx',import.meta.url),'utf8');
 assert.match(app,/handleImportToCollage[\s\S]*?\.slice\(0, 9\)/);assert.match(creative,/slice\(0, CREATIVE_PHOTO_LIMIT\)/);assert.doesNotMatch(creative,/pendingExtrasRef/);
 assert.match(creative,/photoRegion\?\.landscape \? landscape : portrait/);assert.match(creative,/onPointerDownCapture=\{regionPointerDown\}/);
 assert.match(creative,/if\(second\)cancelRegionHold\(\)/);assert.match(creative,/photoRegion: photoRegionRef.current/);assert.match(creative,/loadRegion\(st.photoRegion\)/);
 assert.match(grid,/const LONG_PRESS_MS = 304/);assert.doesNotMatch(grid,/border-2 border-white\/80/);
 const stat=ig.slice(ig.indexOf('const statInput'),ig.indexOf('/* 這裡本來有一顆右下角'));
 assert.match(stat,/<span/);assert.doesNotMatch(stat,/<input|inputMode|onChange=|contentEditable/);
 assert.match(grid,/data-layout-empty-surface="1"/);assert.match(grid,/The outer perimeter is not a grid line/);
 assert.match(grid,/backfaceVisibility: stableSeamless \|\| nativeLayout \? undefined/);
 assert.match(grid,/willChange: stableSeamless \|\| nativeLayout \? undefined/);
 assert.match(grid,/strokeWidth=\{emptyFillsPage \? 2 : 0\}/);
});
test('template picker shares cross-page geometry, retains unused originals and supports empty cells',()=>{
 const region={photos:[{src:'a',width:900,height:600},{src:'b',width:900,height:600}],arrangement:'grid',templateIndex:0,landscape:true};
 const expanded=changePhotoTemplate(region,4,0);
 assert.deepEqual(expanded.photos.map(p=>p.src),['a','b','','']);
 const small=changePhotoTemplate(expanded,1,0),back=changePhotoTemplate(small,4,0);
 assert.deepEqual(back.photos.map(p=>p.src),['a','b','','']);
 for(let n=2;n<=9;n++)assert.ok(photoTemplates(n).length>=4);
 const squares=changePhotoTemplate(region,4,photoTemplates(4).length-1),rects=regionRects(squares,300,500);
 assert.ok(Math.abs(rects[2].w*300-rects[2].h*500)<1e-10);
 assert.equal(photoRegionHit(rects,.5,.25),2);
});
test('individual pan and zoom affect only the chosen source crop',()=>{
 const a={src:'a',width:1200,height:800},b={...a,src:'b',zoom:2,offsetX:.2};
 assert.deepEqual(photoCrop(a,300,300),{sx:200,sy:0,sw:800,sh:800});
 const crop=photoCrop(b,300,300);assert.equal(crop.sw,400);assert.equal(crop.sx,320);
 assert.deepEqual(photoCrop(a,300,300),{sx:200,sy:0,sw:800,sh:800});
 const src=readFileSync(new URL('../components/CollageTool.tsx',import.meta.url),'utf8');
 assert.match(src,/createPortal\(<canvas ref=\{regionThumbRef\}/);
 assert.match(src,/swapPhotos\(hold.source,target\)/);
 assert.match(src,/regionTouches.current.set\(e.pointerId,\{x:p.x,y:p.y\}\);resetRegionGesture\(\)/);
});
