import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('camera effects expose the three requested toggles and shared editor defaults',()=>{
 const config=readFileSync(new URL('../utils/cameraEffects.ts',import.meta.url),'utf8');
 for(const id of ['soft2','halo','lowfi'])assert.match(config,new RegExp(`id:'${id}'`));
 assert.match(config,/FX_DEFS.find\(d=>d.id==='fxExposureSpill'\)/);
 assert.match(config,/FX_DEFS.find\(d=>d.id==='fxLowfi'\)/);
 const ui=readFileSync(new URL('../components/CameraInterface.tsx',import.meta.url),'utf8');
 assert.match(ui,/FX_ITEMS.some\(item => fx\[item.id\] > 0\)/);
 assert.match(ui,/data-camera-effect=\{it.id\}/);
});
test('new camera effects use the same GPU path for live and still, never a CPU frame readback',()=>{
 const view=readFileSync(new URL('../components/Viewfinder.tsx',import.meta.url),'utf8');
 for(const key of ['u_soft2','u_halo','u_lowfi'])assert.match(view,new RegExp(key));
 assert.match(view,/draw\(video, gl.canvas.width, gl.canvas.height\)/);
 assert.match(view,/draw\(src, w, h\)/);
 assert.doesNotMatch(view,/getImageData|readPixels/);
 assert.match(view,/CAMERA_HIGHLIGHT_FS/);
 assert.match(view,/gl.deleteProgram\(highlightProgRef.current\)/);
});
