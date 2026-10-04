import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from '/Users/abai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/dist/index.cjs';
import {repairLutAtlas} from '../utils/lutAtlasRepair.js';
const root=path.resolve(import.meta.dirname,'..');
const files=['assets/lowfi-lut.jpg','public/luts/f3.webp','public/luts/f19.webp'];
const results=[];
for(const file of files){
 const {data,info}=await sharp(path.join(root,file)).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const rg=info.width/8,bn=64;
 const at=(r,g,b,k)=>data[((Math.floor(b/8)*rg+g)*info.width+(b%8)*rg+r)*3+k];
 let maxCurvature=0,spikes=0,redSpikes=0;const examples=[];
 for(let b=1;b<bn-1;b++)for(let g=1;g<rg-1;g++)for(let r=1;r<rg-1;r++)for(let k=0;k<3;k++){
  const c=at(r,g,b,k),p=[(at(r-1,g,b,k)+at(r+1,g,b,k))/2,(at(r,g-1,b,k)+at(r,g+1,b,k))/2,(at(r,g,b-1,k)+at(r,g,b+1,k))/2];
  const residual=p.map(x=>c-x),same=residual.every(x=>x>12)||residual.every(x=>x< -12);
  maxCurvature=Math.max(maxCurvature,Math.min(...residual.map(Math.abs)));
  if(same&&Math.max(...p)-Math.min(...p)<8){spikes++;if(k===0&&residual[0]>0&&Math.max(r/rg,g/rg,b/bn)<.2){redSpikes++;if(examples.length<8)examples.push({r,g,b,c,p});}}
 }
 const repaired=repairLutAtlas(data,info.width,info.height);
 results.push({file,rg,bn,maxCurvature,spikes,redSpikes,examples,boundaryChanges:repaired.samples,maxBoundaryCorrection:repaired.maxDelta});
}
console.log(JSON.stringify(results,null,2));
