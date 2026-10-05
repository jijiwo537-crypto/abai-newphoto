import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const gl=readFileSync(new URL('../utils/glEffects.ts',import.meta.url),'utf8');
const collage=readFileSync(new URL('../components/CollageTool.tsx',import.meta.url),'utf8');
const panel=readFileSync(new URL('../components/GridLayoutTool.tsx',import.meta.url),'utf8');
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
