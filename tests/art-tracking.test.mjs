import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {trackingDefaults,circleIntersections} from '../utils/artTracking.js';
test('ABAI tracking starts with its own restrained composition',()=>{
 assert.equal(trackingDefaults.chain,false);assert.equal(trackingDefaults.frame,false);
 assert.equal(trackingDefaults.labels,false);assert.equal(trackingDefaults.circles,55);
 assert.equal(trackingDefaults.imageOpacity,1);
});
test('intersection markers remain on both circles',()=>{
 const a={x:0,y:0,radius:10},b={x:12,y:0,radius:10};
 const points=circleIntersections(a,b);assert.equal(points.length,2);
 for(const p of points){assert.ok(Math.abs(Math.hypot(p.x,p.y)-10)<1e-8);assert.ok(Math.abs(Math.hypot(p.x-12,p.y)-10)<1e-8);}
 assert.deepEqual(circleIntersections(a,{x:30,y:0,radius:5}),[]);
});
test('iOS standalone sizing is scoped to art, not shared tool CSS',()=>{
 const s=readFileSync(new URL('../components/ArtStudio.css',import.meta.url),'utf8');
 assert.match(s,/\.art-studio\.safe-top\{[^}]*bottom:0[^}]*margin-top:0/);
 assert.match(s,/\.art-studio\.safe-top\{[^}]*height:auto!important/);
 assert.doesNotMatch(s,/art-screen-height|art-ios-standalone/);
 const component=readFileSync(new URL('../components/ArtStudio.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(component,/viewport\.content\s*=/);
 assert.match(s,/art-contained\{position:absolute/);
 assert.match(component,/visual\?\.removeEventListener\('scroll',align\)/);
});
