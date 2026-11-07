import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync('components/ColorMatchStudio.tsx','utf8');
const app=fs.readFileSync('App.tsx','utf8');
test('reference import preserves framing and presents GPU content before exposing it',()=>{
 assert.match(source,/setViewT\(\{ k: 1, tx: 0, ty: 0 \}\); \}, \[imageSrc\]\)/);
 assert.match(source,/useLayoutEffect\(\(\) => \{\s*const gl = glRef.current/);
 // GPU 畫布不放進畫面：先畫好、確認成功才交給 present()
 assert.ok(source.indexOf('glReadyRef.current = gl.draw(')>0);
 assert.ok(source.indexOf('glReadyRef.current = gl.draw(')<source.indexOf('if (glReadyRef.current) present();'));
 assert.doesNotMatch(source,/inset-0[^"\n]*bg-black\/45/);
 // 強度上限：標準 100、專業 150
 assert.match(source,/const maxFor = \(m: Pick\) => \(m === 'cap' \? 150 : 100\)/);
 assert.match(app,/if \(currentView !== 'match'\) \{ setMatchRef\(null\)/);
 const refImport=app.slice(app.indexOf('const handleMatchRefChange'),app.indexOf('const handleMatchRefChange')+900);
 assert.doesNotMatch(refImport,/setIsImporting\(/);
 assert.match(refImport,/setMatchReferenceLoading\(true\)/);
});
test('match uses the shared save/cancel prompt and persists the reference photograph',()=>{
 assert.match(source,/const choice=onRequestExit\?await onRequestExit\(\)/);
 assert.match(source,/saveDraft\('match',imageSrc,matchState\(\)\)/);
 assert.match(app,/draft.tool === 'match'/);
 assert.match(app,/setMatchRef\(draft.state\?\.referenceSrc \?\? null\)/);
 const drafts=fs.readFileSync('utils/toolDraft.ts','utf8');
 assert.equal((drafts.match(/key === 'referenceSrc'/g)||[]).length,2);
});
