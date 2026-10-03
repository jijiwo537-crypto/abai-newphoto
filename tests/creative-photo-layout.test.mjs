import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../utils/creativePhotoLayout.ts',import.meta.url),'utf8');
const catalog=ts.transpileModule(readFileSync(new URL('../utils/layoutTemplates.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace("'./layoutTemplates'",`'data:text/javascript;base64,${Buffer.from(catalog).toString('base64')}'`);
const {photoRegionRects,photoRegionHit,swapRegionPhotos,paintPhotoRegion,PHOTO_SWAP_HOLD_MS,regionRects,photoTemplates,quickPhotoTemplateIndices,changePhotoTemplate,photoCrop,PHOTO_LAYOUT_COUNTS,dimmedPhotoSource,clearPhotoDimmer,seamlessPhotoBase}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
test('picker preserves shared cross-page templates and appends four creative-only overlays',async()=>{
 const {TEMPLATE_MAP}=await import(`data:text/javascript;base64,${Buffer.from(catalog).toString('base64')}`);
 assert.deepEqual(PHOTO_LAYOUT_COUNTS,[2,3,4,5,6,7,8,9,10]);
 for(const n of PHOTO_LAYOUT_COUNTS){assert.deepEqual(photoTemplates(n).slice(0,TEMPLATE_MAP[n].length),TEMPLATE_MAP[n]);assert.equal(photoTemplates(n).length,TEMPLATE_MAP[n].length+(n===3?3:n===4?1:0));}
 const region={photos:[{src:'a',width:900,height:600}],arrangement:'grid'};
 assert.equal(changePhotoTemplate(region,10,0).photos.length,10);
 assert.equal(changePhotoTemplate(region,1,0).photos.length,2);
});
test('new overlays remain centered and physically 1:1 or landscape 4:3 on every canvas',()=>{
 for(const [n,name,aspect,sides] of [[3,'上層方形',1,[.25]],[3,'上層橫式',4/3,[.25]],[3,'下層橫式',4/3,[.75]],[4,'上下雙層橫式',4/3,[.25,.75]]]){
  const region={photos:Array.from({length:n},(_,i)=>({src:'p'+i,width:900,height:600})),arrangement:'grid',templateIndex:photoTemplates(n).findIndex(t=>t.name===name),seamless:true,seamlessAmount:70};
  for(const [w,h]of [[300,400],[800,300],[600,600]]){
   const r=regionRects(region,w,h);assert.equal(r.length,n);
   r.slice(2).forEach((cell,i)=>{assert.ok(Math.abs(cell.w*w/(cell.h*h)-aspect)<1e-10);assert.ok(Math.abs(cell.x+cell.w/2-.5)<1e-10);assert.ok(Math.abs(cell.y+cell.h/2-sides[i])<1e-10);});
  }
  const base=seamlessPhotoBase(region);assert.equal(base.photos.length,2);assert.equal(base.seamlessAmount,70);assert.deepEqual(regionRects(base),[{x:0,y:0,w:1,h:.5},{x:0,y:.5,w:1,h:.5}]);assert.equal(region.photos.length,n);
 }
});
test('dark feedback uses one full-resolution RGB cache, preserving alpha and original image',()=>{
 const fills=[],draws=[],ctx={globalCompositeOperation:'source-over',drawImage(...args){draws.push(args)},fillRect(...args){fills.push({op:this.globalCompositeOperation,color:this.fillStyle,args})}};
 let allocations=0;globalThis.document={createElement(){allocations++;return {width:0,height:0,getContext(){return ctx}}}};
 try{
  const image={naturalWidth:4096,naturalHeight:3072},a=dimmedPhotoSource(image),b=dimmedPhotoSource(image);
  assert.equal(a,b);assert.equal(allocations,1);assert.equal(draws.length,1);
  assert.deepEqual([a.width,a.height],[4096,3072]);assert.equal(draws[0][0],image);
  assert.equal(fills[0].op,'source-atop');assert.equal(fills[0].color,'rgba(0,0,0,.65)');
  assert.equal(ctx.globalCompositeOperation,'source-over');clearPhotoDimmer();assert.equal(a.width,1);
 }finally{delete globalThis.document;}
});
test('four-photo shortcut ends with the cross-page special overlay without changing catalog indices',()=>{
 assert.deepEqual(quickPhotoTemplateIndices(4),[0,1,2,5]);assert.equal(photoTemplates(4)[quickPhotoTemplateIndices(4)[3]].name,'上下雙層方形');
 const c=readFileSync(new URL('../components/CollageTool.tsx',import.meta.url),'utf8');
 assert.match(c,/aria-label="所有圖片佈局"[\s\S]*?<circle cx="5"/);assert.match(c,/aria-label="返回圖片排版"/);
 assert.match(c,/absolute inset-0 z-\[61\]/);assert.doesNotMatch(c,/max-h-56.*data-photo-layout-options/);
 assert.match(c,/if\(JSON.stringify\(hover\)!==JSON.stringify\(swapHoverRef.current\)\)/);
 assert.match(c,/region.photos.map\([\s\S]*?offsetX,offsetY\}:q\)\},true\)/);
});
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
 const small=changePhotoTemplate(expanded,2,0),back=changePhotoTemplate(small,4,0);
 assert.deepEqual(back.photos.map(p=>p.src),['a','b','','']);
 for(let n=2;n<=10;n++)assert.ok(photoTemplates(n).length>0);
 const squares=changePhotoTemplate(region,4,photoTemplates(4).findIndex(t=>t.name==='上下雙層方形')),rects=regionRects(squares,300,500);
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
