import {paintColorGlyphs} from './artGlyphGpu.js';
import {artCharacters,needsCellFitting,fitArtGlyph} from './artCharacters.js';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
// Retain analytic paths and font outlines in the DOM, never a zoomed bitmap.
export class SVGContext{
 constructor(){this.parts=[];this.path='';this.stack=[];this.globalAlpha=1;this.strokeStyle=this.fillStyle='white';this.lineWidth=1;this.font='12px monospace';this.textAlign='left';this.textBaseline='alphabetic';this.dash=[];}
 save(){this.stack.push({globalAlpha:this.globalAlpha,strokeStyle:this.strokeStyle,fillStyle:this.fillStyle,lineWidth:this.lineWidth,font:this.font,textAlign:this.textAlign,textBaseline:this.textBaseline,dash:this.dash});}
 restore(){Object.assign(this,this.stack.pop());}beginPath(){this.path='';}moveTo(x,y){this.path+=`M${x} ${y}`;}lineTo(x,y){this.path+=`L${x} ${y}`;}
 arc(x,y,r,start=0,end=Math.PI*2,anticlockwise=false){if(Math.abs(end-start)>=Math.PI*2){this.path+=`M${x+r} ${y}a${r} ${r} 0 1 0 ${-2*r} 0a${r} ${r} 0 1 0 ${2*r} 0`;return;}const delta=anticlockwise?(start-end+Math.PI*2)%(Math.PI*2):(end-start+Math.PI*2)%(Math.PI*2);this.path+=`M${x+Math.cos(start)*r} ${y+Math.sin(start)*r}A${r} ${r} 0 ${delta>Math.PI?1:0} ${anticlockwise?0:1} ${x+Math.cos(end)*r} ${y+Math.sin(end)*r}`;}
 rect(x,y,w,h){this.path+=`M${x} ${y}h${w}v${h}h${-w}Z`;}
 stroke(){this.parts.push(`<path d="${this.path}" fill="none" stroke="${escape(this.strokeStyle)}" stroke-width="${this.lineWidth}" opacity="${this.globalAlpha}" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="${this.dash.join(' ')}"/>`);}
 fill(){this.parts.push(`<path d="${this.path}" fill="${escape(this.fillStyle)}" opacity="${this.globalAlpha}"/>`);}
 strokeRect(x,y,w,h){this.beginPath();this.rect(x,y,w,h);this.stroke();}setLineDash(v){this.dash=v;}
 measureText(t){return{width:t.length*parseFloat(this.font)*.6};}
 fillText(t,x,y){this.parts.push(`<text x="${x}" y="${y}" fill="${escape(this.fillStyle)}" opacity="${this.globalAlpha}" font-family="monospace" font-size="${parseFloat(this.font)}" text-anchor="${this.textAlign==='right'?'end':this.textAlign==='center'?'middle':'start'}" dominant-baseline="${this.textBaseline==='top'?'hanging':this.textBaseline==='bottom'?'text-after-edge':'alphabetic'}">${escape(t)}</text>`);}
 fillRect(){}drawImage(){}clip(){}
}
let sampled=null;
export function asciiLayout(source,o){
 const w=source.width,h=source.height,cols=Math.round(o.columns),rows=Math.max(1,Math.round(cols*h/w*.6)),key=`${cols}:${rows}`;
 if(sampled?.source!==source||sampled.key!==key){const c=document.createElement('canvas');c.width=cols;c.height=rows;const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(source,0,0,cols,rows);sampled={source,key,data:g.getImageData(0,0,cols,rows).data,canvas:c,colors:null};}
 const d=sampled.data,chars=artCharacters(o.characters);if(!chars.length)chars.push('@');
 const cw=w/cols,ch=h/rows,lum=i=>(d[i]*.2126+d[i+1]*.7152+d[i+2]*.0722)/255;const lines=Array.from({length:rows},()=>({text:'',cells:[]}));
 for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const i=(y*cols+x)*4;let v=lum(i);
 if(o.metric===3)v=1-v;else if(o.metric===2)v=(Math.max(d[i],d[i+1],d[i+2])-Math.min(d[i],d[i+1],d[i+2]))/255;
 else if(o.metric===1){const a=lum((y*cols+Math.max(0,x-1))*4),b=lum((y*cols+Math.min(cols-1,x+1))*4),a2=lum((Math.max(0,y-1)*cols+x)*4),b2=lum((Math.min(rows-1,y+1)*cols+x)*4);v=Math.min(1,Math.hypot(a-b,a2-b2)*4);}
 v=Math.max(0,Math.min(1,(v-o.low/100)/Math.max(.001,1-o.low/100)));const char=v<.001?' ':chars[Math.min(chars.length-1,Math.floor(v*chars.length))];lines[y].text+=char;lines[y].cells.push(char);
 }
 return{w,h,cols,rows,cw,ch,lines,chars,cellFit:needsCellFitting(chars),colors:sampled.canvas,data:d};
}
export function asciiVector(source,o){
 const {w,h,cols,cw,ch,lines,chars,cellFit}=asciiLayout(source,o);let out='';
 // One vector text run per row, even in original-color mode. The tiny sampling
 // map supplies only the fill color, not the glyph edges or their resolution.
 // Nearest-neighbor cells retain the same flat sample colors as individual glyphs.
 out=lines.map((line,y)=>line.text.trim()?`<text x="${cw*.11}" y="${(y+.5)*ch}" xml:space="preserve" textLength="${(cols-.22)*cw}" lengthAdjust="spacing" fill="#fff">${escape(line.text)}</text>`:'').join('');
 if(cellFit){const g=document.createElement('canvas').getContext('2d'),metrics=new Map(chars.map(c=>[c,fitArtGlyph(g,c,cw*1.3,cw*.82,ch*.82)]));out=lines.map((line,y)=>line.cells.map((c,x)=>{const m=metrics.get(c);return !m||!c.trim()?'':`<text x="${(x+.5)*cw+m.x}" y="${(y+.5)*ch+m.y}" font-size="${m.font}" dominant-baseline="alphabetic" fill="#fff">${escape(c)}</text>`;}).join('')).join('');}
 // clipPath children must be direct shapes/text, not a nested <g> (WebKit and
 // Chromium discard grouped clipping text). Inherit typography on the clip.
 const glyphs=`<clipPath id="glyph-ink" font-family="monospace" font-size="${cw*1.3}" dominant-baseline="central" style="white-space:pre;font-kerning:none;font-variant-ligatures:none">${out}</clipPath>`;
 const glow=o.glow?`<defs><filter id="glyph-glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="${cw*.16}"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`:'';
 // Both white and colored glyphs share one analytic clipping layer. Individual
 // text paints needlessly re-rasterize each row in WebKit while sliders move.
 if(o.color&&!sampled.colors)sampled.colors=sampled.canvas.toDataURL('image/png');
 return `<defs>${glyphs}</defs>${glow}<g ${o.glow?'filter="url(#glyph-glow)"':''}>${o.color?`<image href="${sampled.colors}" width="${w}" height="${h}" preserveAspectRatio="none" style="image-rendering:pixelated" clip-path="url(#glyph-ink)"/>`:`<rect width="${w}" height="${h}" fill="white" clip-path="url(#glyph-ink)"/>`}</g>`;
}
let inkLayout;
export function paintAsciiViewport(target,mask,source,o,rect,viewport,dpr,colored){
 // Rasterize the font outlines directly at the current screen pixel density,
 // never magnify an image-sized glyph bitmap. The backing is the visible
 // viewport, not a giant offscreen photo. Every zoom frame remains sharp.
 const key=JSON.stringify([o.columns,o.characters,o.metric,o.low]);
 if(inkLayout?.source!==source||inkLayout.key!==key)inkLayout={source,key,layout:asciiLayout(source,o)};
 const {cw,ch,lines,colors,w,h,chars,cellFit}=inkLayout.layout;
 const width=Math.round(viewport.width*dpr),height=Math.round(viewport.height*dpr);
 if((o.color||cellFit)&&colored&&paintColorGlyphs(colored,inkLayout.layout,o,rect,viewport,dpr)){colored.style.display='block';target.style.display='none';return;}
 for(const c of [target,mask])if(c.width!==width||c.height!==height){c.width=width;c.height=height;}
 const g=mask.getContext('2d'),ctx=target.getContext('2d');g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,width,height);ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,width,height);
 const sx=rect.width/w*dpr,sy=rect.height/h*dpr,x=(rect.left-viewport.left)*dpr,y=(rect.top-viewport.top)*dpr;
 g.save();g.translate(x,y);g.scale(sx,sy);g.font=`${cw*1.3}px monospace`;g.textBaseline='middle';g.fillStyle='#fff';
 const advance=g.measureText('M').width,spaced='letterSpacing' in g;if(spaced)g.letterSpacing=`${cw-advance}px`;
 const first=Math.max(0,Math.floor(-y/(sy*ch))-1),last=Math.min(lines.length,Math.ceil((height-y)/(sy*ch))+1);
 if(cellFit){if(spaced)g.letterSpacing='0px';const metrics=new Map(chars.map(c=>[c,fitArtGlyph(g,c,cw*1.3,cw*.82,ch*.82)]));for(let row=first;row<last;row++)for(const [col,char] of lines[row].cells.entries()){const m=metrics.get(char);if(!m||!char.trim())continue;g.font=`${m.font}px monospace`;g.fillText(char,(col+.5)*cw+m.x,(row+.5)*ch+m.y);}}
 else for(let row=first;row<last;row++){if(!lines[row].text.trim())continue;if(spaced)g.fillText(lines[row].text,cw*.11,(row+.5)*ch);else{g.textAlign='center';for(const [col,char] of lines[row].cells.entries())if(char.trim())g.fillText(char,(col+.5)*cw,(row+.5)*ch);}}
 g.restore();
 ctx.save();if(o.glow){ctx.shadowColor=o.color?'#ffffff99':'#fff';ctx.shadowBlur=cw*sx*.32;}ctx.drawImage(mask,0,0);ctx.restore();
 if(o.color){
  if(colored)colored.style.display='none';target.style.display='block';ctx.save();ctx.globalCompositeOperation='source-in';ctx.imageSmoothingEnabled=false;ctx.drawImage(colors,x,y,rect.width*dpr,rect.height*dpr);ctx.restore();
 }else{if(colored)colored.style.display='none';target.style.display='block';}
}
