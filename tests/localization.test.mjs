import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
const catalog=JSON.parse(fs.readFileSync('utils/translations.json','utf8'));
const transpile=p=>ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
test('Japanese table includes source, localized copy and Chinese meaning for every entry',()=>{
 const rows=fs.readFileSync('locales/copy.tsv','utf8').trim().split('\n').slice(1).map(l=>l.split('\t'));
 for(const row of rows){assert.equal(row.length,5);assert.ok(row[4]);}
 const table=fs.readFileSync('public/translations/ja.md','utf8');
 assert.match(table,/原本繁體中文 \| 日文 \| 日文的中文意思/);
 assert.equal(table.split('\n').filter(l=>l.startsWith('| ')).length,rows.length+1);
});
test('startup position is captured before paint and is not tied to live flex centering',()=>{
 const html=fs.readFileSync('index.html','utf8');
 const code=html.match(/<script id="boot-geometry">([\s\S]*?)<\/script>/)[1];
 const vars={};const sandbox={navigator:{standalone:true},screen:{width:393,height:852},window:{innerHeight:700,innerWidth:393,matchMedia:()=>({matches:false})},document:{documentElement:{style:{setProperty:(k,v)=>vars[k]=v}}}};
 vm.runInNewContext(code,sandbox);
 assert.equal(vars['--boot-logo-top'],'282px');
 sandbox.window.innerHeight=820;
 assert.equal(vars['--boot-logo-top'],'282px');
 assert.match(html,/top: var\(--boot-logo-top/);
});
test('language dialog contains only the title and language choices',()=>{
 const source=fs.readFileSync('components/HomePage.tsx','utf8');
 const dialog=source.slice(source.indexOf('{settingsOpen &&'),source.indexOf('{/* --- 聯絡方式'));
 assert.match(dialog,/aria-label="語言"/);
 assert.doesNotMatch(dialog,/<h3|<p /);
 const locale=fs.readFileSync('utils/locale.ts','utf8');
 assert.doesNotMatch(locale,/locale === getLocale\(\).*return/);
 assert.match(locale,/location.reload\(\)/);
});
test('font samples start before opening picker and export awaits font CSS',()=>{
 const app=fs.readFileSync('App.tsx','utf8'),fonts=fs.readFileSync('utils/fonts.ts','utf8');
 assert.match(app,/warmFontSamples\(\)/);
 assert.match(fonts,/async function waitForFont[^]*?await ensureFont\(family\)/);
 const panel=fs.readFileSync('components/GridLayoutTool.tsx','utf8');
 const card=panel.slice(panel.indexOf('const FontCard:'),panel.indexOf('/* ── 新增符號'));
 assert.doesNotMatch(card,/IntersectionObserver/);
 assert.match(panel,/warmTextFonts\(layer.text/);
});
test('all locales cover every key and preserve all interpolation placeholders',()=>{
 assert.ok(Object.keys(catalog).length>500);
 for(const [key,row] of Object.entries(catalog)) for(const lang of ['en','ja','ko','zh-Hans']){
  assert.ok(row[lang],`${key}: ${lang}`);
  assert.deepEqual([...row[lang].matchAll(/\{\d+\}/g)].map(x=>x[0]).sort(),[...key.matchAll(/\{\d+\}/g)].map(x=>x[0]).sort(),key+lang);
 }
});
test('compiler translates UI literals, not object IDs or dynamic project text',()=>{
 const sandbox={exports:{},require:n=>n==='typescript'?ts:n==='node:path'?path:catalog};
 vm.runInNewContext(transpile('scripts/localize-ui.ts'),sandbox);
 const plugin=sandbox.exports.localizeUI();
 const result=plugin.transform('const id="crop"; const UI=({project})=><button title="儲存">儲存{project.text}</button>;',path.resolve('components/Example.tsx'));
 assert.match(result.code,/__uiT\("儲存"\)/);
 assert.match(result.code,/\{project.text\}/);
 assert.match(result.code,/id="crop"/);
 assert.equal(plugin.transform('const text="儲存";',path.resolve('utils/symbolGeometry.ts')),undefined);
});
test('font category sizes are multiples of three',()=>{
 const source=fs.readFileSync('utils/fonts.ts','utf8');
 for(const [cat,count] of [['zh',12],['en',54],['ja',42],['ko',30]]){
  const block=source.match(new RegExp('const '+cat+'[\\s\\S]*?= \\[([\\s\\S]*?)\\n\\];'))[1];
  assert.equal((block.match(/\['/g)||[]).length,count); assert.equal(count%3,0);
 }
});
test('photo antialias inset is not clamped by global img max-width',()=>{
 const source=fs.readFileSync('components/GridLayoutTool.tsx','utf8');
 const start=source.indexOf('alt="floating-item"');
 assert.match(source.slice(start,start+1200),/maxWidth: 'none'/);
 assert.doesNotMatch(source,/data-page-seam-overlay/);
 assert.match(source,/vectorScene\.set\('__page-seams'/);
});
test('camera editor escapes camera safe-area and transform container',()=>{
 const source=fs.readFileSync('components/CameraInterface.tsx','utf8');
 assert.match(source,/editingPhoto && createPortal\(/);
 assert.match(source,/<div className="fixed inset-0 z-\[300\] bg-black" data-camera-editor>/);
 assert.match(source,/<\/div>, document.body/);
});
test('startup logo is available with the document, without changing minimum animation duration',()=>{
 const html=fs.readFileSync('index.html','utf8');
 const data=html.match(/src="data:image\/png;base64,([^"]+)"/)[1];
 const png=Buffer.from(data,'base64');
 assert.equal(png.subarray(1,4).toString(),'PNG');
 assert.ok(png.length>10000);
 assert.match(html,/BOOT_MIN_MS = 3000/);
 assert.match(html,/<style>html,body\{background:#000;margin:0\}/);
});
test('all new grid paths remain finite at square, stretched and small dimensions',()=>{
 const source=fs.readFileSync('components/GridLayoutTool.tsx','utf8');
 const start=source.indexOf('export const shapePathD =');
 const end=source.indexOf('\n};',start)+3;
 const js=ts.transpileModule(source.slice(start,end),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const sandbox={exports:{},r3:n=>Math.round(n*1000)/1000};vm.runInNewContext(js,sandbox);
 const kinds=['grid-dots-staggered','grid-dots-fade-diagonal','grid-diag-cross','grid-plus','grid-orbits','grid-chevron'];
 for(const kind of kinds) for(const [w,h] of [[160,160],[320,160],[160,320],[24,24]]){
  const d=sandbox.exports.shapePathD(kind,w,h);assert.ok(d.length>20,kind);assert.doesNotMatch(d,/NaN|Infinity/,kind);
 }
 assert.notEqual(sandbox.exports.shapePathD('grid-dots',160,160),sandbox.exports.shapePathD('grid-dots-staggered',160,160));
});
