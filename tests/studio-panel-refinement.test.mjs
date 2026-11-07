import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('match panel follows the filter-style layout: floating methods, one slider, then the reference row',()=>{
 const s=read('components/ColorMatchStudio.tsx');
 // 兩個方案浮在預覽左下角；下面一根滑桿；最底下一排參考圖（最左邊是新增）
 const methods=s.indexOf('aria-label="仿色方法"'),slider=s.indexOf('data-cm-slider'),add=s.indexOf('data-cm-pickref'),ref=s.indexOf('data-cm-ref=');
 assert.ok(methods>0&&slider>0&&add>0&&ref>0);
 assert.ok(methods<slider&&slider<add&&add<ref);
 assert.match(s,/aria-label="仿色方法" data-cm-float/);
 assert.match(s,/aria-pressed=\{picked === m\}/);
 // 沒有任何參考圖時不出現方案按鈕
 assert.match(s,/\{refs\.length > 0 && <div role="group" aria-label="仿色方法"/);
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
 const block=s.slice(s.indexOf("{transform:'rotate(0deg) scale(1)'",s.indexOf('bottom: motionUiOn ? 76 : 0')),s.indexOf('{/* 動畫頁的播放列'));
 assert.match(block,/duration:680/);
 assert.match(block,/border-0 text-white active:scale-90/);
 assert.ok(!block.includes('opacity:'));
 assert.ok(!block.includes('text-white/40'));
});
test('creative reset sits lower without moving animation playback controls',()=>{
 const s=read('components/CollageTool.tsx');
 assert.match(s,/bottom: motionUiOn \? 76 : 0/);
 assert.match(s,/p-3 bg-transparent border-0 text-white/);
});
