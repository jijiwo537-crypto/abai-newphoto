import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const d=await mkdtemp(join(tmpdir(),'abai-detents-'));
try{
 const out=join(d,'detents.mjs');await build({entryPoints:['utils/hapticDetents.ts'],bundle:true,platform:'node',format:'esm',outfile:out});
 const {crossedZero,crossedDialMark}=await import(pathToFileURL(out));
 for(const [p,n,expected]of [[1,0,true],[-1,0,true],[-.1,.1,true],[.1,-.1,true],[0,0,false],[0,.1,false],[0,-.1,false],[1,2,false],[NaN,0,false]])assert.equal(crossedZero(p,n),expected);
 const path=[4,2,0,0,0,2,0];let ticks=0;for(let i=1;i<path.length;i++)if(crossedZero(path[i-1],path[i]))ticks++;assert.equal(ticks,2,'only re-entering zero retriggers');
 assert.equal(crossedDialMark(0,2),false);assert.equal(crossedDialMark(2,4),true);assert.equal(crossedDialMark(0,-2),false);assert.equal(crossedDialMark(-2,-4),true);assert.equal(crossedDialMark(4,4),false);
 console.log('Haptic zero detents and symmetric jog tick boundaries passed');
}finally{await rm(d,{recursive:true,force:true});}
