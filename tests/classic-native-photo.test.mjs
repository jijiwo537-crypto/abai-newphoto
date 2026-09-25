import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transform } from 'esbuild';
const code = fs.readFileSync(new URL('../components/ClassicPhotoLayer.ts', import.meta.url),'utf8');
const compiled = await transform(code,{loader:'ts',format:'esm'});
const {ClassicPhotoLayer}=await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
let crops=0, mutations=0;
class Node {
  style={};dataset={};children=[];attrs=new Map();parentElement=null;
  append(...nodes){for(const n of nodes){n.parentElement=this;this.children.push(n)}}
  setAttribute(k,v){mutations++;this.attrs.set(k,String(v))}getAttribute(k){return this.attrs.get(k)??null}
  removeAttribute(k){mutations++;this.attrs.delete(k)}remove(){}
  getContext(){return {drawImage(){crops++}}}toDataURL(){return 'data:image/png;base64,edge'}
}
globalThis.document={createElementNS:()=>new Node(),createElement:()=>new Node()};
test('native photo retains original image and only extracts four edge texels once',()=>{
  const column=new Node();column.style={width:'900px',height:'400px'};
  const host=new Node();column.append(host);const layer=new ClassicPhotoLayer(host);
  const source={src:'blob:original',naturalWidth:3072,naturalHeight:4096};
  const frame={source,width:300,height:400,radius:0,pad:1,edges:[true,true,true,true],clip:null,dim:0};
  const m={a:1,b:0,c:0,d:1,e:150,f:200};
  layer.update(m,frame);const count=crops;
  for(let i=0;i<240;i++)layer.update(m,frame);
  assert.equal(count,4);assert.equal(crops,count);
  assert.equal(layer.root.attrs.get('width'),'900');
  const content=layer.root.children[1].children[0];
  assert.equal(content.children[4].attrs.get('href'),'blob:original');
  assert.equal(content.attrs.get('transform'),'matrix(1 0 0 1 150 200)');
  assert.equal(content.children[3].attrs.get('width'),'302','bottom guard also covers both tiny corner gaps');
});
test('native photograph receives the same sorting matrix and current strip clip',()=>{
  const column=new Node();column.style={width:'900px',height:'400px'};const host=new Node();column.append(host);
  const layer=new ClassicPhotoLayer(host);
  layer.update({a:1.05,b:0,c:0,d:1.05,e:330,f:200},{source:{src:'blob:sort',naturalWidth:300,naturalHeight:400},width:300,height:400,radius:0,pad:1,edges:[true,true,true,true],clip:{x:0,y:-10,width:945,height:420},dim:0});
  const group=layer.root.children[1];
  assert.match(group.attrs.get('clip-path'),/^url\(#classic-photo-clip-/);
  assert.equal(group.children[0].attrs.get('transform'),'matrix(1.05 0 0 1.05 330 200)');
});
test('native photos preserve stacking barriers and bypass 2D photo painting',()=>{
 const scene=fs.readFileSync(new URL('../components/ClassicVectorScene.ts',import.meta.url),'utf8');
 assert.ok(scene.includes('if (entry.nativePhoto) continue;'));
 assert.ok(scene.includes('barriers.push(...entries.filter(e => e.nativePhoto).map(e => e.z))'));
 const tool=fs.readFileSync(new URL('../components/GridLayoutTool.tsx',import.meta.url),'utf8');
 assert.match(tool,/if \(pages.length < 2\) \{[\s\S]*?vectorScene.remove\('__page-seams'\);[\s\S]*?vectorScene.flush\(\);[\s\S]*?return;/);
 assert.ok(tool.includes('if (!anim) { raf = requestAnimationFrame(tick); return; }'));
 assert.ok(tool.includes('nativePhoto: isScenePhoto ? image.id : undefined'));
});
test('unchanged rounded and canvas clips do not invalidate SVG on every frame',()=>{
 const column=new Node();column.style={width:'900px',height:'400px'};const host=new Node();column.append(host);
 const layer=new ClassicPhotoLayer(host), matrix={a:1,b:0,c:0,d:1,e:150,f:200};
 const photo={source:{src:'blob:stable',naturalWidth:300,naturalHeight:400},width:300,height:400,radius:20,pad:1,edges:[true,true,true,true],clip:{x:0,y:0,width:900,height:400},dim:0};
 layer.update(matrix,photo);mutations=0;
 for(let i=0;i<240;i++)layer.update(matrix,photo);
 assert.equal(mutations,0,'stable clips and image geometry produce no attribute writes');
 layer.update({...matrix,e:151},photo);
 assert.equal(mutations,1,'movement changes only the shared transform');
 layer.update(matrix,{...photo,radius:0,clip:null});
 assert.equal(layer.root.children[1].getAttribute('clip-path'),null);
 assert.equal(layer.root.children[1].children[0].getAttribute('clip-path'),null);
});
