const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
// Retain analytic paths and font outlines in the DOM, never a zoomed bitmap.
export class SVGContext{
 constructor(){this.parts=[];this.path='';this.stack=[];this.globalAlpha=1;this.strokeStyle=this.fillStyle='white';this.lineWidth=1;this.font='12px monospace';this.textAlign='left';this.textBaseline='alphabetic';this.dash=[];}
 save(){this.stack.push({globalAlpha:this.globalAlpha,strokeStyle:this.strokeStyle,fillStyle:this.fillStyle,lineWidth:this.lineWidth,font:this.font,textAlign:this.textAlign,textBaseline:this.textBaseline,dash:this.dash});}
 restore(){Object.assign(this,this.stack.pop());}beginPath(){this.path='';}moveTo(x,y){this.path+=`M${x} ${y}`;}lineTo(x,y){this.path+=`L${x} ${y}`;}
 arc(x,y,r){this.path+=`M${x+r} ${y}a${r} ${r} 0 1 0 ${-2*r} 0a${r} ${r} 0 1 0 ${2*r} 0`;}
 rect(x,y,w,h){this.path+=`M${x} ${y}h${w}v${h}h${-w}Z`;}
 stroke(){this.parts.push(`<path d="${this.path}" fill="none" stroke="${escape(this.strokeStyle)}" stroke-width="${this.lineWidth}" opacity="${this.globalAlpha}" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="${this.dash.join(' ')}"/>`);}
 fill(){this.parts.push(`<path d="${this.path}" fill="${escape(this.fillStyle)}" opacity="${this.globalAlpha}"/>`);}
 strokeRect(x,y,w,h){this.beginPath();this.rect(x,y,w,h);this.stroke();}setLineDash(v){this.dash=v;}
 measureText(t){return{width:t.length*parseFloat(this.font)*.6};}
 fillText(t,x,y){this.parts.push(`<text x="${x}" y="${y}" fill="${escape(this.fillStyle)}" opacity="${this.globalAlpha}" font-family="monospace" font-size="${parseFloat(this.font)}" text-anchor="${this.textAlign==='right'?'end':this.textAlign==='center'?'middle':'start'}" dominant-baseline="${this.textBaseline==='top'?'hanging':this.textBaseline==='bottom'?'text-after-edge':'alphabetic'}">${escape(t)}</text>`);}
 fillRect(){}drawImage(){}clip(){}
}
let sampled=null;
export function asciiVector(source,o){
 const w=source.width,h=source.height,cols=Math.round(o.columns),rows=Math.max(1,Math.round(cols*h/w*.6)),key=`${cols}:${rows}`;
 if(sampled?.source!==source||sampled.key!==key){const c=document.createElement('canvas');c.width=cols;c.height=rows;const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(source,0,0,cols,rows);sampled={source,key,data:g.getImageData(0,0,cols,rows).data};}
 const d=sampled.data,chars=[...o.characters].slice(0,48);if(!chars.length)chars.push('@');
 const cw=w/cols,ch=h/rows,lum=i=>(d[i]*.2126+d[i+1]*.7152+d[i+2]*.0722)/255;let out='';const lines=Array.from({length:rows},()=>({text:'',xs:[]}));
 for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const i=(y*cols+x)*4;let v=lum(i);
 if(o.metric===3)v=1-v;else if(o.metric===2)v=(Math.max(d[i],d[i+1],d[i+2])-Math.min(d[i],d[i+1],d[i+2]))/255;
 else if(o.metric===1){const a=lum((y*cols+Math.max(0,x-1))*4),b=lum((y*cols+Math.min(cols-1,x+1))*4),a2=lum((Math.max(0,y-1)*cols+x)*4),b2=lum((Math.min(rows-1,y+1)*cols+x)*4);v=Math.min(1,Math.hypot(a-b,a2-b2)*4);}
 v=Math.max(0,Math.min(1,(v-o.low/100)/Math.max(.001,1-o.low/100)));if(v<.001)continue;const char=chars[Math.min(chars.length-1,Math.floor(v*chars.length))];if(!char.trim())continue;
 if(!o.color){lines[y].text+=char;lines[y].xs.push((x+.5)*cw);}else out+=`<text x="${(x+.5)*cw}" y="${(y+.5)*ch}" fill="rgb(${d[i]},${d[i+1]},${d[i+2]})">${escape(char)}</text>`;
 }
 if(!o.color)out=lines.map((line,y)=>line.text?`<text x="${line.xs.join(' ')}" y="${(y+.5)*ch}" fill="#fff">${escape(line.text)}</text>`:'').join('');
 const glow=o.glow?`<defs><filter id="glyph-glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="${cw*.16}"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`:'';
 return `${glow}<g font-family="monospace" font-size="${cw*1.3}" text-anchor="middle" dominant-baseline="central" ${o.glow?'filter="url(#glyph-glow)"':''}>${out}</g>`;
}
