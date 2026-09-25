import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transform } from 'esbuild';

const source=fs.readFileSync(new URL('../components/GridLayoutTool.tsx',import.meta.url),'utf8');
const fragment=source.slice(source.indexOf('const sameDragShift ='),source.indexOf('interface GridLayoutToolProps'));
const {code}=await transform(fragment,{loader:'ts',target:'es2022'});
const compare=Function('React','FloatingImageComponentBase',code+'\nreturn FloatingImageComponent;')({memo:(_,equal)=>equal},null);
const scene={};
const image={id:'tiny-ring',shape:'grid-orbits',width:50,height:50,scale:.08};
const base={scene,image,isSelected:false,isTextEditing:false,sortPage:{index:0,width:300,height:400,totalWidth:600,clipLeft:0},dragShift:{tx:0,ty:0,s:1,live:false}};

test('page movement does not rerender an inactive vector editor on every frame',()=>{
  for(let i=0;i<240;i++)assert.equal(compare(base,{...base,dragShift:{tx:i*.37,ty:i*.01,s:.8+i/1200,live:false}}),true);
  assert.equal(compare(base,{...base,dragShift:{...base.dragShift,live:true}}),false,'lift changes stacking order');
  assert.equal(compare(base,{...base,sortPage:{...base.sortPage,index:1}}),false,'reorder updates page ownership');
  assert.equal(compare(base,{...base,sortPage:null,dragShift:null}),false,'leaving sort restores normal hit geometry');
  assert.equal(compare(base,{...base,image:{...image,color:'#fff'}}),false,'content changes still render');
});

test('normal editing, selection and DOM media still track every transform',()=>{
  for(const variant of [{sortPage:null},{isSelected:true},{isTextEditing:true},{scene:null},{image:{id:'photo',src:'photo.png'}},{image:{id:'video',isVideo:true}}]){
    const a={...base,...variant},b={...a,dragShift:{...a.dragShift,tx:30}};
    assert.equal(compare(a,b),false);
  }
  assert.match(source,/visibility: scene && sortPage && isCanvasVector \? 'hidden' : undefined/);
});
