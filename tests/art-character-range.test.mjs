import test from 'node:test';
import assert from 'node:assert/strict';
import {ASCII_PRESETS,ASCII_RANGE_LOWS,withAsciiPreset,withAsciiCoverage,withAsciiMetric} from '../utils/asciiControls.js';
import {artCharacters,needsCellFitting,fitArtGlyph} from '../utils/artCharacters.js';
test('exact requested presets, without invented leading spaces',()=>assert.deepEqual(ASCII_PRESETS,['.:-=+*#/@','·。•o','01','⭒✧✦⭑✶']));
test('binary preset restores density 100 without resetting other settings',()=>{
 const s={columns:96,glow:50,low:20,color:false};assert.deepEqual(withAsciiPreset(s,'01'),{...s,characters:'01',columns:100});assert.equal(withAsciiPreset(s,ASCII_PRESETS[3]).columns,96);
});
test('coverage increases to the right and remembers independent mode defaults',()=>{
 let s={metric:0,low:20,high:100};assert.deepEqual(ASCII_RANGE_LOWS,[20,20,10,20]);
 for(const [metric,coverage] of [[0,80],[3,80],[1,80],[2,90]]){s=withAsciiMetric(s,metric);assert.equal(100-s.low,coverage);}
 s=withAsciiCoverage(s,100);assert.equal(s.low,0);s=withAsciiCoverage(s,0);assert.equal(s.low,100);
 s=withAsciiCoverage(s,76);s=withAsciiMetric(s,0);assert.equal(100-s.low,80);s=withAsciiMetric(s,2);assert.equal(100-s.low,76);
});
test('CJK, decomposed Hangul, kana marks and emoji remain one grapheme per cell',()=>{
 assert.deepEqual(artCharacters('中あ한한か\u3099👩‍🎨'),['中','あ','한','한','か\u3099','👩‍🎨']);
 assert.equal(needsCellFitting(artCharacters('abc#')),false);assert.equal(needsCellFitting(artCharacters('中#')),true);
 assert.equal(artCharacters('中'.repeat(60)).length,48);
});
test('wide glyphs and negative bearings fit inside a centered cell',()=>{
 const ctx={font:'',measureText(){const size=parseFloat(this.font);return{width:size,actualBoundingBoxLeft:size*.1,actualBoundingBoxRight:size,actualBoundingBoxAscent:size*.8,actualBoundingBoxDescent:size*.2};}};
 const m=fitArtGlyph(ctx,'韓',13,8.2,13.6);assert.ok(m.width<=8.2+1e-9);assert.ok(m.height<=13.6+1e-9);assert.ok(m.font<13);assert.equal(ctx.textBaseline,'alphabetic');
 assert.ok(Math.abs(m.x+m.width/2-m.font*.1)<1e-9);
});
