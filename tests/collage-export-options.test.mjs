import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=ts.transpileModule(read('utils/collageVideoFormat.ts'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {collageVideoMime:mime}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
test('MOV requires a real QuickTime encoder, never a renamed MP4',()=>{
 assert.equal(mime('mov',s=>s==='video/mp4'),'');
 assert.equal(mime('mov',s=>s==='video/quicktime'),'video/quicktime');
 assert.equal(mime('mp4',s=>s==='video/mp4'),'video/mp4');
 assert.equal(mime('auto',s=>s==='video/webm'),'video/webm');
});
test('both collage editors use identical shared export controls and actual encoding settings',()=>{
 const creative=read('components/CollageTool.tsx'),grid=read('components/GridLayoutTool.tsx'),panel=read('components/CollageExportOptions.tsx');
 for(const source of [creative,grid]){assert.match(source,/<CollageExportOptions/);assert.match(source,/collageVideoMime\(videoExportFormat\)/);assert.match(source,/videoBitsPerSecond: videoExportQuality/);assert.match(source,/videoExportFps\|\|preferredVideoFrameRate|videoExportFps\|\|preferredVideoFrameRate|videoExportFps \|\| preferredVideoFrameRate/);}
 for(const text of ['圖片格式','影片格式','影片幀率','影片畫質'])assert.ok(panel.includes(text));
 assert.match(panel,/\['mov','MOV'\]/);assert.doesNotMatch(panel,/WEBM/);
 assert.match(grid,/format=silent\?'png':imageExportFormat/);
 assert.match(grid,/format==='heic'\?await exportHeic/);
});
