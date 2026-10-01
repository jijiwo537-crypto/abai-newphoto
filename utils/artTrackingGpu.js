// Native-resolution material composition: no per-frame GPU -> 2D readback.
// Analytic overlay remains SVG. Material ordering and circular exclusions use
// the same scene as the Canvas fallback, with no gesture-time quality switch.
import {trackingMaterialScene} from './artTracking.js';
import {mosaicGrid} from './artSampling.js';
const states=new WeakMap();
function blurMaterialTexture(s,w,h,radius){
 const {gl}=s,key=`${w}:${h}:${radius}`;if(s.blurKey===key)return;
 const scale=Math.min(1,1200/Math.max(w,h),6/Math.max(1,radius)),bw=Math.max(1,Math.round(w*scale)),bh=Math.max(1,Math.round(h*scale));
 if(s.blurW!==bw||s.blurH!==bh){for(const texture of [s.blurTemp,s.glass]){gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,bw,bh,0,gl.RGBA,gl.UNSIGNED_BYTE,null);}s.blurW=bw;s.blurH=bh;}
 gl.useProgram(s.blurProgram);gl.viewport(0,0,bw,bh);gl.disable(gl.BLEND);gl.bindFramebuffer(gl.FRAMEBUFFER,s.blurFrame);
 gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,s.original);gl.uniform1i(s.blurImage,0);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,s.blurTemp,0);gl.uniform2f(s.blurDirection,1/w,0);gl.uniform1f(s.blurSigma,Math.max(.25,radius));gl.drawArrays(gl.TRIANGLES,0,6);
 gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,s.blurTemp);gl.uniform1i(s.blurImage,1);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,s.glass,0);gl.uniform2f(s.blurDirection,0,1/bh);gl.uniform1f(s.blurSigma,Math.max(.25,radius*scale));gl.drawArrays(gl.TRIANGLES,0,6);
 gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.useProgram(s.program);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,s.glass);gl.viewport(0,0,w,h);s.blurKey=key;
}
export function paintTrackingMaterials(canvas,source,options){
 try{
  let s=states.get(canvas);if(s===false)return false;
  if(!s){
   const gl=canvas.getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:true});if(!gl){states.set(canvas,false);return false;}
   const shader=(type,src)=>{const sh=gl.createShader(type);gl.shaderSource(sh,src);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(sh));return sh;};
   const program=gl.createProgram();
   gl.attachShader(program,shader(gl.VERTEX_SHADER,'attribute vec2 p;uniform vec2 size;uniform vec4 rect;varying vec2 uv;void main(){vec2 q=rect.xy+p*rect.zw;uv=vec2(q.x/size.x,1.-q.y/size.y);gl_Position=vec4(uv*2.-1.,0.,1.);}'));
   gl.attachShader(program,shader(gl.FRAGMENT_SHADER,`precision highp float;
    uniform sampler2D image;uniform sampler2D frosted;uniform vec2 size;uniform vec4 rect;uniform vec2 tiles;uniform float mode;uniform float imageOpacity;uniform int circleCount;uniform vec3 circles[150];varying vec2 uv;
    void main(){vec2 q=vec2(uv.x,1.-uv.y)*size;float a=1.;
     if(mode>.5){for(int i=0;i<150;i++){if(i>=circleCount)break;a*=smoothstep(-.5,.5,length(q-circles[i].xy)-circles[i].z);}if(a<=0.)discard;}
     vec4 color=texture2D(image,uv);
     if(mode<.5){a=color.a*imageOpacity;}
     else if(mode<1.5){vec2 cell=(floor((q-rect.xy)/rect.zw*tiles)+.5)/tiles;vec2 t=(rect.xy+cell*rect.zw)/size;color=texture2D(image,vec2(t.x,1.-t.y));a*=color.a;}
     else if(mode<2.5){color=texture2D(frosted,uv);vec2 d=q-rect.xy;float t=clamp(dot(d,rect.zw)/dot(rect.zw,rect.zw),0.,1.);float wash=t<.5?(1.-2.*t)*.1333333:(2.*t-1.)*.0666667;color.rgb=mix(color.rgb,vec3(1.),wash);}
     else{color=vec4(1.);}
     gl_FragColor=vec4(color.rgb*a,a);
    }`));
   gl.bindAttribLocation(program,0,'p');gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
   const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([0,0,1,0,0,1,0,1,1,0,1,1]),gl.STATIC_DRAW);const pos=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
   const texture=()=>{const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,p,gl.LINEAR);for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE);return t;};
   const blurProgram=gl.createProgram();gl.attachShader(blurProgram,shader(gl.VERTEX_SHADER,'attribute vec2 p;varying vec2 uv;void main(){uv=p;gl_Position=vec4(p*2.-1.,0.,1.);}'));
   gl.attachShader(blurProgram,shader(gl.FRAGMENT_SHADER,'precision highp float;uniform sampler2D image;uniform vec2 direction;uniform float sigma;varying vec2 uv;void main(){vec4 sum=vec4(0.);float total=0.;float stepSize=max(1.,sigma/8.);for(int i=-24;i<=24;i++){float d=float(i)*stepSize;float weight=exp(-d*d/(2.*sigma*sigma));sum+=texture2D(image,uv+direction*d)*weight;total+=weight;}gl_FragColor=sum/total;}'));gl.bindAttribLocation(blurProgram,0,'p');gl.linkProgram(blurProgram);if(!gl.getProgramParameter(blurProgram,gl.LINK_STATUS))throw Error('material blur program');
   s={gl,program,source:null,original:texture(),glass:texture(),blurTemp:texture(),blurFrame:gl.createFramebuffer(),blurProgram,blurImage:gl.getUniformLocation(blurProgram,'image'),blurDirection:gl.getUniformLocation(blurProgram,'direction'),blurSigma:gl.getUniformLocation(blurProgram,'sigma'),blurKey:'',circleData:new Float32Array(450),u:Object.fromEntries(['image','frosted','size','rect','tiles','mode','imageOpacity','circleCount','circles'].map(n=>[n,gl.getUniformLocation(program,n)]))};states.set(canvas,s);
  }
  const {gl,u}=s;if(gl.isContextLost())return false;
  const {o,w,h,k,circles,regions}=trackingMaterialScene(source,options);
  if(Math.max(w,h)>gl.getParameter(gl.MAX_TEXTURE_SIZE))return false;
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  gl.viewport(0,0,w,h);gl.uniform2f(u.size,w,h);gl.uniform1f(u.imageOpacity,o.imageOpacity);gl.uniform1i(u.image,0);gl.uniform1i(u.frosted,1);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,s.original);
  if(s.source!==source){gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);s.source=source;s.blurKey='';}
  if(regions.some(r=>r.mode==='glass')){
   if(o.blur>0)blurMaterialTexture(s,w,h,o.blur*k);
   else{gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,s.glass);if(s.blurKey!=='zero'){gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);s.blurKey='zero';s.blurW=s.blurH=0;}}
  }else if(!s.blurKey){gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,s.glass);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]));}
  const bg=parseInt(o.background.slice(1),16);gl.clearColor((bg>>16)/255,((bg>>8)&255)/255,(bg&255)/255,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
  gl.uniform4f(u.rect,0,0,w,h);gl.uniform1f(u.mode,0);gl.uniform1i(u.circleCount,0);gl.drawArrays(gl.TRIANGLES,0,6);
  for(const r of regions){
   let count=0;for(const n of circles){if(n.x+n.radius<r.x||n.x-n.radius>r.x+r.rw||n.y+n.radius<r.y||n.y-n.radius>r.y+r.rh)continue;s.circleData[count*3]=n.x;s.circleData[count*3+1]=n.y;s.circleData[count*3+2]=n.radius;if(++count===150)break;}
   gl.uniform1i(u.circleCount,count);if(count)gl.uniform3fv(u.circles,s.circleData.subarray(0,count*3));
   const grid=mosaicGrid(r.rw,r.rh,o.pixels,k);
   const mode=r.mode==='glass'?2:r.mode==='negative'?3:1;gl.uniform1f(u.mode,mode);gl.uniform4f(u.rect,r.x,r.y,r.rw,r.rh);gl.uniform2f(u.tiles,grid.x,grid.y);
   if(mode===3)gl.blendFuncSeparate(gl.ONE_MINUS_DST_COLOR,gl.ONE_MINUS_SRC_ALPHA,gl.ZERO,gl.ONE);else gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
   gl.drawArrays(gl.TRIANGLES,0,6);
  }
  return true;
 }catch{states.set(canvas,false);return false;}
}
