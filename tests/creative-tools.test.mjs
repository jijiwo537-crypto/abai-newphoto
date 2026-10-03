import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const code=ts.transpileModule(read('utils/patternEntrance.ts'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {patternEntranceRanks}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('pattern entrance uses spatial ranks in all four directions and stable random ranks',()=>{
 const holes=[{id:'a',x:0,y:2},{id:'b',x:1,y:1},{id:'c',x:2,y:0}];
 for(const [dir,ids] of [['left-right',['a','b','c']],['right-left',['c','b','a']],['top-bottom',['c','b','a']],['bottom-top',['a','b','c']]]){
  const r=patternEntranceRanks(holes,dir);assert.deepEqual(ids.map(id=>r.get(id)),[0,1,2]);
 }
 assert.deepEqual([...patternEntranceRanks(holes,'random')],[...patternEntranceRanks(holes,'random')]);
 assert.equal(new Set(patternEntranceRanks(holes,'random').values()).size,3);
 const c=read('components/CollageTool.tsx');assert.match(c,/patternEntranceRanks\(holesRef.current,moShape.direction\)/);
 assert.equal((c.match(/ranks.get\(holesRef.current\[i\]\?\.id\)/g)||[]).length,2);
});
test('brush eraser handles palette objects and pinch cancels both kinds of unfinished ink',()=>{
 const c=read('components/CollageTool.tsx');assert.match(c,/brushStamp: true/);
 assert.match(c,/else if \(intr.type === 'brush_object_erase'\)/);
 assert.match(c,/setBrushMode\('eraser'\)/);assert.match(c,/strokeStartObjectsRef.current=|objectsRef.current=strokeStartObjectsRef.current/);
 assert.match(c,/activeTab !== 'motion' && <button/);
});
test('group flash clips to visible artwork with the same alpha and scale checks',()=>{
 const c=read('components/CollageTool.tsx'),flash=c.slice(c.indexOf('const groupFlash ='),c.indexOf('/* 選取框只畫'));
 assert.match(flash,/A.a<=.004 \|\| A.k<=.002/);assert.match(flash,/isHoleFullyInsideMask\(h, s,/);
 assert.match(flash,/ctx.clip\(side==='mask'&&layout===AROUND\?'evenodd':'nonzero'\)/);
});
test('creative export settings are connected to real encoders, track rate and bitrate',()=>{
 const c=read('components/CollageTool.tsx');assert.match(c,/imageExportFormat==='heic'\?await exportHeic/);
 assert.match(c,/imageExportFormat==='jpg'\?'image\/jpeg'/);
 assert.match(c,/captureStream\(videoExportFps \|\| preferredVideoFrameRate\(vids\)\)/);
 assert.match(c,/videoBitsPerSecond: videoExportQuality/);
 assert.match(c,/videoExportFormat==='mp4'\?\['video\/mp4/);
 assert.doesNotMatch(c,/w-px h-4 bg-white\/10 mx-1/);
});
test('floating panels share dark translucent glass while buttons stay opaque',()=>{
 for(const p of ['components/HomePage.tsx','components/ImageEditor.tsx','components/ColorMatchStudio.tsx','components/CollageTool.tsx'])assert.match(read(p),/PREMIUM_GLASS/);
 assert.match(read('utils/premiumGlass.ts'),/rgba\(18,18,20,.82\)/);assert.match(read('components/ArtStudio.css'),/background:rgba\(18,18,20,.82\)/);
 assert.match(read('components/HomePage.tsx'),/premium-glass-button/);
});
