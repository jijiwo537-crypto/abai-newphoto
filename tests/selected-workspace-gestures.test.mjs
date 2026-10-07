import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('creative photo capture respects selected objects and edits selected cells from anywhere',()=>{
 const s=read('components/CollageTool.tsx');
 const capture=s.slice(s.indexOf('const regionPointerDown='),s.indexOf('const regionPointerMove='));
 assert.match(capture,/otherSelection=.*selectedObjRef.current.*selectedTarget.*baseSelectedRef.current.*maskSelectedRef.current/);
 assert.match(capture,/selectedHasPhoto=selectedRegionPhotoRef.current!==null&&!!photoRegionRef.current\?\.photos\[selectedRegionPhotoRef.current\]\?\.src/);assert.match(capture,/own=.*!otherSelection&&selectedHasPhoto/);
 assert.match(capture,/else if\(!otherSelection\)/);
 assert.doesNotMatch(capture,/selectedRegionPhotoRef.current===source.index/);
 assert.match(s,/regionEditTap.current.moved=true/);
 assert.match(s,/regionEditTap.current\?\.away&&!regionEditTap.current.moved/);
 const pinch=s.slice(s.indexOf('} else if (activePointers.current.size === 2 && !regionScenePinch.current && selectedObjRef.current)'),s.indexOf('} else if (activePointers.current.size === 2 && !regionScenePinch.current && selectedTarget)'));
 assert.ok(pinch.indexOf('flushSync(() => flushMoveNow())')<pinch.indexOf('const oo ='));
});
test('creative base and uploaded mask keep drag ownership outside their bounds',()=>{
 const s=read('components/CollageTool.tsx');
 const start=s.slice(s.indexOf('const handlePointerDown ='),s.indexOf('const beginObjStretch ='));
 assert.match(start,/brushMode==='off'&&offs&&\(baseSelectedRef.current\|\|maskSelectedRef.current\)/);
 assert.ok(start.indexOf('baseDragRef.current={')<start.indexOf('const hitObj ='));
 assert.match(s,/intr.type === 'base_drag' && intr.isClick && !intr.hitItself/);
});
test('crosspage preserves its existing selected-object gesture path',()=>{
 const s=read('components/GridLayoutTool.tsx');
 const scope=s.slice(s.indexOf('const gestureScope ='),s.indexOf('const withGlowInit ='));
 assert.match(scope,/if \(selectedFloatingId\)/);
 assert.match(scope,/return 'floating'/);
 // The creative multi-photo fix must not duplicate or replace its handlers.
 assert.equal((s.match(/onTouchStartCapture=\{activeTab === 'motion'/g)||[]).length,1);
});
