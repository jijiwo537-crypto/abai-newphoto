import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('actual special-character preview uses isolated soft halo, not eight shifted glyphs',()=>{
 const s=read('utils/artGlyphGpu.js');
 assert.match(s,/makeGlyphAtlases/);assert.match(s,/g\.clip\(\)/);assert.match(s,/exp\(-\.5\*x\*x\)/);assert.match(s,/blurGlyphAtlas/);
 assert.match(s,/ink\+soft\*\(1\.-ink\)/);assert.match(s,/vec4\(rgb\*a,a\)/);
 assert.doesNotMatch(s,/angle=float\(i\)|cos\(angle\)|g\.filter=|g\.shadowBlur=/);
 assert.match(s,/if\(s\.key!==key\)/);assert.match(s,/font=cw\*1\.3\*sx/);
});
test('compose freezes the fitted preview before changing footer, without object division',()=>{
 const s=read('components/ImageEditor.tsx');
 assert.match(s,/stageLimit={composeStageLimitRef.current \|\| previewFitSize}/);
 assert.match(s,/const bounds = previewFitRef.current\?\.getBoundingClientRect\(\)/);
 assert.doesNotMatch(s,/\/ previewAspect[;)\s]/);
 const c=read('components/ComposeStudio.tsx');assert.match(c,/Number.isFinite\(stageLimit.width\)/);assert.match(c,/\[x,y,w,h\]\.every\(Number.isFinite\)/);
});
