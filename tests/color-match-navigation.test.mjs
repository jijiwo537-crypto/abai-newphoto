import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync('components/ColorMatchStudio.tsx','utf8');
const app=fs.readFileSync('App.tsx','utf8');
test('reference import preserves framing and presents GPU content before exposing it',()=>{
 assert.match(source,/setViewT\(\{ k: 1, tx: 0, ty: 0 \}\); \}, \[imageSrc\]\)/);
 assert.match(source,/useLayoutEffect\(\(\) => \{\s*const gl = glRef.current/);
 assert.ok(source.indexOf('glReadyRef.current = gl.draw(')<source.indexOf("gl.canvas.classList.toggle('hidden', !glReadyRef.current)"));
 assert.doesNotMatch(source,/inset-0[^"\n]*bg-black\/45/);
 assert.match(source,/setStrength, 150/);
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
