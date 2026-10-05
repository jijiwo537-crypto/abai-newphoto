import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const gl=readFileSync(new URL('../utils/glEffects.ts',import.meta.url),'utf8');
const collage=readFileSync(new URL('../components/CollageTool.tsx',import.meta.url),'utf8');
const panel=readFileSync(new URL('../components/GridLayoutTool.tsx',import.meta.url),'utf8');
test('a chosen LUT at zero intensity does not run an unnecessary photo pipeline',()=>{
 const fx=readFileSync(new URL('../utils/photoFx.ts',import.meta.url),'utf8');
 const body=fx.slice(fx.indexOf('export const hasPhotoFx ='),fx.indexOf('/* ── LUT 載入'));
 const code=body.replace(/export /g,'').replace(/\(fx\?: PhotoFx\)/,'(fx)');
 const active=new Function('ADJUST_KEYS','hasActiveFx',code+';return hasPhotoFx;')([['bright','亮度']],()=>false);
 assert.equal(active({lut:'f3',lutAmount:0}),false);
 assert.equal(active({lut:'f3',lutAmount:1}),true);
 assert.equal(active({lut:'f3',lutAmount:0,bright:1}),true);
 assert.equal(active({lut:'f3'}),true);
});
test('scene photo result excludes geometry but tracks effect and colour changes',()=>{
 assert.match(gl,/const photoKey=sourceKey\?`\$\{sourceKey\}\|\$\{w\}x\$\{h\}\|\$\{JSON.stringify\(params\)\}`/);
 assert.match(gl,/photoResult\.full===colour\?\.full/);
 assert.match(gl,/photoResult\.plain===colour\?\.plain/);
 assert.match(gl,/photoResult\.amount===colour\?\.amount/);
 assert.match(gl,/composeFxScene\(gl,c\.photoResult\.texture,scene\)/);
 assert.match(gl,/c\.photoResult=undefined/);
});
test('unchanged native photo cache returns before effect endpoint preparation',()=>{
 assert.match(collage,/if \(hit && hit.key === key\) return hit.cv;/);
});
test('cards share bounded thumbnail sources and preload before effects tab',()=>{
 assert.match(panel,/FX_ROOT_TOOLS/);
 assert.match(panel,/cardSourceThumbCache.get\(img.src\)/);
 assert.match(panel,/cardSourceThumbCache.size>=20/);
 assert.match(panel,/old.width=old.height=1/);
});
test('leaving base editing releases unused scene storage even with photo zero present',()=>{
 assert.match(collage,/if\(!objEditImage\)\{[\s\S]*compactPhotoFxSurface\(resident.input\)/);
 assert.doesNotMatch(collage,/if\(!objEditImage&&selectedKey===null\)/);
});
test('live seamless editing does not synchronously snapshot every effect click',()=>{
 assert.match(collage,/!photoRegionRef.current\?\.seamless\|\|!selectedBase\|\|prepareNative/);
 assert.match(collage,/result.dataset.seamRevision=key/);
});
test('wheel zoom holds background photo work until the gesture commits',()=>{
 assert.match(collage,/wheelPhotoReleaseRef.current\?\?=holdPhotoInteraction\(\)/);
 assert.match(collage,/flushView\(true\);wheelPhotoReleaseRef.current\?\.\(\)/);
});
test('seam GPU capability and uniform queries are cached outside the hot path',()=>{
 const seam=readFileSync(new URL('../utils/seamlessPreview.ts',import.meta.url),'utf8');
 assert.match(seam,/this.maxTextureUnits=gl.getParameter/);
 assert.match(seam,/if\(count>this.maxTextureUnits\)/);
 assert.match(seam,/if\(!locations!.has\(name\)\)/);
 assert.equal((seam.match(/gl.getParameter\(/g)||[]).length,1);
});
