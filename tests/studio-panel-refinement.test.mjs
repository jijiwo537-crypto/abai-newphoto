import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('match imports precede option selectors and top-aligned sliders',()=>{
 const s=read('components/ColorMatchStudio.tsx');
 assert.ok(s.indexOf('data-cm-pickref')<s.indexOf('aria-label="仿色方法"'));
 assert.ok(s.indexOf('aria-label="仿色方法"')<s.indexOf('data-cm-slider'));
 assert.match(s,/aria-pressed=\{picked === m\}/);
 assert.match(s,/pt-3 flex-1 min-h-0 flex flex-col justify-start/);
 assert.ok(!s.includes('order-first'));
});
test('match save formats use real full-quality encoding and separate lossless preview',()=>{
 const s=read('components/ColorMatchStudio.tsx');
 assert.match(s,/exportHeic\(canvas\)/);
 assert.match(s,/canvasToUrl\(canvas, 'image\/jpeg', 1\)/);
 assert.match(s,/setFinalPreview\(previewUrl\)/);
 assert.match(s,/<SaveButton urls=\{\[finalUrl\]\}/);
 assert.match(s,/finalPreview \|\| finalUrl/);
 assert.match(s,/disabled=\{format === 'heic' && !canExportHeic\(\)\}/);
 assert.match(s,/h-8 px-2.*more_horiz/);
});
test('art effect choices move up only within their own page',()=>{
 const s=read('components/ArtStudio.css');
 assert.match(s,/\.art-effect-list\{[^}]*padding-bottom:24px;box-sizing:border-box/);
});
test('random pattern feedback uses opaque white and a longer animation',()=>{
 const s=read('components/CollageTool.tsx');
 const block=s.slice(s.indexOf("{transform:'rotate(0deg) scale(1)'",s.indexOf('bottom: motionUiOn ? 76 : 8')),s.indexOf('{/* 動畫頁的播放列'));
 assert.match(block,/duration:680/);
 assert.match(block,/border-0 text-white active:scale-90/);
 assert.ok(!block.includes('opacity:'));
 assert.ok(!block.includes('text-white/40'));
});
