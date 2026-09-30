// Font outlines are rasterized at the current screen pixel size. Only a small
// font atlas is uploaded, avoiding full-screen Canvas2D readbacks on iOS.
const states=new WeakMap();
export function paintColorGlyphs(canvas,layout,o,rect,viewport,dpr){
 try{
  let s=states.get(canvas);if(s===false)return false;
  if(!s){const gl=canvas.getContext('webgl',{alpha:true,antialias:false,premultipliedAlpha:true,preserveDrawingBuffer:true});if(!gl){states.set(canvas,false);return false;}
   const shader=(type,src)=>{const sh=gl.createShader(type);gl.shaderSource(sh,src);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw Error('glyph shader');return sh;};
   const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,'attribute vec2 p;attribute vec2 t;attribute vec3 c;varying vec2 uv;varying vec3 rgb;void main(){uv=t;rgb=c;gl_Position=vec4(p,0.,1.);}'));
   gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'precision mediump float;uniform sampler2D atlas;uniform vec2 blur;varying vec2 uv;varying vec3 rgb;void main(){float a=texture2D(atlas,uv).a;float g=0.;for(int i=0;i<8;i++){float angle=float(i)*.785398;vec2 d=vec2(cos(angle),sin(angle))*blur;g+=texture2D(atlas,uv+d).a;}a=max(a,g*.075);gl_FragColor=vec4(rgb*a,a);}'));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('glyph program');gl.useProgram(program);
   const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);for(const [name,size,offset] of [['p',2,0],['t',2,8],['c',3,16]]){const a=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,size,gl.FLOAT,false,28,offset);}
   const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);for(const name of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,name,gl.LINEAR);for(const name of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,name,gl.CLAMP_TO_EDGE);
   gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);s={gl,texture,buffer,blur:gl.getUniformLocation(program,'blur'),key:''};states.set(canvas,s);
  }
  const {gl}=s;if(gl.isContextLost())return false;
  const width=Math.round(viewport.width*dpr),height=Math.round(viewport.height*dpr);if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  const {w,h,cw,ch,lines,cols,data}=layout,sx=rect.width/w*dpr,sy=rect.height/h*dpr,x=(rect.left-viewport.left)*dpr,y=(rect.top-viewport.top)*dpr;
  const chars=[...new Set([...o.characters].slice(0,48))];if(!chars.length)chars.push('@');const font=cw*1.3*sx,key=JSON.stringify([chars,font,sy/sx]);
  if(s.key!==key){const pad=Math.ceil(font*.6),cellW=Math.ceil(font+pad*2),cellH=Math.ceil(font*sy/sx*1.6+pad*2),atlas=document.createElement('canvas');atlas.width=cellW*8;atlas.height=cellH*Math.ceil(chars.length/8);const g=atlas.getContext('2d');g.font=`${font}px monospace`;g.textBaseline='middle';g.fillStyle='#fff';for(let i=0;i<chars.length;i++){g.save();g.translate((i%8)*cellW+pad,Math.floor(i/8)*cellH+cellH/2);g.scale(1,sy/sx);g.fillText(chars[i],0,0);g.restore();}gl.bindTexture(gl.TEXTURE_2D,s.texture);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,atlas);Object.assign(s,{key,pad,cellW,cellH,atlasW:atlas.width,atlasH:atlas.height,indices:new Map(chars.map((c,i)=>[c,i]))});}
  const first=Math.max(0,Math.floor(-y/(sy*ch))-1),last=Math.min(lines.length,Math.ceil((height-y)/(sy*ch))+1),capacity=(last-first)*cols*42;if(!s.vertices||s.vertices.length<capacity)s.vertices=new Float32Array(capacity);const vertices=s.vertices;let n=0;
  const vertex=(a,b,u,v,k)=>{vertices[n++]=a;vertices[n++]=b;vertices[n++]=u;vertices[n++]=v;vertices[n++]=data[k]/255;vertices[n++]=data[k+1]/255;vertices[n++]=data[k+2]/255;};
  for(let row=first;row<last;row++){let col=0;for(const char of lines[row].text){const index=s.indices.get(char),column=col++;if(index===undefined||!char.trim())continue;const left=x+(column+.11)*cw*sx-s.pad,top=y+(row+.5)*ch*sy-s.cellH/2;if(left>width||left+s.cellW<0)continue;const l=left/width*2-1,r=(left+s.cellW)/width*2-1,t=1-top/height*2,b=1-(top+s.cellH)/height*2,u=(index%8)*s.cellW/s.atlasW,v=Math.floor(index/8)*s.cellH/s.atlasH,U=u+s.cellW/s.atlasW,V=v+s.cellH/s.atlasH,k=(row*cols+column)*4;vertex(l,t,u,v,k);vertex(r,t,U,v,k);vertex(l,b,u,V,k);vertex(l,b,u,V,k);vertex(r,t,U,v,k);vertex(r,b,U,V,k);}}
  gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.uniform2f(s.blur,o.glow?font*.16/s.atlasW:0,o.glow?font*.16/s.atlasH:0);gl.bindBuffer(gl.ARRAY_BUFFER,s.buffer);gl.bufferData(gl.ARRAY_BUFFER,vertices.subarray(0,n),gl.DYNAMIC_DRAW);gl.drawArrays(gl.TRIANGLES,0,n/7);return true;
 }catch{states.set(canvas,false);return false;}
}
