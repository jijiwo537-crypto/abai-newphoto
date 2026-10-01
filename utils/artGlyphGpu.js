// Font outlines are rasterized at the current screen pixel size. Only a small
// font atlas is uploaded, avoiding full-screen Canvas2D readbacks on iOS.
const states=new WeakMap();
import {fitArtGlyph} from './artCharacters.js';
// Isolated glyphs at the current physical pixel size. Halo generation uses
// a separable GPU Gaussian: WebKit's large Canvas shadows can become square.
export function makeGlyphAtlases(chars,font,ratio,cw,ch,cellFit){
 const sigma=cw*.16,pad=Math.ceil(Math.max(font*.6,sigma*4+2));
 const cellW=Math.ceil(Math.max(font,cw)+pad*2),cellH=Math.ceil(Math.max(font*ratio*1.6,ch)+pad*2);
 const ink=document.createElement('canvas');ink.width=cellW*8;ink.height=cellH*Math.ceil(chars.length/8);
 const g=ink.getContext('2d');g.fillStyle='#fff';
  for(let i=0;i<chars.length;i++){
   const left=(i%8)*cellW,top=Math.floor(i/8)*cellH;
   g.save();g.beginPath();g.rect(left,top,cellW,cellH);g.clip();
   g.translate(left+pad,top+cellH/2);g.scale(1,ratio);
   if(cellFit){const m=fitArtGlyph(g,chars[i],font,cw*.82,ch/ratio*.82);g.fillText(chars[i],cw/2+m.x,m.y);}
   else{g.font=`${font}px monospace`;g.textBaseline='middle';g.fillText(chars[i],0,0);}
   g.restore();
  }
 return{ink,sigma,pad,cellW,cellH};
}
function blurGlyphAtlas(s,ink,sigma,cellW,cellH){
 const {gl}=s;
 // Glow is a low-frequency field, unlike the sharp ink. Integrate coverage
 // before Gaussian sampling so a large glyph cannot produce a striped halo
 // from widely spaced kernel taps. Ink always retains full screen resolution.
 const shrink=Math.min(1,4/sigma),workCellW=Math.ceil(cellW*shrink),workCellH=Math.ceil(cellH*shrink);
 let softInk=ink;
 if(shrink<1){
  softInk=document.createElement('canvas');softInk.width=workCellW*8;softInk.height=workCellH*(ink.height/cellH);
  const g=softInk.getContext('2d');g.imageSmoothingQuality='high';
  for(let row=0;row<ink.height/cellH;row++)for(let col=0;col<8;col++)g.drawImage(ink,col*cellW,row*cellH,cellW,cellH,col*workCellW,row*workCellH,workCellW,workCellH);
 }
 const width=softInk.width,height=softInk.height;
 if(!s.gaussian){
  const shader=(type,code)=>{const sh=gl.createShader(type);gl.shaderSource(sh,code);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw Error('halo shader');return sh;};
  const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,'attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}'));
  gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'precision highp float;uniform sampler2D source;uniform vec2 delta,cell;varying vec2 uv;void main(){vec2 origin=floor(uv/cell)*cell;float a=0.;float weight=0.;for(int i=-16;i<=16;i++){float x=float(i)/5.;float w=exp(-.5*x*x);vec2 q=uv+float(i)*delta;float inside=step(origin.x,q.x)*step(origin.y,q.y)*(1.-step(origin.x+cell.x,q.x))*(1.-step(origin.y+cell.y,q.y));a+=texture2D(source,q).a*w*inside;weight+=w;}a/=weight;gl_FragColor=vec4(vec3(a),a);}'));
  gl.bindAttribLocation(program,0,'p');gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('halo program');
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  const textures=[0,1].map(()=>{const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);for(const name of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,name,gl.LINEAR);for(const name of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,name,gl.CLAMP_TO_EDGE);return t;});
  s.gaussian={program,buffer,temp:textures[0],input:textures[1],frames:[gl.createFramebuffer(),gl.createFramebuffer()],delta:gl.getUniformLocation(program,'delta'),cell:gl.getUniformLocation(program,'cell')};
 }
 const b=s.gaussian;gl.useProgram(b.program);gl.disable(gl.BLEND);gl.activeTexture(gl.TEXTURE0);
 gl.bindTexture(gl.TEXTURE_2D,b.input);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,softInk);
 gl.uniform1i(gl.getUniformLocation(b.program,'source'),0);gl.uniform2f(b.cell,workCellW/width,workCellH/height);
 for(let i=0;i<3;i++)gl.disableVertexAttribArray(i);gl.bindBuffer(gl.ARRAY_BUFFER,b.buffer);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);gl.viewport(0,0,width,height);
 for(let pass=0;pass<2;pass++){
  const target=pass===0?b.temp:s.textures[1];gl.bindTexture(gl.TEXTURE_2D,target);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  gl.bindFramebuffer(gl.FRAMEBUFFER,b.frames[pass]);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('halo framebuffer');
  gl.bindTexture(gl.TEXTURE_2D,pass===0?b.input:b.temp);gl.uniform2f(b.delta,pass===0?sigma*(workCellW/cellW)/(5*width):0,pass===1?sigma*(workCellH/cellH)/(5*height):0);gl.drawArrays(gl.TRIANGLES,0,6);
 }
 gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.enable(gl.BLEND);gl.useProgram(s.program);
 for(let unit=0;unit<2;unit++){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,s.textures[unit]);}
 if(softInk!==ink)softInk.width=softInk.height=0;
}
export function paintColorGlyphs(canvas,layout,o,rect,viewport,dpr){
 try{
  let s=states.get(canvas);if(s===false)return false;
  if(!s){const gl=canvas.getContext('webgl',{alpha:true,antialias:false,premultipliedAlpha:true,preserveDrawingBuffer:true});if(!gl){states.set(canvas,false);return false;}
   const shader=(type,src)=>{const sh=gl.createShader(type);gl.shaderSource(sh,src);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw Error('glyph shader');return sh;};
   const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,'attribute vec2 p;attribute vec2 t;attribute vec3 c;varying vec2 uv;varying vec3 rgb;void main(){uv=t;rgb=c;gl_Position=vec4(p,0.,1.);}'));
   gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'precision highp float;uniform sampler2D atlas;uniform sampler2D halo;uniform float glow;varying vec2 uv;varying vec3 rgb;void main(){float ink=texture2D(atlas,uv).a;float soft=texture2D(halo,uv).a*glow;float a=ink+soft*(1.-ink);gl_FragColor=vec4(rgb*a,a);}'));for(const [i,name] of ['p','t','c'].entries())gl.bindAttribLocation(program,i,name);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('glyph program');gl.useProgram(program);
   const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);for(const [name,size,offset] of [['p',2,0],['t',2,8],['c',3,16]]){const a=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,size,gl.FLOAT,false,28,offset);}
   const textures=[0,1].map(unit=>{const texture=gl.createTexture();gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,texture);for(const name of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,name,gl.LINEAR);for(const name of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,name,gl.CLAMP_TO_EDGE);return texture;});
   gl.uniform1i(gl.getUniformLocation(program,'atlas'),0);gl.uniform1i(gl.getUniformLocation(program,'halo'),1);
   gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);s={gl,program,textures,buffer,glow:gl.getUniformLocation(program,'glow'),key:''};states.set(canvas,s);
  }
  const {gl}=s;if(gl.isContextLost())return false;
  const width=Math.round(viewport.width*dpr),height=Math.round(viewport.height*dpr);if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  const {w,h,cw,ch,lines,cols,data,cellFit}=layout,sx=rect.width/w*dpr,sy=rect.height/h*dpr,x=(rect.left-viewport.left)*dpr,y=(rect.top-viewport.top)*dpr;
  const chars=[...new Set(layout.chars)],font=cw*1.3*sx,key=JSON.stringify([chars,font,sy/sx]);
  if(s.key!==key){const {ink,sigma,pad,cellW,cellH}=makeGlyphAtlases(chars,font,sy/sx,cw*sx,ch*sy,cellFit);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,s.textures[0]);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,ink);blurGlyphAtlas(s,ink,sigma,cellW,cellH);Object.assign(s,{key,pad,cellW,cellH,atlasW:ink.width,atlasH:ink.height,indices:new Map(chars.map((c,i)=>[c,i]))});ink.width=ink.height=0;}
  const first=Math.max(0,Math.floor(-y/(sy*ch))-1),last=Math.min(lines.length,Math.ceil((height-y)/(sy*ch))+1),capacity=(last-first)*cols*42;if(!s.vertices||s.vertices.length<capacity)s.vertices=new Float32Array(capacity);const vertices=s.vertices;let n=0;
  const vertex=(a,b,u,v,k)=>{vertices[n++]=a;vertices[n++]=b;vertices[n++]=u;vertices[n++]=v;vertices[n++]=o.color?data[k]/255:1;vertices[n++]=o.color?data[k+1]/255:1;vertices[n++]=o.color?data[k+2]/255:1;};
  for(let row=first;row<last;row++){let col=0;for(const char of lines[row].cells){const index=s.indices.get(char),column=col++;if(index===undefined||!char.trim())continue;const left=x+(column+(cellFit?0:.11))*cw*sx-s.pad,top=y+(row+.5)*ch*sy-s.cellH/2;if(left>width||left+s.cellW<0)continue;const l=left/width*2-1,r=(left+s.cellW)/width*2-1,t=1-top/height*2,b=1-(top+s.cellH)/height*2,u=(index%8)*s.cellW/s.atlasW,v=Math.floor(index/8)*s.cellH/s.atlasH,U=u+s.cellW/s.atlasW,V=v+s.cellH/s.atlasH,k=(row*cols+column)*4;vertex(l,t,u,v,k);vertex(r,t,U,v,k);vertex(l,b,u,V,k);vertex(l,b,u,V,k);vertex(r,t,U,v,k);vertex(r,b,U,V,k);}}
  gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.uniform1f(s.glow,o.glow?1:0);gl.bindBuffer(gl.ARRAY_BUFFER,s.buffer);gl.bufferData(gl.ARRAY_BUFFER,vertices.subarray(0,n),gl.DYNAMIC_DRAW);for(const [i,size,offset] of [[0,2,0],[1,2,8],[2,3,16]]){gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,size,gl.FLOAT,false,28,offset);}gl.drawArrays(gl.TRIANGLES,0,n/7);return true;
 }catch{states.set(canvas,false);return false;}
}
