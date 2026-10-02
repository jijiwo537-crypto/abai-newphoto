import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {trackingDefaults} from '../utils/artTracking.js';
import {asciiVector} from '../utils/artVector.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('outline and material selection use arrays without a none button',()=>{
 const s=read('components/ArtStudio.tsx');
 assert.deepEqual(trackingDefaults.shapes,['circle']);assert.deepEqual(trackingDefaults.materials,[]);
 assert.match(s,/value==='none'\?\[\]/);assert.match(s,/s\[key\]\.includes\(value\)/);
 assert.match(s,/\['circle','圓形'\],\['square','方形'\]/);assert.match(s,/\['star','星星'\]/);
 assert.doesNotMatch(s,/\[\['none','無'\],\.\.\.MATERIALS\]/);
 assert.doesNotMatch(s,/菱形|放射|materialStrength|材質強度/);
 assert.match(s,/exportHeic/);assert.match(s,/image\/jpeg/);assert.match(s,/image\/png/);
});
test('export clipping text is directly inside clipPath, with no invisible nested group',()=>{
 const old=globalThis.document;globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(400).fill(255)})})})};
 try{const svg=asciiVector({width:10,height:10},{columns:10,characters:'@',low:0,metric:0,color:false,glow:0});
 assert.match(svg,/<clipPath[^>]*><text/);assert.doesNotMatch(svg,/<clipPath[^>]*><g/);assert.match(svg,/clip-path="url\(#glyph-ink\)"/);
 }finally{globalThis.document=old;}
});
test('preview uses screen-density font outlines with no release-quality switching',()=>{
 const s=read('utils/artVector.js'),gpu=read('utils/artGlyphGpu.js'),css=read('components/ArtStudio.css');
 assert.match(s,/viewport.width\*dpr/);assert.match(s,/viewport.height\*dpr/);assert.match(s,/paintColorGlyphs/);
 assert.doesNotMatch(gpu,/texImage2D[^\n]*,mask\)/);assert.match(gpu,/gl\.DYNAMIC_DRAW/);
 assert.match(css,/left:50%;transform:translateX\(-50%\)/);assert.match(css,/height:70px;padding:3px 12px 19px/);
});
