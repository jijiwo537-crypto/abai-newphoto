import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('comparison release restores the displayed GPU surface, not only hidden 2D',()=>{
 const code=readFileSync(new URL('../components/ImageEditor.tsx',import.meta.url),'utf8');
 const restore=code.slice(code.indexOf('} else if (!isDirtyRef.current && compareSnapRef.current'),code.indexOf('if (isDirtyRef.current || flipped)'));
 assert.match(restore,/drawImage\(compareSnapRef.current/);
 assert.match(restore,/presentEditorSource\(dctx, b.w, b.h\)/);
});
test('early touch cannot suspend blend preparation until finger release',()=>{
 const code=readFileSync(new URL('../utils/photoAdjustmentBlend.ts',import.meta.url),'utf8');
 assert.doesNotMatch(code,/if\(this.held\).*setTimeout\(build/);
 assert.match(code,/if\(generation!==this.generation\)return/);
});
test('base editing reuses full-density effect surfaces without forced CPU processing',()=>{
 const code=readFileSync(new URL('../components/CollageTool.tsx',import.meta.url),'utf8');
 assert.match(code,/regionFxSurfaces.current.get\(o.id\)/);
 assert.match(code,/cacheSource: !isVid, fast: live, out: reuse/);
 assert.doesNotMatch(code,/preferSeparableCpu: o.id/);
});
