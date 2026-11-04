import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../components/CollageTool.tsx',import.meta.url),'utf8');
test('pattern drag coalesces pointer events without lowering preview resolution',()=>{
 const drag=source.slice(source.indexOf("} else if (intr.type === 'move_hole')"),source.indexOf("} else if (intr.type === 'pinch_hole')"));
 assert.match(drag,/queueMove\(\(\) => \{ liveHolesRef\.current = /);
 assert.match(drag,/livePatternPaintRef\.current\(\)/);
 assert.doesNotMatch(drag,/setHoles/);
 assert.doesNotMatch(drag,/setPreviewScale|motionScaleRef/);
});
test('dirty paint excludes changing scenes and includes both old and new pattern bounds',()=>{
 assert.match(source,/priorPatternPaint\?\.identity === patternSceneIdentity/);
 assert.match(source,/priorPatternPaint\.scale === s/);
 assert.match(source,/const rects=\[old,next,\.\.\.added\]/);
 assert.match(source,/!animRef\.current/);
 assert.match(source,/if\(dirtyPatternRect\)\{[\s\S]{0,260}Math\.floor\(r\.x\*rasterX-vp\.x\)[\s\S]{0,200}ctx\.clip\(\)/);
 // 遮罩畫布的局部裁切框對齊到它自己的像素格（同樣扣掉 offs，含舊框與新框）
 assert.match(source,/if\(dirtyPatternRect\)\{const r=dirtyPatternRect,tx=maskGuard-maskX-offs\.mx,ty=maskGuard-maskY-offs\.my;[\s\S]{0,200}lmx\.rect\(x0,y0,x1-x0,y1-y0\);lmx\.clip\(\)/);
});
