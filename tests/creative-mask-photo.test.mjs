import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../components/CollageTool.tsx',import.meta.url),'utf8');
const body=source.slice(source.indexOf('export const resolveMaskPhotoTransform'),source.indexOf('export const shapePathBox'));
const resolve=new Function('t','iw','ih','fw','fh',body.slice(body.indexOf('=> {')+3,body.lastIndexOf(';')));
test('custom mask legacy crop and resized layout preserve cover without empty edges',()=>{
  const initial=resolve(null,600,800,300,800);
  assert.deepEqual(initial,{x:-150,y:0,w:600,h:800,frameW:300,frameH:800});
  const moved={x:-240,y:-200,w:1200,h:1600,frameW:300,frameH:800};
  assert.deepEqual(resolve(moved,600,800,300,800),moved);
  for(const [w,h] of [[800,600],[200,900],[1200,1200]]){
    const t=resolve(moved,600,800,w,h);
    assert.ok(t.x<=0&&t.y<=0&&t.x+t.w>=w&&t.y+t.h>=h);
    assert.ok(Math.abs(t.w/t.h-600/800)<1e-12);
  }
});
test('custom mask drawing, cache and touch gestures use the same transform',()=>{
  assert.match(source,/maskPhoto\?\.x, maskPhoto\?\.y, maskPhoto\?\.w, maskPhoto\?\.h/);
  assert.match(source,/bCtx.drawImage\(mImg, maskPhoto!\.x \* s, maskPhoto!\.y \* s/);
  assert.match(source,/inMaskPhoto \? 'select_mask'/);
  assert.match(source,/pin.mask \? clampMaskPhoto\(t, o\)/);
  assert.match(source,/d.t = next/);
  assert.match(source,/data-mask-photo-selection/);
});
test('pattern choices have explicit equal height and scrolling reaches panel edges',()=>{
  assert.match(source,/data-pattern-choice=\{s\}[\s\S]*?h-11 min-w-0 overflow-hidden/);
  assert.match(source,/activeTab === 'shape' && !colorPickerTarget \? 'px-5 py-0'/);
  assert.match(source,/data-pattern-panel[\s\S]*?h-full py-5 overflow-y-auto/);
  assert.doesNotMatch(source,/w-11 -mt-5 -mb-5/);
});
test('seamless fusion uses native source pixels and stable SVG geometry without re-encoding on input',()=>{
  const component=readFileSync(new URL('../components/SeamlessLayout.tsx',import.meta.url),'utf8');
  const renderer=readFileSync(new URL('../utils/seamlessLayout.ts',import.meta.url),'utf8');
  // 來源只跟這個版型自己的照片／效果／LUT 有關（不再吃整個編輯器的 revision），融合程度不影響
  assert.match(component,/\},\[sourceKey\]\);/);
  assert.match(component,/const sourceKey=JSON.stringify\(cells.map\(c=>\[c.url,c.fx\|\|\{\},lutReady\(c.fx\)\]\)\)/);
  assert.match(component,/prepareSeamSource\(\{\.\.\.c,fx:undefined\},0\)/);
  assert.doesNotMatch(component,/toBlob|createObjectURL|renderSeamlessLayout\(/);
  assert.match(renderer,/if \(sourceResolution\)/);
  assert.match(renderer,/img.naturalWidth/);
  const gpu=readFileSync(new URL('../utils/seamlessPreview.ts',import.meta.url),'utf8');
  assert.match(gpu,/seamGeometry\(rects,i,w,h,amount\)/);
  assert.match(gpu,/seamImageTransform\(c,source\?\.width/);
  assert.match(component,/data-seamless-master/);
  assert.match(component,/transform:`scale\(\$\{scale\}\)`/);
  assert.match(component,/onPointerUp=\{commit\}/);
  // 拖動中每一格直接把最新值交給預覽（取到 0.01），放開時再交一次正式值
  assert.match(component,/previews.get\(previewId\)\?\.\(Math.round\(latest.current\*100\)\/100,true\)/);
  assert.doesNotMatch(component,/<foreignObject/);
  assert.match(component,/resolveSeamSurface\(points,w,h,width\*scale,height\*scale/);
  assert.match(gpu,/gl.uniform4f/);
  assert.doesNotMatch(gpu,/toBlob|toDataURL/);
  // 只在建立（或來源內容換了 revision）時做色彩轉換，拖動中不會重讀
  assert.match(gpu,/if\(!tex(\|\|this.revisions.get\(image\)!==revision)?\)[\s\S]*getImageData[\s\S]*this.textures.set/,'color conversion is restricted to immutable texture creation');
  const grid=readFileSync(new URL('../components/GridLayoutTool.tsx',import.meta.url),'utf8');
  // 經典拼圖的無縫改由共用的 LayoutPhotoSurface 畫（跟一般版型同一個 GPU 畫面，融合只是參數）
  assert.match(grid,/<LayoutPhotoSurface [^\n]*width=\{lw\} height=\{lh\}[^\n]*geomScale=\{ls\}/);
  assert.match(grid,/fusion=\{stableSeamless \? \(layout.seamlessAmount \?\? 0\) : undefined\}/);
  assert.match(grid,/locked\.scale - ns.*locked\.extent.*<= 7/);
});
