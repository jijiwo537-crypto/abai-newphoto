// Original ABAI region treatments. Use an explicit separable GPU kernel instead
// of Canvas filter, which is not implemented consistently in iOS WebKit.
export const MATERIALS=[['mosaic','像素'],['glass','霧玻璃'],['negative','負片']];
let gpu;
function gpuBlur(source,w,h,radius){
 if(gpu===false)return null;
 try{
  if(!gpu){const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:true});if(!gl){gpu=false;return null;}
   const shader=(kind,code)=>{const s=gl.createShader(kind);gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
   const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,'attribute vec2 p; varying vec2 uv; void main(){uv=(p+1.0)*.5;gl_Position=vec4(p,0.,1.);}'));
   gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'precision highp float; uniform sampler2D image;uniform vec2 direction;uniform float sigma;varying vec2 uv;void main(){vec4 sum=vec4(0.);float total=0.;float stepSize=max(1.,sigma/8.);for(int i=-24;i<=24;i++){float d=float(i)*stepSize;float weight=exp(-d*d/(2.*sigma*sigma));sum+=texture2D(image,uv+direction*d)*weight;total+=weight;}gl_FragColor=sum/total;}'));
   gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
   const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);const pos=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
   const texture=()=>{const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return t;};
   gpu={canvas,gl,input:texture(),temp:texture(),frame:gl.createFramebuffer(),direction:gl.getUniformLocation(program,'direction'),sigma:gl.getUniformLocation(program,'sigma'),source:null,w:0,h:0};
  }
  const {canvas,gl}=gpu;if(gl.isContextLost()){gpu=false;return null;}
  if(gpu.w!==w||gpu.h!==h){canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h);gl.bindTexture(gl.TEXTURE_2D,gpu.temp);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gpu.w=w;gpu.h=h;gpu.source=null;}
  gl.bindTexture(gl.TEXTURE_2D,gpu.input);
  if(gpu.source!==source){const sample=document.createElement('canvas');sample.width=w;sample.height=h;sample.getContext('2d').drawImage(source,0,0,w,h);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,sample);gpu.source=source;}
  gl.uniform1f(gpu.sigma,Math.max(.25,radius));gl.bindFramebuffer(gl.FRAMEBUFFER,gpu.frame);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,gpu.temp,0);gl.uniform2f(gpu.direction,1/w,0);gl.drawArrays(gl.TRIANGLES,0,6);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindTexture(gl.TEXTURE_2D,gpu.temp);gl.uniform2f(gpu.direction,0,1/h);gl.drawArrays(gl.TRIANGLES,0,6);return canvas;
 }catch{gpu=false;return null;}
}
export function blurRGBA(data,w,h,radius){
 let a=new Uint8ClampedArray(data),b=new Uint8ClampedArray(a.length);
 const r=Math.max(1,Math.round(radius)),diam=2*r+1;
 for(let pass=0;pass<3;pass++)for(let axis=0;axis<2;axis++){
  const major=axis?h:w,minor=axis?w:h,stride=axis?w:1;
  for(let line=0;line<minor;line++)for(let ch=0;ch<4;ch++){
   const base=axis?line:line*w;let sum=0;
   for(let i=-r;i<=r;i++)sum+=a[(base+Math.max(0,Math.min(major-1,i))*stride)*4+ch];
   for(let i=0;i<major;i++){b[(base+i*stride)*4+ch]=sum/diam;sum+=a[(base+Math.min(major-1,i+r+1)*stride)*4+ch]-a[(base+Math.max(0,i-r)*stride)*4+ch];}
  }[a,b]=[b,a];
 }return a;
}
export function blurredSource(source,radius){
 // Only the deliberately blurred material is band-limited. The photograph and
 // analytic overlay retain their original/vector resolution at every zoom.
 const scale=Math.min(1,1200/Math.max(source.width,source.height),6/Math.max(1,radius));
 if(radius>0){const accelerated=gpuBlur(source,Math.max(1,Math.round(source.width*scale)),Math.max(1,Math.round(source.height*scale)),radius*scale);if(accelerated)return accelerated;}
 const c=document.createElement('canvas');c.width=Math.max(1,Math.round(source.width*scale));c.height=Math.max(1,Math.round(source.height*scale));
 const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(source,0,0,c.width,c.height);
 if(radius>0){const im=g.getImageData(0,0,c.width,c.height);im.data.set(blurRGBA(im.data,c.width,c.height,radius*scale*.58));g.putImageData(im,0,0);}return c;
}
export function makeLinks(nodes,mode,maxDistance){
 if(mode==='none'||nodes.length<2)return [];
 if(mode==='radial'){const center=nodes.reduce((a,b)=>a.score>b.score?a:b);return nodes.filter(n=>n!==center).map(n=>[center,n]);}
 if(mode==='tree'){
  // Prim's algorithm with retained nearest distances: O(n²), not O(n³).
  const used=new Uint8Array(nodes.length),distance=new Float64Array(nodes.length).fill(Infinity),parents=new Int32Array(nodes.length).fill(-1),edges=[];distance[0]=0;
  for(let step=0;step<nodes.length;step++){let best=-1;for(let j=0;j<nodes.length;j++)if(!used[j]&&(best<0||distance[j]<distance[best]))best=j;
   used[best]=1;if(parents[best]>=0)edges.push([nodes[parents[best]],nodes[best]]);
   for(let j=0;j<nodes.length;j++)if(!used[j]){const dx=nodes[j].x-nodes[best].x,dy=nodes[j].y-nodes[best].y,d=dx*dx+dy*dy;if(d<distance[j]){distance[j]=d;parents[j]=best;}}
  }return edges;
 }
 const edges=[];for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++)if(Math.hypot(nodes[i].x-nodes[j].x,nodes[i].y-nodes[j].y)<=maxDistance)edges.push([nodes[i],nodes[j]]);return edges;
}
