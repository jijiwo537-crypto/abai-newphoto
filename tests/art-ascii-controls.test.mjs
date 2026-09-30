import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('ASCII starts with white characters over the photo',()=>{
 const s=read('utils/asciiRenderer.ts');assert.match(s,/color:false,background:true,glow:0/);
});
test('dark detection reverses luminance before character mapping',()=>{
 const s=read('utils/asciiRenderer.ts');assert.match(s,/metric>2\.5\)\{v=1\.-v;/);assert.match(s,/ink=.*gate/);
});
test('art controls expose glow and pinch zoom without invert or a header title',()=>{
 const s=read('components/ArtStudio.tsx');assert.match(s,/range\('發光','glow',0,100\)/);assert.match(s,/TransformWrapper/);assert.match(s,/'暗部'/);assert.doesNotMatch(s,/反轉字符|<span>藝術效果<\/span>/);
});
test('GPU effects retain a single visible presentation canvas',()=>{
 const s=read('components/ImageEditor.tsx');const f=s.slice(s.indexOf('const showFxSurface='),s.indexOf('const visibleEditorCanvas='));assert.match(f,/fxSurfaceShownRef.current=false/);assert.match(f,/ctx.setTransform\(1,0,0,1,0,0\)/);assert.match(f,/ctx.drawImage\(surface,0,0,display.width,display.height\)/);assert.doesNotMatch(f,/visibility=.*visible/);
});
