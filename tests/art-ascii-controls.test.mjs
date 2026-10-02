import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('art uses the editor viewport and shared save control with fixed text-only tabs',()=>{
 const s=read('components/ArtStudio.tsx'),css=read('components/ArtStudio.css');
 assert.match(s,/art-studio safe-top/);assert.match(s,/<SaveButton urls=/);
 assert.doesNotMatch(s,/className="art-replace"|EffectArtwork/);assert.match(s,/\['效果','字符','範圍','外觀'\]/);
 assert.match(s,/art-save-pill/);assert.match(s,/aria-label="匯出選項"/);assert.match(s,/canExportHeic/);
 assert.match(css,/art-controls\{[^}]*overflow-y:auto/);
 assert.match(css,/art-zoom\{[^}]*inset:0/);
 assert.doesNotMatch(s,/作品已準備好|Icon size/);
});
test('glyph glow is cached in three soft layers, not a per-frame box kernel',()=>{
 const s=read('utils/asciiRenderer.ts');assert.match(s,/haloAtlas/);assert.match(s,/\[.55,.3,.15\]/);assert.doesNotMatch(s,/for\(int j=-2/);
});
test('range controls retain detection semantics in the requested order',()=>{
 const s=read('components/ArtStudio.tsx');
 assert.match(s,/\['亮部','暗部','邊緣','色彩'\]/);
 assert.match(s,/withAsciiMetric\(s,\[0,3,1,2\]\[index\]\)/);
 assert.match(s,/slider\('範圍',100-settings.low,0,100/);
 assert.doesNotMatch(s,/range\('上限'|range\('下限'/);
});
test('ASCII starts with white characters over the photo',()=>{
 const s=read('utils/asciiRenderer.ts');assert.match(s,/color:false,background:true,glow:0/);
});
test('dark detection reverses luminance before character mapping',()=>{
 const s=read('utils/asciiRenderer.ts');assert.match(s,/metric>2\.5\)\{v=1\.-v;/);assert.match(s,/ink=.*gate/);
});
test('art controls expose glow and pinch zoom without invert or a header title',()=>{
 const s=read('components/ArtStudio.tsx');assert.match(s,/glow:value\?50:0/);assert.doesNotMatch(s,/range\('發光'/);assert.match(s,/TransformWrapper/);assert.match(s,/'暗部'/);assert.doesNotMatch(s,/反轉字符|<span>藝術效果<\/span>/);
});
test('GPU effects retain a single visible presentation canvas',()=>{
 const s=read('components/ImageEditor.tsx');const f=s.slice(s.indexOf('const showFxSurface='),s.indexOf('const visibleEditorCanvas='));
 assert.match(f,/fxSurfaceShownRef.current=shown/);assert.match(f,/surface.style.visibility=shown\?'visible':'hidden'/);
 assert.match(f,/display.style.opacity=shown\?'0':'1'/);assert.match(f,/display.style.visibility='visible'/);
 assert.doesNotMatch(f,/ctx.drawImage\(surface/,'direct GPU presentation avoids per-frame readback');
});
