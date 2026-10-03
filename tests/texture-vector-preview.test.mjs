import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
test('background textures are logical vectors, not capped or zoom-dependent bitmap layers',()=>{
 const code=read('../components/PatternLayer.tsx');
 assert.match(code,/data-pattern-vector="1"/);
 assert.match(code,/patternUnits="userSpaceOnUse"/);
 assert.match(code,/viewBox=\{`0 0 \$\{w\} \$\{h\}`\}/);
 assert.doesNotMatch(code,/canvas|devicePixelRatio|Math\.round|previewScale/);
 assert.match(read('../components/GridLayoutTool.tsx'),/import \{ PatternLayer \} from '\.\/PatternLayer'/);
});
test('squash is persisted and passed into every classic shape texture renderer',()=>{
 const grid=read('../components/GridLayoutTool.tsx');
 assert.match(grid,/shapeDotSquash\?: number/);
 assert.equal((grid.match(/dotSquash: (?:image|fImg)\.shapeDotSquash/g)||[]).length,5);
 assert.match(grid,/patchPattern\(\{ squash: maskTextureSquashFromUi\(v\) \}\)/);
 assert.match(read('../components/CollageTool.tsx'),/dotSquash:maskTextureSquashFromUi\(v\)/);
 assert.match(read('../utils/holeShapes.ts'),/o\.texSquash \?\? o\.dotSquash \?\? 50/);
});
