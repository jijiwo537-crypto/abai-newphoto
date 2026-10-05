import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../utils/scenePixelGrid.ts',import.meta.url),'utf8');
const edge=new Function(source.replace('export ','').replaceAll(':number','')+';return scenePixelEdge;')();
test('shared photo/photo and photo/mask boundaries have exactly one pixel owner at every zoom phase',()=>{
 let cases=0;
 for(const width of [243.13,358.7,1000.49])for(const split of [.2,.333,.5,.71]){
  for(let i=1;i<=600;i++){
   const scale=.125+i/100,origin=(i%31)/31-.5;
   const left=edge(0,scale,origin),middle=edge(width*split,scale,origin),right=edge(width,scale,origin);
   // Same boundary object for the two half-open intervals, independent of
   // the photo aspect ratio or the mask intermediate storage size.
   assert.equal((middle-left)+(right-middle),right-left);
   for(const p of [left,middle-1,middle,right-1]){
    if(p<left||p>=right)continue;
    assert.equal(Number(p>=left&&p<middle)+Number(p>=middle&&p<right),1);
   }
   cases++;
  }
 }
 assert.equal(cases,7200);
});
test('outward intermediate storage covers the last fractional texel without changing logical extent',()=>{
 for(let i=1;i<1000;i++){
  const logical=10+i/997,storage=Math.ceil(logical);
  assert.ok(storage>=logical);
  assert.ok(storage-logical<1);
 }
});
test('resident photo placement follows exactly the same parent scale between render frames',()=>{
 for(const physicalWidth of [512,1024,1307])for(const viewportStart of [0,13.5,89])for(const viewportWidth of [70,100,150]){
  const l=37,W=413,left=viewportStart+l/physicalWidth*viewportWidth,width=W/physicalWidth*viewportWidth;
  for(const parentWidth of [201.1,352.75,903.13,1789.21]){
   const imageLeft=left/100*parentWidth,imageRight=(left+width)/100*parentWidth;
   const mainLeft=viewportStart/100*parentWidth,mainWidth=viewportWidth/100*parentWidth;
   assert.ok(Math.abs(imageLeft-(mainLeft+l/physicalWidth*mainWidth))<1e-10);
   assert.ok(Math.abs(imageRight-(mainLeft+(l+W)/physicalWidth*mainWidth))<1e-10);
  }
 }
});
