import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {trackingDefaults,trackingRadius,trackingFrameExtent,trackingZones,trackingChainAngle,trackingCircleChain,redistributeRegions,renderTracking,invalidateTracking} from '../utils/artTracking.js';
import {firstTrackingElementVisit,preciseAngle} from '../utils/artElementControls.js';
import {ART_SWATCHES,artHexToHsv,artHsvToHex} from '../utils/artColors.js';
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
 assert.match(ui,/groups\(\['偵測','輪廓','連線','顏色'\]\)/);assert.match(ui,/groups\(\['元素','文字'\]\)/);assert.match(ui,/groups\(\['編輯','材質','細節'\]\)/);
 assert.match(ui,/\['tree','標準'\]/);assert.doesNotMatch(ui,/最短路徑|折線|完成放置|區域大小|節點間距|像素大小|區域邊線/);
 assert.match(ui,/tr\('變化','variation',0,100\)/);assert.match(ui,/tr\('間距','minDistance',10,100\)/);
 assert.match(ui,/tr\('變化','sizeVariation',0,100\)/);assert.match(ui,/點擊圖片進行放置/);
 assert.match(ui,/const tt=.*binary/);assert.doesNotMatch(ui+css,/三分構圖|art-zone-stroke-second|art-materials-all/);
 assert.match(ui,/tr\('大小','goldenSize',10,150\)/);assert.match(ui,/tr\('角度','goldenAngle',0,360\)/);assert.doesNotMatch(ui+css,/黃金比例精確角度|art-angle|goldenAngleControl/);
 assert.match(css,/art-detail-ranges>\.art-range:last-child:nth-child\(odd\)\{grid-column:1\/-1\}/);
 assert.match(css,/art-subtabs button\[aria-pressed=true\]\{color:white\}/);
});
test('element visits activate once without undoing a later manual disable',()=>{
 const visited=new Set();for(const key of ['frame','chain','golden']){assert.equal(firstTrackingElementVisit(visited,key),true);assert.equal(firstTrackingElementVisit(visited,key),false);}
 assert.equal(visited.size,3);assert.doesNotMatch(ui,/圓圈鏈|定位角|tab==='區域'/);assert.doesNotMatch(css,/art-elements i/);
 assert.match(ui,/\['selection','選中框'\]/);assert.match(ui,/\['cross','交叉框'\]/);assert.match(ui,/name:'ASCII'/);
});
test('golden ratio permits every integer angle including exact quarter and half turns',()=>{
 for(let angle=0;angle<=360;angle++)assert.equal(preciseAngle(angle),angle);
 assert.equal(preciseAngle(89.9),90);assert.equal(preciseAngle(179.9),180);
 assert.equal(preciseAngle(''),null);assert.equal(preciseAngle('wrong'),null);assert.equal(preciseAngle(999),360);assert.equal(preciseAngle(-1),0);
});
test('selected and crossed frames vary up to 1:5 on both axes while retaining squares',()=>{
 assert.deepEqual(trackingFrameExtent(40,0,.1,1),{rx:40,ry:40});
 assert.deepEqual(trackingFrameExtent(40,100,0,1),{rx:40,ry:8});
 assert.deepEqual(trackingFrameExtent(40,100,1,1),{rx:8,ry:40});
 for(let i=0;i<100;i++)for(const v of [0,50,100]){
  const {rx,ry}=trackingFrameExtent(40,v,i/99,i);assert.ok(rx>0&&ry>0);assert.ok(Math.max(rx,ry)===40);assert.ok(Math.max(rx/ry,ry/rx)<=5);
  if(i%4===0)assert.equal(rx,ry);
 }
});
test('color controls keep the original colors and white-first rainbow with reversible HSV',()=>{
 assert.equal(ART_SWATCHES.length,8);assert.equal(ART_SWATCHES[0][0],'#ffffff');
 for(const hex of ['#a8ffdc','#ffd178','#ff7899'])assert.ok(ART_SWATCHES.some(([c])=>c===hex));
 for(const hex of [...ART_SWATCHES.map(([c])=>c),'#000000','#123456'])assert.equal(artHsvToHex(artHexToHsv(hex)),hex);
 assert.equal(artHsvToHex({h:360,s:100,v:100}),'#ff0000');
 assert.doesNotMatch(ui,/tr\('線條透明度'|tr\('底圖透明度'/);
});
test('comparison uses bare icon feedback while randomization only brightens its border',()=>{
 assert.match(ui,/aria-pressed=\{compare\}/);assert.match(ui,/onLostPointerCapture/);
 assert.match(css,/art-compare\[aria-pressed=true\]/);assert.match(ui,/button.animate\(\[\{borderColor/);
 const pressed=css.match(/\.art-compare\[aria-pressed=true\]\{([^}]+)\}/)[1];assert.match(pressed,/background:transparent/);assert.match(pressed,/box-shadow:none/);assert.match(pressed,/transform:scale\(\.9\)/);
 assert.doesNotMatch(ui,/button.animate\(\[\{backgroundColor/);
 assert.match(css,/art-scroll\{[^}]*overscroll-behavior:none/);assert.match(ui,/touchmove',move,\{passive:false\}/);
 const outline=ui.match(/section==='輪廓'[^\n]+/)[0];assert.doesNotMatch(outline,/\['none','無'\]/);
});
test('art colors follow creative collage geometry without clipping selected swatches',()=>{
 const colors=readFileSync(new URL('../components/ArtColorControls.tsx',import.meta.url),'utf8');
 assert.match(colors,/className="designer-color-slider"/);assert.match(colors,/className="slider-wrap"/);
 assert.match(colors,/KeyboardSafeInput aria-label="色號"/);assert.match(colors,/Icon name="colorize"/);
 assert.ok(colors.indexOf('className="art-custom-color"')<colors.indexOf('ART_SWATCHES.map'));
 assert.match(css,/art-swatches button\[aria-pressed=true\]\{border:2px solid white;outline:none\}/);
 assert.match(css,/width:32px;height:32px/);assert.match(css,/art-color-pair\{[^}]*gap:28px/);
 assert.doesNotMatch(css,/art-color-range input::/);
});
test('circle defaults follow each photo diagonal exactly and use size 200',()=>{
 const o={...trackingDefaults,chain:true};assert.equal(o.baseRadius,200);assert.equal(o.angle,null);
 for(const [w,h] of [[600,800],[800,600],[1200,1200],[1600,900],[900,1600]]){
  const angle=trackingChainAngle(o,w,h);assert.ok(Math.abs(angle-Math.atan2(w,h)*180/Math.PI)<1e-10);
  for(const n of trackingCircleChain(o,w,h))assert.ok(Math.abs(n.x/w+n.y/h-1)<1e-10);
 }
 for(const angle of [0,45,90,180])assert.equal(trackingChainAngle({...o,angle},600,800),angle);
 assert.match(ui,/Math.round\(trackingChainAngle\(tracking,dimensions.w,dimensions.h\)\)/);
});
test('sliders preserve the pending paint, source pixels and direct GPU material result',()=>{
 const gpu=readFileSync(new URL('../utils/artTrackingGpu.js',import.meta.url),'utf8'),vectors=readFileSync(new URL('../utils/artVector.js',import.meta.url),'utf8');
 assert.match(ui,/if\(!frame.current\)frame.current=requestAnimationFrame/);assert.doesNotMatch(ui,/useEffect\(\(\)=>\{cancelAnimationFrame\(frame.current\)/);
 assert.match(ui,/tr\('數量','count',0,30\)/);assert.match(ui,/new SVGContext\(vector.current\)/);
 assert.match(ui,/trackingGpu.current\?\.style.display==='block'\?trackingGpu.current/);
 assert.match(gpu,/canvas.width=w;canvas.height=h/);assert.match(gpu,/blurMaterialTexture/);assert.doesNotMatch(gpu,/getImageData|readPixels|blurredSource/);
 assert.match(vectors,/canvas.width=source.width;canvas.height=source.height/);
});
test('circle extensions preserve all seven original circles and add equally at both ends',()=>{
 const o={...trackingDefaults,chain:true},old=trackingCircleChain({...o,chainCount:7},1200,1600),extended=trackingCircleChain(o,1200,1600);
 assert.equal(extended.length,11);assert.deepEqual(extended.slice(2,-2),old);
 for(let i=0;i<5;i++){const a=extended[i],b=extended[10-i];assert.equal(a.radius,b.radius);assert.ok(Math.abs(a.x+b.x-1200)<1e-8);assert.ok(Math.abs(a.y+b.y-1600)<1e-8);}
});
test('new square contours draw analytic corner handles and diagonal connections',()=>{
 const old=globalThis.document;globalThis.document={createElement:()=>({getContext(){return{drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(300*400*4).fill(180)})};}})};
 try{invalidateTracking();const source={width:1200,height:1600},draw=shape=>{const ctx=new SVGContext();renderTracking(ctx,source,.6,{...trackingDefaults,circles:1,detection:'bright',shapes:[shape],palette:'#ff00aa',labelSize:0,vectorOnly:true,zoneStroke:false});return ctx.parts.join('');};
 const selection=draw('selection');assert.match(selection,/fill="#ffffff"/);assert.equal((selection.match(/h[\d.]+v[\d.]+h-/g)||[]).length,5);
 const square=draw('square'),cross=draw('cross');assert.notEqual(cross,square);assert.match(cross,/L/);assert.doesNotMatch(selection+cross,/NaN|undefined/);
 }finally{globalThis.document=old;invalidateTracking();}
});
test('SVG quarter-circle arcs remain analytic, while existing full circles retain their geometry',()=>{
 const c=new SVGContext();c.arc(20,30,10);assert.match(c.path,/a10 10/);c.beginPath();c.arc(20,30,10,0,Math.PI/2);assert.match(c.path,/A10 10 0 0 1/);assert.doesNotMatch(c.path,/NaN/);
});
