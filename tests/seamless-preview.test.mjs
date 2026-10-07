import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../utils/seamlessLayout.ts',import.meta.url),'utf8');
const geom=source.slice(source.indexOf('export function seamGeometry'),source.indexOf('/** Shared preview/export renderer'));
const js=ts.transpileModule(geom,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const {seamGeometry,seamImageTransform}=new Function('exports',`${js};return exports;`)({});

test('fusion expands only interior edges continuously and keeps outer edges fixed',()=>{
  const rects=[{x:0,y:0,w:.5,h:1},{x:.5,y:0,w:.5,h:1}];
  let prev=0;
  for(let amount=0;amount<=100;amount++){
    const a=seamGeometry(rects,0,768,1024,amount),b=seamGeometry(rects,1,768,1024,amount);
    assert.equal(a.ex,0);assert.equal(a.ey,0);assert.equal(a.eh,1024);
    assert.equal(b.ex+b.ew,768);assert.equal(a.right,b.left);
    assert.ok(a.right>prev);prev=a.right;
    const x=400,t=(x-(384-a.right))/(2*a.right),smooth=t*t*(3-2*t);
    if(t>=0&&t<=1)assert.ok(Math.abs((1-smooth)+smooth-1)<1e-12);
  }
});
test('non-fusion GPU photos keep exact cell edges without a feather band',()=>{
 const rects=[{x:0,y:0,w:.5,h:1},{x:.5,y:0,w:.5,h:1}];
 for(let i=0;i<2;i++){
  const g=seamGeometry(rects,i,900,600,-1);
  assert.equal(g.ex,i*450);assert.equal(g.ey,0);assert.equal(g.ew,450);assert.equal(g.eh,600);
  assert.equal(g.left+g.right+g.top+g.bottom,0);
 }
});
test('gapless layout raster closes subpixel joins in both GPU and FX canvas paths',()=>{
 const gpu=readFileSync(new URL('../utils/seamlessPreview.ts',import.meta.url),'utf8');
 const surface=readFileSync(new URL('../components/LayoutPhotoSurface.tsx',import.meta.url),'utf8');
 assert.match(gpu,/isolated&&!sealEdges\?inside:distance<nearest/);
 assert.match(gpu,/uniform bool sealEdges/);
 assert.match(surface,/sealEdges:noVisibleGutter/);
 assert.match(surface,/const x=x0-leftBleed,y=y0-topBleed,cw=w0\+leftBleed\+rightBleed,ch=h0\+topBleed\+bottomBleed/);
 assert.match(surface,/const cx=x0\+w0\/2\+crop\.tx/);
 // GPU owners use exact cell edges; only the separately antialiased 2D clips overlap.
 assert.match(surface,/clips\.push\(\{x:x\/width,y:y\/height,w:cw\/width,h:ch\/height\}\)/);
 assert.match(surface,/const r=rects\[i\],source=sources\[i\]/);
});
test('GPU photo sampling never relies on implicit derivatives inside the owner branch',()=>{
 const gpu=readFileSync(new URL('../utils/seamlessPreview.ts',import.meta.url),'utf8');
 assert.match(gpu,/textureGrad\(photo\$\{i\},d\/st\+\.5,gx,gy\)/);
 assert.doesNotMatch(gpu,/[^/]texture\(photo|fwidth\(|dFdx\(|dFdy\(/);
 assert.match(gpu,/vec2 dpx=vec2\(vx\.x,vy\.x\)\/pixels\.x,dpy=vec2\(vx\.y,vy\.y\)\/pixels\.y/);
 assert.match(gpu,/gl\.uniform2f\(uniform\('pixels'\),target\.width,target\.height\)/);
});
test('preview/export inverse crop matches arbitrary rotation, offsets, opacity and source sizes',()=>{
  const rects=[{x:0,y:0,w:1,h:.5},{x:0,y:.5,w:.5,h:.5},{x:.5,y:.5,w:.5,h:.5}];
  for(const amount of [0,20,50,100])for(const rotation of [0,15,90,123,180,270])for(const index of [0,1,2]){
    const c={rotation,zoom:1.7,offsetX:2.5,offsetY:-3.5},g=seamGeometry(rects,index,768,1024,amount),t=seamImageTransform(c,4032,3024,g);
    const a=rotation*Math.PI/180,cos=Math.abs(Math.cos(a)),sin=Math.abs(Math.sin(a));
    assert.equal(t.scale,Math.max((g.ew*cos+g.eh*sin)/4032,(g.ew*sin+g.eh*cos)/3024)*1.7);
    for(const x of [g.ex,g.ex+g.ew])for(const y of [g.ey,g.ey+g.eh]){
      const dx=x-t.cx,dy=y-t.cy,ix=(dx*Math.cos(a)+dy*Math.sin(a)-t.tx)/t.scale,iy=(-dx*Math.sin(a)+dy*Math.cos(a)-t.ty)/t.scale;
      assert.ok(Math.abs(ix)<=2016+1e-6);assert.ok(Math.abs(iy)<=1512+1e-6);
    }
  }
});

test('fusion gesture bypasses full editor state and keeps pixels at fixed full resolution',()=>{
  const component=readFileSync(new URL('../components/SeamlessLayout.tsx',import.meta.url),'utf8');
  const gpu=readFileSync(new URL('../utils/seamlessPreview.ts',import.meta.url),'utf8');
  assert.match(component,/onChange=\{e=>update/);assert.match(component,/onPointerUp=\{commit\}/);
  const input=component.slice(component.indexOf('const update='),component.indexOf('const commit='));
  assert.doesNotMatch(input,/onCommit/);assert.match(input,/requestAnimationFrame/);
  assert.match(component,/\[sources,placementKey,rects,w,h,live,contextRevision,width,height,scale,enabled\]/);
  assert.match(component,/const placementKey=JSON.stringify\(cells.map\(c=>\[c.zoom,c.offsetX,c.offsetY,c.rotation,c.opacity\]\)\)/);
  assert.match(component,/drawSeamPreview\(element,cellsRef.current,rects,sourcesRef.current\|\|sources/);
  assert.match(component,/window.devicePixelRatio\|\|1/);
  assert.match(component,/data-seam-probe/);
  assert.match(gpu,/if\(!tex\|\|this\.revisions\.get\(image\)!==revision\)/);assert.match(gpu,/gl.texImage2D/);
  assert.match(gpu,/gl.LINEAR_MIPMAP_LINEAR/);assert.match(gpu,/gl.generateMipmap/);
  assert.match(gpu,/uniform vec4/);assert.match(gpu,/smoothstep/);
  assert.doesNotMatch(gpu,/toBlob|toDataURL/);
  // WebKit's profile conversion happens once on texture creation, not while
  // adjusting fusion or redrawing an already-resident source.
  assert.match(gpu,/if\(!tex\|\|this\.revisions\.get\(image\)!==revision\)[\s\S]*getImageData[\s\S]*this.textures.set/);
});

test('fusion normalizes RGB by total feather weight instead of clamping it at one',()=>{
  const gpu=readFileSync(new URL('../utils/seamlessPreview.ts',import.meta.url),'utf8');
  assert.match(gpu,/float divisor=isolated\?max\(\.000001,min\(1\.,coverage\)\):max\(\.000001,coverage\)/);
  assert.match(gpu,/color=vec4\(toEncoded\(sum\/divisor\),isolated\?min\(1\.,coverage\):1\.\)/);
  const weighted=(values,weights)=>values.reduce((sum,v,i)=>sum+v*weights[i],0)/weights.reduce((a,b)=>a+b,0);
  assert.ok(Math.abs(weighted([.2,.8],[.75,.75])-.5)<1e-12);
});

test('seam feather uses canvas-compatible encoded RGB and preserves unchanged colors',()=>{
  const gpu=readFileSync(new URL('../utils/seamlessPreview.ts',import.meta.url),'utf8');
  assert.match(gpu,/vec3 rgb=encoded\*a\+vec3\(18\.\/255\.\)\*\(1\.-a\)/);
  assert.match(gpu,/isolated\?toEncoded\(sum\/divisor\):sum\/divisor/);
  assert.match(gpu,/sum\+=rgb\*weight;coverage\+=weight/);
  const mix=(a,b,t)=>a*(1-t)+b*t;
  for(const color of [.01,.04,.18,.5,.9])assert.equal(mix(color,color,.63),color);
  // Unlike linear-light interpolation, encoded RGB does not lift mixed photo
  // edges above the app's established canvas source-over result.
  assert.ok(Math.abs(mix(.05,.8,.5)-.425)<1e-12);
});
test('seamless and separate cells share one layout GPU surface',()=>{
  const grid=readFileSync(new URL('../components/GridLayoutTool.tsx',import.meta.url),'utf8');
  const surface=readFileSync(new URL('../components/LayoutPhotoSurface.tsx',import.meta.url),'utf8');
  // Toggling seamless only changes uniforms; no second renderer or re-upload.
  assert.match(grid,/const nativeLayout = !insetLayout;/);
  assert.match(grid,/fusion=\{stableSeamless \? \(layout.seamlessAmount \?\? 0\) : undefined\}/);
  assert.doesNotMatch(grid,/<SeamlessLayout /);
  assert.match(surface,/if\(fused\)drawSeamShared\(cv,cells,clips,sources,fusionLive.current!,surface.view\)/);
});
test('screen-aligned fusion samples remain locked to the layout at fractional zoom and rotation',()=>{
  class Matrix {
    constructor(v){[this.a,this.b,this.c,this.d,this.e,this.f]=v;}
    inverse(){const {a,b,c,d,e,f}=this,q=a*d-b*c;return new Matrix([d/q,-b/q,-c/q,a/q,(c*f-d*e)/q,(b*e-a*f)/q]);}
  }
  const s=readFileSync(new URL('../utils/seamlessSurfaceGeometry.ts',import.meta.url),'utf8');
  const code=ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const {resolveSeamSurface}=new Function('exports','DOMMatrix',`${code};return exports;`)({},Matrix);
  for(const zoom of [.17,.35,.999,1.001,2,8])for(const angle of [0,23,90,123])for(const dpr of [1,2,3]){
    const r=angle*Math.PI/180,a=zoom*Math.cos(r),b=zoom*Math.sin(r),c=-b,d=a,e=101.231,f=202.789;
    const point=(x,y)=>({x:a*x+c*y+e,y:b*x+d*y+f});
    const points=[point(0,0),point(768,0),point(0,1024)];
    const corners=[...points,point(768,1024)];
    const bounds={left:Math.min(...corners.map(p=>p.x)),top:Math.min(...corners.map(p=>p.y)),right:Math.max(...corners.map(p=>p.x)),bottom:Math.max(...corners.map(p=>p.y))};
    const s=resolveSeamSurface(points,768,1024,345,460,bounds,{left:-10000,top:-10000,right:10000,bottom:10000},dpr);
    assert.ok(s);assert.equal(s.pixelWidth,Math.round(s.width*dpr));
    const [ma,mb,mc,md,mx,my]=s.transform;
    for(const u of [.1,.5,.9])for(const v of [.1,.5,.9]){
      const wx=s.view.xx*u+s.view.xy*v+s.view.x0,wy=s.view.yx*u+s.view.yy*v+s.view.y0;
      const lx=ma*u*s.width+mc*v*s.height+mx,ly=mb*u*s.width+md*v*s.height+my;
      assert.ok(Math.abs(lx-wx*345/768)<1e-8);assert.ok(Math.abs(ly-wy*460/1024)<1e-8);
      const p=point(wx,wy),origin=point(s.view.x0,s.view.y0);
      assert.ok(Math.abs(p.x-origin.x-u*s.width)<1e-8);assert.ok(Math.abs(p.y-origin.y-v*s.height)<1e-8);
    }
  }
});
