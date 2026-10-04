import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('every image editor shares mosaic and glass brick without positional omissions',()=>{
 const defs=read('../utils/glEffects.ts');
 assert.match(defs,/id: 'fxMosaic', label: '馬賽克'/);
 assert.match(defs,/id: 'fxGlass', label: '玻璃磚'/);
 assert.doesNotMatch(defs,/fxCrystal|結晶化/);
 for(const file of ['../components/ImageEditor.tsx','../components/GridLayoutTool.tsx']){
  const editor=read(file);
  assert.match(editor,/FX_DEFS.filter\(d => d.id !== 'fxSharpen'\)/);
  assert.doesNotMatch(editor,/slice\(0, -3\)|fxCrystal/);
 }
 assert.match(read('../components/CollageTool.tsx'),/ImageAdjustPanel/);
});
