import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {effectDetailIcon} from '../utils/effectDetailIcons.js';

const source=name=>readFileSync(new URL('../components/'+name,import.meta.url),'utf8');

test('new effect controls reuse the existing corresponding editor icons',()=>{
 const editor=source('ImageEditor.tsx');
 for(const [label,icon] of [['強度','blur_on'],['範圍','tonality'],['擴散','flare'],['色相','palette'],['角度','rotate_right'],['顆粒','grain'],['對比','contrast']]){
  assert.equal(effectDetailIcon(label,'unused'),icon);
  assert.ok(editor.includes(`label: '${label}', icon: '${icon}'`),`${label} must already exist in the original editor`);
 }
 assert.equal(effectDetailIcon('色相 A','gradient'),'palette');
 assert.equal(effectDetailIcon('色相 B','gradient'),'palette');
 assert.equal(effectDetailIcon('方向','explore'),'rotate_right');
 assert.equal(effectDetailIcon('長度','straighten'),'straighten');
});

test('standalone and collage details share icon matching without replacing original sets',()=>{
 assert.match(source('ImageEditor.tsx'),/effectDetailIcon\(p.label, p.icon\)/);
 assert.match(source('GridLayoutTool.tsx'),/FX_SUB_TOOLS\[effectCard\]\?\.find\(t=>t\[0\]===key\)\?\.\[2\]/);
 assert.match(source('GridLayoutTool.tsx'),/effectDetailIcon\(label,existingIcon/);
});
