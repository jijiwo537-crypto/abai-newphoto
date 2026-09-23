import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const creative=fs.readFileSync('components/CollageTool.tsx','utf8');
const classic=fs.readFileSync('components/GridLayoutTool.tsx','utf8');
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
test('rapid pinch events accumulate distance but commit only the latest frame',()=>{
  const start=creative.indexOf("} else if (intr.type === 'pinch_hole') {")+"} else if (intr.type === 'pinch_hole') {".length;
  const end=creative.indexOf('\n    }\n  };',start);
  let holes=[{id:'a',side:'mask',localScale:1}], pending;
  const pointers=new Map([[1,{clientX:0,clientY:0}],[2,{clientX:20,clientY:0}]]);
  const scope={activePointers:{current:pointers},rect:{left:0,top:0},sx:1,sy:1,
    intr:{id:'a',startDist:20},holesRef:{current:holes},selectedPatternSide:'mask',
    queueMove(fn){pending=fn;},setHoles(fn){holes=fn(holes);}};
  vm.runInNewContext(compile('globalThis.move=()=>{'+creative.slice(start,end)+'};'),scope);
  for(let x=21;x<=40;x++){pointers.set(2,{clientX:x,clientY:0});scope.move();}
  assert.equal(holes[0].localScale,1);
  pending();assert.ok(Math.abs(holes[0].localScale-2)<1e-10);
});
test('selected pattern controls split mirrored copies and change only the selected side',()=>{
  let holes=[{id:'a',x:40,y:50,side:'both'},{id:'b',x:90,y:80,angle:30}];
  const scope={selectedTarget:'a',selectedPatternSide:'mask',holes,holeSize:25,holeAngle:0,
    setHoles(fn){holes=fn(holes);},setHoleSize(){throw Error('must not change group');},setHoleAngle(){throw Error('must not change group');}};
  const start=creative.indexOf('  const selectedPattern = holes.find');
  const end=creative.indexOf('\n  return (',start);
  vm.runInNewContext(compile(creative.slice(start,end)+'\nglobalThis.size=handleHoleSizeChange;globalThis.angle=handleAngleChange;'),scope);
  scope.size(75);
  assert.equal(holes.length,3);
  assert.equal(holes[0].side,'mask');assert.ok(holes[0].localScale>1);
  assert.equal(holes[1].side,'image');assert.equal(holes[1].localScale,undefined);
  scope.angle(120);
  assert.equal(holes[0].angle,120);assert.equal(holes[1].angle,undefined);assert.equal(holes[2].angle,30);
});
test('plain selection changes do not invalidate the high-resolution scene callback',()=>{
  const start=creative.indexOf('  const renderToCanvas = useCallback');
  const end=creative.indexOf('\n  /* ── 首頁的歷史紀錄',start);
  const body=creative.slice(start,end), deps=body.slice(body.lastIndexOf('}, ['));
  assert.ok(!/\b(selectedTarget|selectedPatternSide|baseSelected)\b/.test(deps));
  assert.ok(deps.includes('shapeSel ? selectedObj : null'),'only nonrectangular image outlines require scene repaint on selection');
  assert.ok(creative.includes('selectedPattern && !animRef.current && !composeState'));
  assert.ok(body.includes('chromeSelectionRef.current'));
});
test('outer contour bounds grow continuously without changing the shape size',()=>{
  const start=classic.indexOf('export const compositeOutlineInk =');
  const end=classic.indexOf('export const drawCompositeShapeBody',start);
  const scope={exports:{},SHAPE_FIT:{star:[.0245,0,.9511,.9045]}};
  vm.runInNewContext(compile(classic.slice(start,end)),scope);
  const bounds=scope.exports.compositeOutlineInk;
  let last=bounds('star-double',160,160,0);
  for(let n=1;n<=100;n++){
    const b=bounds('star-double',160,160,n);
    assert.ok(b.x<last.x && b.y<last.y && b.w>last.w && b.h>last.h);
    assert.ok(b.w-last.w<1 && b.h-last.h<1);
    last=b;
  }
  assert.equal(bounds('star',160,160,100),null);
});
test('composite shape body changes inner geometry and adds only outward ring ink',()=>{
  const start=classic.indexOf('export const drawCompositeShapeBody =');
  const end=classic.indexOf('/** 複合圖形的描邊路徑',start);
  const paths=[],strokes=[],clips=[];
  class Path { constructor(){} addPath(){} rect(){} }
  const scope={exports:{},Path2D:Path,COMPOSITE_SHAPE_KINDS:new Set(['square-heart-dual','star-double']),
    DUAL_COLOR_SHAPE_KINDS:new Set(['square-heart-dual']),CUTOUT_SHAPE_KINDS:new Set(),
    compositeInnerKind:k=>k==='star-double'?'star':'heart',shapePathD:()=>'',
    insetShapePath:(...p)=>{paths.push(p);return new Path();}};
  vm.runInNewContext(compile(classic.slice(start,end)),scope);
  const ctx={fill(){},save(){},restore(){},stroke(){strokes.push(this.lineWidth);},clip(_,rule){clips.push(rule);}};
  const draw=scope.exports.drawCompositeShapeBody;
  draw(ctx,'square-heart-dual',160,160,'red','white',undefined,{innerSize:40});
  assert.equal(paths[0][3],.4);
  draw(ctx,'star-double',160,160,'red','white',undefined,{outlineWidth:100});
  assert.equal(strokes.length,2);assert.equal(strokes[1],strokes[0]*5);
  assert.deepEqual(clips,['evenodd']);
  // Inner half stays base/2, outer half becomes base*2.5: total is exactly 3x.
  assert.equal(strokes[0]/2+strokes[1]/2,strokes[0]*3);
});
