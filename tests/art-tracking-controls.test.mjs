import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {trackingDefaults,trackingRadius,trackingZones,redistributeRegions,renderTracking,invalidateTracking} from '../utils/artTracking.js';
import {SVGContext} from '../utils/artVector.js';
const ui=readFileSync(new URL('../components/ArtStudio.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../components/ArtStudio.css',import.meta.url),'utf8');
test('outline variation changes radius, never center or maximum size',()=>{
 const o={...trackingDefaults,maxRadius:40,variation:0};assert.equal(trackingRadius(o,0),40);assert.equal(trackingRadius(o,1),40);
 o.variation=100;assert.equal(trackingRadius(o,0),0);assert.equal(trackingRadius(o,1),40);
});
test('region redistribution and variation leave nodes and elements untouched',()=>{
 const o={...trackingDefaults,count:3,zones:[{x:.2,y:.3}],frame:true,chain:true};
 const next=redistributeRegions(o);assert.notDeepEqual(next.zones,o.zones);assert.equal(next.nodeSeed,o.nodeSeed);
 assert.equal(next.frame,true);assert.equal(next.chain,true);assert.deepEqual(next.materials,o.materials);
 const rerolled=trackingZones(next);assert.notDeepEqual([rerolled[0].x,rerolled[0].y],[rerolled[1].x,rerolled[1].y]);
 assert.deepEqual(trackingZones(o),trackingZones({...o,nodeSeed:99}));
 assert.deepEqual(trackingZones(o).map(z=>z.scale),[1,1,1,1]);
 const varied=trackingZones({...o,sizeVariation:100});assert.ok(varied.every(z=>z.scale>=.2&&z.scale<=1));assert.ok(varied.some(z=>z.scale<1));
});
test('actual vector rendering isolates node randomness from material randomness',()=>{
 const old=globalThis.document;globalThis.document={createElement:()=>({getContext(){return{drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(300*400*4).fill(180)})};}})};
 try{const source={width:1200,height:1600},render=o=>{const c=new SVGContext();renderTracking(c,source,.6,{...o,detection:'bright',vectorOnly:true,zoneStroke:false});return c.parts.join('');};
  invalidateTracking();const first=render(trackingDefaults);assert.equal(render({...trackingDefaults,seed:99,count:4,sizeVariation:90}),first);
  assert.notEqual(render({...trackingDefaults,nodeSeed:43}),first);assert.notEqual(render({...trackingDefaults,nodeSeed:44}),render({...trackingDefaults,nodeSeed:43}));
  const golden=render({...trackingDefaults,golden:true});assert.match(golden,/A/);assert.notEqual(golden,first);
  const rotated=render({...trackingDefaults,golden:true,goldenAngle:45,goldenSize:150});assert.notEqual(rotated,golden);assert.match(rotated,/A/);assert.doesNotMatch(rotated,/NaN|undefined/);
  assert.equal(render({...trackingDefaults,thirds:true}),first);
 }finally{globalThis.document=old;invalidateTracking();}
});
test('tracking tools expose requested placement, two-state elements and paired outline sliders',()=>{
 assert.match(ui,/groups\(\['外觀','元素','文字'\]\)/);assert.match(ui,/groups\(\['材質','編輯','細節'\]\)/);
 assert.match(ui,/\['tree','標準'\]/);assert.doesNotMatch(ui,/最短路徑|折線|完成放置|區域大小|節點間距|像素大小|區域邊線/);
 assert.match(ui,/tr\('變化','variation',0,100\)/);assert.match(ui,/tr\('間距','minDistance',10,100\)/);
 assert.match(ui,/tr\('變化','sizeVariation',0,100\)/);assert.match(ui,/點擊圖片進行放置/);
 assert.match(ui,/const tt=.*binary/);assert.doesNotMatch(ui+css,/三分構圖|art-zone-stroke-second|art-materials-all/);
 assert.match(ui,/tr\('大小','goldenSize',10,150\)/);assert.match(ui,/tr\('角度','goldenAngle',0,360\)/);
 assert.match(css,/art-detail-ranges>\.art-range:last-child:nth-child\(odd\)\{grid-column:1\/-1\}/);
 assert.match(css,/art-subtabs button\[aria-pressed=true\]\{color:white\}/);
});
test('SVG quarter-circle arcs remain analytic, while existing full circles retain their geometry',()=>{
 const c=new SVGContext();c.arc(20,30,10);assert.match(c.path,/a10 10/);c.beginPath();c.arc(20,30,10,0,Math.PI/2);assert.match(c.path,/A10 10 0 0 1/);assert.doesNotMatch(c.path,/NaN/);
});
