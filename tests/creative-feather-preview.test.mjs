import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('creative feather input retains original physical-pixel quality without readback or asynchronous replacement',()=>{
 const s=read('utils/creativeFeatherSurface.ts'),a=read('utils/creativeSeamless.ts');
 assert.doesNotMatch(s,/getImageData|putImageData|toDataURL|readPixels|setTimeout|requestAnimationFrame/);
 assert.match(s,/const m=ctx.getTransform\(\)/);assert.match(s,/decoded.get\(p.src\)/);assert.match(s,/imageSmoothingQuality='high'/);
 assert.match(s,/cell.key!==cropKey\|\|cell.image!==image/);assert.match(s,/resident<=64\*1024\*1024/);
 assert.match(a,/if\(preview\)[\s\S]*?this.interactive.paint/);
 const c=read('components/CollageTool.tsx');assert.match(c,/regionPaintRef.current=\(\)=>/);assert.match(c,/const photoRegion=photoRegionRef.current/);
 assert.match(c,/const finishRegionEdit=\(\)=>[\s\S]*?setPhotoRegion\(photoRegionRef.current\)/);
 assert.match(c,/const RegionLiveRange=/);assert.match(c,/onPointerCancel=\{onCommit\}/);
});
test('preview pinch paints full density directly and commits the same view on release',()=>{
 const c=read('components/CollageTool.tsx');
 assert.match(c,/liveViewPaintRef.current = baseCss && imageState/);
 assert.match(c,/frame.style.width=`\$\{baseCss.w\*next.k\}px`/);
 assert.match(c,/const scale=fitScale\(baseCss.w,cs.w,next.k\)/);
 assert.match(c,/renderToCanvasRef.current\(canvas,scale\)/);
 assert.match(c,/const handlePointerUp[\s\S]*?flushView\(true\)/);
 assert.match(c,/committedViewRef.current !== viewT/);
});
