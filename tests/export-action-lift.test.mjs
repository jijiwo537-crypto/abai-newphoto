import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('all six export screens share one lift, including both collage video results',()=>{
 for(const name of ['ImageEditor','CollageTool','GridLayoutTool','BeautyStudio','ColorMatchStudio','ArtStudio']){
  const source=read('components/'+name+'.tsx');
  assert.match(source,/data-export-screen/);assert.match(source,/<ExportActionLift\s*\/>/);
  assert.match(source,/data-export-actions/);assert.match(source,/data-export-media/);
 }
 const source=read('components/ExportActionLift.tsx');
 assert.match(source,/translateY\(-56px\)/);assert.match(source,/original\[i\]\.top-m\.getBoundingClientRect\(\)\.top/);
 assert.match(source,/minHeight=`\$\{holderHeights\[i\]\}px`/);
 assert.match(source,/loadedmetadata/);assert.match(source,/ResizeObserver/);
});
test('cross-page name is consistent and empty save remains visible but disabled and dim',()=>{
 for(const path of ['App.tsx','components/HomePage.tsx','locales/copy.tsv','utils/translations.json'])assert.match(read(path),/跨頁拼圖/);
 const s=read('components/GridLayoutTool.tsx');
 const header=s.slice(s.indexOf("disabled={exportState === 'processing'"),s.indexOf("disabled={exportState === 'processing'")+900);
 assert.match(header,/disabled=\{exportState === 'processing' \|\| !\(pages\.some/);
 assert.match(header,/opacity:.*\? 1 : \.45/);
});
