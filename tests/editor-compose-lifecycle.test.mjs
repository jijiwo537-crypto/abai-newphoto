import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const module=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(read('utils/compose.ts'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
const {DEFAULT_GEO,sameGeoPixels,validGeo}=module;
const copy=()=>structuredClone(DEFAULT_GEO);
test('unchanged composition and aspect-only changes reuse existing pixels',()=>{
 assert.equal(sameGeoPixels(copy(),copy()),true);
 const g=copy();g.aspect='free';assert.equal(sameGeoPixels(DEFAULT_GEO,g),true);
 for(const key of ['quarter','angle','keyV','keyH','zoom']){const c=copy();c[key]++;assert.equal(sameGeoPixels(DEFAULT_GEO,c),false);}
 for(const key of ['flipH','flipV']){const c=copy();c[key]=true;assert.equal(sameGeoPixels(DEFAULT_GEO,c),false);}
 for(const key of ['x','y','w','h']){const c=copy();c.crop[key]+=.01;assert.equal(sameGeoPixels(DEFAULT_GEO,c),false);}
});
test('nonfinite or zero-size geometry cannot enter the pixel pipeline',()=>{
 assert.equal(validGeo(copy()),true);
 for(const value of [NaN,Infinity,-Infinity]){for(const key of ['quarter','angle','zoom']){const g=copy();g[key]=value;assert.equal(validGeo(g),false);}for(const key of ['x','y','w','h']){const g=copy();g.crop[key]=value;assert.equal(validGeo(g),false);}}
 const zero=copy();zero.crop.w=0;assert.equal(validGeo(zero),false);
});
test('obsolete sharpening jobs cannot overwrite the current photo and cancel on unmount',()=>{
 const s=read('components/ImageEditor.tsx');
 assert.match(s,/if \(buffers.current !== ownedBuffers\) return/);
 assert.match(s,/clearTimeout\(sharpenTimerRef.current\)/);
 assert.match(s,/if \(sameGeoPixels\(bufferGeoRef.current, g\)\)/);
 assert.match(s,/if \(initial\) bufferGeoRef.current = DEFAULT_GEO/);
 assert.match(s,/stageInset=\{16\}/);
 assert.match(s,/if \(activeCategory === 'compose'\) return/);
});
