import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {effectDetailIcon} from '../utils/effectDetailIcons.js';

const source=name=>readFileSync(new URL('../components/'+name,import.meta.url),'utf8');

test('effect controls use the user-approved corresponding parameter icons',()=>{
 const editor=source('ImageEditor.tsx');
 for(const [label,icon] of [['強度','blur_on'],['範圍','tonality'],['擴散','flare'],['色相','palette'],['角度','rotate_right'],['顆粒','grain'],['對比','contrast']]){
  assert.equal(effectDetailIcon(label,'unused'),icon);
  assert.ok(editor.includes(`label: '${label}', icon: '${icon}'`),`${label} must already exist in the original editor`);
 }
 assert.equal(effectDetailIcon('色相 A','gradient'),'palette');
 assert.equal(effectDetailIcon('濾鏡','filter'),effectDetailIcon('色相 A','gradient'));
 assert.equal(effectDetailIcon('色相 B','gradient'),'palette');
 assert.equal(effectDetailIcon('方向','explore'),'zoom_out_map');
 assert.equal(effectDetailIcon('長度','straighten'),'straighten');
 for(const [label,icon] of [['色差','filter_b_and_w'],['位移','swap_horiz'],['形狀','shapes'],['密度','apps'],['比例','pie_chart'],['錯誤','broken_image'],['變化','scatter_plot'],['數量','apps'],['抖動','waves'],['掃描線','view_day'],['格數','grid_view'],['折射','filter_b_and_w']])assert.equal(effectDetailIcon(label,'unused'),icon);
});

test('standalone and collage details resolve original sets through the same matching rule',()=>{
 assert.match(source('ImageEditor.tsx'),/effectDetailIcon\(p.label, p.icon\)/);
 assert.equal(source('ImageEditor.tsx').match(/effectDetailIcon\(tool.label, tool.icon\)/g)?.length,3);
 assert.match(source('GridLayoutTool.tsx'),/FX_SUB_TOOLS\[effectCard\]\?\.find\(t=>t\[0\]===key\)\?\.\[2\]/);
 assert.match(source('GridLayoutTool.tsx'),/effectDetailIcon\(label,\s*FX_SUB_TOOLS/);
});
