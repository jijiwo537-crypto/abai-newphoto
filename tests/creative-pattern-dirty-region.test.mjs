import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../components/CollageTool.tsx',import.meta.url),'utf8');
test('pattern drag coalesces pointer events without lowering preview resolution',()=>{
 const drag=source.slice(source.indexOf("} else if (intr.type === 'move_hole')"),source.indexOf("} else if (intr.type === 'pinch_hole')"));
 assert.match(drag,/queueMove\(\(\) => setHoles/);
 assert.doesNotMatch(drag,/setPreviewScale|motionScaleRef/);
});
test('dirty paint excludes changing scenes and includes both old and new pattern bounds',()=>{
 assert.match(source,/priorPatternPaint\?\.identity === patternSceneIdentity/);
 assert.match(source,/priorPatternPaint\.scale === s/);
 assert.match(source,/const rects=\[old,next,\.\.\.added\]/);
 assert.match(source,/!animRef\.current/);
 assert.match(source,/dirtyPatternRect[\s\S]{0,130}ctx\.clip\(\)/);
 assert.match(source,/lmx\.rect\(r\.x-offs\.mx,r\.y-offs\.my,r\.w,r\.h\)/);
});
