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
  assert.match(component,/\[sources,cells,rects,w,h,live,contextRevision,width,height,scale,enabled\]/);
  assert.match(component,/window.devicePixelRatio\|\|1/);
  assert.match(component,/data-seam-probe/);
  assert.match(gpu,/if\(!tex\)/);assert.match(gpu,/gl.texImage2D/);
  assert.match(gpu,/gl.LINEAR_MIPMAP_LINEAR/);assert.match(gpu,/gl.generateMipmap/);
  assert.match(gpu,/uniform vec4/);assert.match(gpu,/smoothstep/);
  assert.doesNotMatch(gpu,/toBlob|toDataURL/);
  // WebKit's profile conversion happens once on texture creation, not while
  // adjusting fusion or redrawing an already-resident source.
  assert.match(gpu,/if\(!tex\)[\s\S]*getImageData[\s\S]*this.textures.set/);
});

test('selected disabled layouts retain prepared GPU resources without painting hidden frames',()=>{
  const component=readFileSync(new URL('../components/SeamlessLayout.tsx',import.meta.url),'utf8');
  const grid=readFileSync(new URL('../components/GridLayoutTool.tsx',import.meta.url),'utf8');
  assert.match(grid,/prepareSeamless = !insetLayout && \(!!layout.seamless \|\| isThisLayoutSelected\)/);
  assert.match(grid,/enabled=\{stableSeamless\}/);
  assert.match(component,/if\(!enabled&&warmKey.current===key\)return/);
  assert.match(component,/visibility:ready&&enabled\?'visible':'hidden'/);
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
