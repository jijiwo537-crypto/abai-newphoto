import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('compact photo sliders have 44px touch thumbs with unchanged visible centres',()=>{
 const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
 for(const file of ['CollageTool.tsx','GridLayoutTool.tsx'])assert.doesNotMatch(readFileSync(new URL('../components/'+file,import.meta.url),'utf8'),/\.custom-range\.dense \{ height: 26px/);
 assert.match(css,/\.custom-range\.dense \{ height: 44px; width: calc\(100% \+ 26px\); margin: 0 -13px;/);
 assert.match(css,/\.custom-range\.dense::-webkit-slider-thumb \{ height: 44px; width: 44px;/);
 // Original18px thumb on a W-wide input: centres9..W-9.
 // New44px thumb on W+26 input starting at-13: identical every value.
 for(const w of [90,160,300])for(let value=0;value<=100;value++){
  const old=9+(w-18)*value/100,newCentre=-13+22+(w+26-44)*value/100;
  assert.equal(old,newCentre);
 }
});
test('collage effect titles preserve lowercase ll rather than CSS uppercasing',()=>{
 const source=readFileSync(new URL('../components/GridLayoutTool.tsx',import.meta.url),'utf8');
 assert.match(source,/style=\{\{textTransform:'none'\}\} className=\{`text-\[8px\] font-black tracking-widest leading-none whitespace-nowrap \$\{selected \|\| on/);
});
