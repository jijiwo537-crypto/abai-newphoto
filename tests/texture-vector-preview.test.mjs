import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
test('background textures are logical vectors, not capped or zoom-dependent bitmap layers',()=>{
 const code=read('../components/PatternLayer.tsx');
 assert.match(code,/data-pattern-vector="1"/);
 assert.match(code,/patternUnits="userSpaceOnUse"/);
 assert.match(code,/viewBox=\{`0 0 \$\{w\} \$\{h\}`\}/);
 // 條紋的條數是邏輯單位的 Math.round（不是點陣）；畫布、裝置像素比、預覽縮放都不能出現
 assert.doesNotMatch(code,/canvas|devicePixelRatio|previewScale/);
 assert.ok(!/Math\.round\([^)]*(dpr|scale|zoom)/i.test(code));
 assert.match(read('../components/GridLayoutTool.tsx'),/import \{ PatternLayer \} from '\.\/PatternLayer'/);
});
test('squash is persisted and passed into every classic shape texture renderer',()=>{
 const grid=read('../components/GridLayoutTool.tsx');
 assert.match(grid,/shapeDotSquash\?: number/);
 // 渲染路徑後來增加（遮罩、匯出、預覽各一份），每一份都要帶壓扁
 assert.ok((grid.match(/dotSquash: (?:image|fImg)\.shapeDotSquash/g)||[]).length>=5);
 assert.equal((grid.match(/dotGap: (?:image|fImg)\.shapeDotGap, (?!dotSquash)/g)||[]).length,0);
 assert.match(grid,/patchPattern\(\{ squash: maskTextureSquashFromUi\(v\) \}\)/);
 assert.match(read('../components/CollageTool.tsx'),/dotSquash:maskTextureSquashFromUi\(v\)/);
 assert.match(read('../utils/holeShapes.ts'),/o\.texSquash \?\? o\.dotSquash \?\? 50/);
});
test('shape squash is only offered for dot, star and heart, never none or stripes',()=>{
 for(const file of ['../components/CollageTool.tsx','../components/GridLayoutTool.tsx']){
  const code=read(file);
  assert.match(code,/isGridTex\(tex\) && <div className="col-span-2">\{(?:shapeSlider|slider)\('壓扁'/);
  assert.match(code,/\) : patternType !== 'none' && \(/);
 }
 assert.match(read('../utils/pattern.ts'),/isGridTex = \(t\?: string\) => t === 'dot' \|\| t === 'star' \|\| t === 'heart'/);
});
