import test from 'node:test';import assert from 'node:assert/strict';
import {blurRGBA,makeLinks,MATERIALS} from '../utils/artMaterials.js';
import {SVGContext} from '../utils/artVector.js';
test('explicit blur preserves a constant image and handles image boundaries',()=>{const a=new Uint8ClampedArray(7*5*4).fill(123);assert.deepEqual(blurRGBA(a,7,5,2),a);});
test('blur diffuses an impulse symmetrically without Canvas filter',()=>{const a=new Uint8ClampedArray(9*9*4);a[(4*9+4)*4]=255;const b=blurRGBA(a,9,9,1);assert.ok(b[(4*9+4)*4]<255);assert.ok(b[(4*9+3)*4]>0);assert.equal(b[(4*9+3)*4],b[(4*9+5)*4]);});
test('minimum path connects all nodes with n-1 edges; radial has one hub',()=>{const nodes=[{x:0,y:0,score:1},{x:10,y:0,score:4},{x:0,y:10,score:2},{x:10,y:10,score:3}];assert.equal(makeLinks(nodes,'tree',100).length,3);assert.ok(makeLinks(nodes,'radial',100).every(([a])=>a===nodes[1]));assert.equal(makeLinks(nodes,'none',100).length,0);});
test('art regions offer eight distinct modes',()=>{assert.equal(new Set(MATERIALS.map(x=>x[0])).size,8);});
test('vector context keeps circles analytic and safely encodes user labels',()=>{const c=new SVGContext();c.beginPath();c.arc(10,10,3);c.stroke();c.fillText('<script>&',0,0);assert.match(c.parts[0],/a3 3/);assert.match(c.parts[1],/&lt;script&gt;&amp;/);assert.doesNotMatch(c.parts[1],/<script>/);});
