import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const requests=[];
globalThis.Image=class {set src(url){requests.push(url);queueMicrotask(()=>{this.naturalWidth=512;this.onload()})}};
const source=fs.readFileSync(new URL('../utils/cameraLuts.ts',import.meta.url),'utf8');
const {loadCameraLut,readyCameraLut,warmCameraLuts}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
test('preload decodes every LUT once and selection returns the same ready image',async()=>{
 await Promise.all([warmCameraLuts(['','f1','f2','f1','f3']),loadCameraLut('f1')]);
 assert.deepEqual(requests.sort(),['f1','f2','f3']);
 for(const url of requests)assert.equal(await loadCameraLut(url),readyCameraLut(url));
 assert.equal(requests.length,3);
});
