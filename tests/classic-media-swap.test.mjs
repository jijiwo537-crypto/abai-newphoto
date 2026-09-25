import test from 'node:test';
import assert from 'node:assert/strict';
import { swapFloatingMedia } from '../utils/swapFloatingMedia.mjs';

const photo = { id:'photo', src:'photo.jpg', width:200, height:100, x:12, y:30, scale:2, rotation:45, origSrc:'original.jpg' };
const video = { id:'video', src:'video.mp4', isVideo:true, poster:'poster.jpg', width:90, height:160, x:400, y:20, scale:1, rotation:0, geo:{flipX:true} };
test('photo/video swaps transfer media type, poster and crop without moving layer identities', () => {
  const [a,b] = swapFloatingMedia([photo,video], 'photo','video');
  assert.equal(a.src,video.src); assert.equal(a.isVideo,true); assert.equal(a.poster,video.poster);
  assert.deepEqual(a.geo,video.geo); assert.equal(a.origSrc,undefined);
  assert.equal(b.src,photo.src); assert.equal(b.isVideo,false); assert.equal(b.poster,undefined);
  assert.equal(b.geo,undefined); assert.equal(b.origSrc,photo.origSrc);
  for(const [actual,original] of [[a,photo],[b,video]]) {
    for(const key of ['id','x','y','scale','rotation']) assert.equal(actual[key],original[key]);
    assert.equal(Math.max(actual.width,actual.height),Math.max(original.width,original.height));
  }
  assert.equal(a.width/a.height,video.width/video.height);
  assert.equal(b.width/b.height,photo.width/photo.height);
});
test('photo/photo swaps are synchronous and preserve both sources', () => {
  const b={...video,isVideo:false,src:'other.jpg'};
  const result=swapFloatingMedia([photo,b],'photo','video');
  assert.deepEqual(result.map(x=>x.src),['other.jpg','photo.jpg']);
});
test('deleted targets, same targets and non-media layers are no-ops', () => {
  for(const items of [[photo],[photo,{...video,shape:'star'}],[photo,{...video,text:'hello'}]]) {
    assert.equal(swapFloatingMedia(items,'photo','video'),items);
    assert.equal(swapFloatingMedia(items,'photo','photo'),items);
  }
});
