import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const src=readFileSync(new URL('../utils/creativePhotoLayout.ts',import.meta.url),'utf8');
const fn=src.match(/export function creativePatternCountForLayout\([\s\S]*?\n\}/)[0];
const js=ts.transpileModule(fn,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {creativePatternCountForLayout:count}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
test('full-layout transitions always preserve the chosen pattern count',()=>{
 assert.equal(count(6,'mask-bottom','image-full'),6);
 assert.equal(count(9,'image-full','mask-top'),9);
 assert.equal(count(21,'mask-bottom','image-full'),21);
 assert.equal(count(30,'image-full','mask-top'),30);
 assert.equal(count(0,'mask-bottom','image-full'),0);
 assert.equal(count(9,'image-full','image-full'),9);
 assert.equal(count(9,'mask-bottom','mask-top'),9);
});
