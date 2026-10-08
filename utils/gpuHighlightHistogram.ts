import {isWebgl2} from './fxSurfaceGl';
import {uniformLocation} from './uniformLocation';
/** Full-resolution luminance histogram and percentile selection on the GPU.
 * Neither photograph pixels nor histogram counters cross back to the CPU. */
export class GpuHighlightHistogram {
 diagnostic?:number[];
 private program:WebGLProgram;private vertices:WebGLBuffer;private texture:WebGLTexture;private framebuffer:WebGLFramebuffer;
 private count=0;private rows=0;private key?:string;private sums:WebGLTexture[]=[];private selection:WebGLTexture|null=null;
 private constructor(private gl:WebGLRenderingContext,p:WebGLProgram,b:WebGLBuffer,t:WebGLTexture,f:WebGLFramebuffer,private textureType:number,private internal:number,private sumInternal:number){this.program=p;this.vertices=b;this.texture=t;this.framebuffer=f;}
 static create(gl:WebGLRenderingContext){
  if(!gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS))return null;
  // WebGL2 has float textures built in; rendering to them needs
  // EXT_color_buffer_float, and blending 32-bit floats EXT_float_blend
  // (16-bit float targets blend without it). Storage must be sized there.
  const gl2=isWebgl2(gl)?gl:null;
  let textureType:number,internal:number,sumInternal:number;
  if(gl2){
    if(!gl2.getExtension('EXT_color_buffer_float'))return null;
    const full=gl2.getExtension('EXT_float_blend');
    textureType=full?gl2.FLOAT:gl2.HALF_FLOAT;internal=full?gl2.RGBA32F:gl2.RGBA16F;sumInternal=gl2.RGBA32F;
  }else{
    if(!gl.getExtension('OES_texture_float')||!gl.getExtension('WEBGL_color_buffer_float'))return null;
    const full=gl.getExtension('EXT_float_blend');
    const half=gl.getExtension('OES_texture_half_float');
    if(!full&&!(half&&gl.getExtension('EXT_color_buffer_half_float')))return null;
    textureType=full?gl.FLOAT:half!.HALF_FLOAT_OES;internal=gl.RGBA;sumInternal=gl.RGBA;
  }
  const shaders:WebGLShader[]=[];
  const build=(type:number,source:string)=>{const sh=gl.createShader(type)!;gl.shaderSource(sh,source);gl.compileShader(sh);shaders.push(sh);return gl.getShaderParameter(sh,gl.COMPILE_STATUS)?sh:null;};
  const vs=build(gl.VERTEX_SHADER,'precision highp float;attribute float index;uniform vec2 size;uniform float rows;uniform sampler2D source;varying vec4 counts;void main(){vec2 uv=(vec2(mod(index,size.x),floor(index/size.x))+.5)/size;vec4 c=texture2D(source,uv);float a=floor(c.a*255.+.5);counts=vec4(mod(a,4.),mod(floor(a/4.),4.),mod(floor(a/16.),4.),floor(a/64.));float bin=floor(dot(c.rgb,vec3(.299,.587,.114))*255.+.5);gl_Position=vec4((bin+.5)/256.*2.-1.,(mod(index,rows)+.5)/rows*2.-1.,0.,1.);gl_PointSize=1.;}');
  const fs=build(gl.FRAGMENT_SHADER,'precision highp float;varying vec4 counts;void main(){gl_FragColor=counts;}');
  if(!vs||!fs){shaders.forEach(s=>gl.deleteShader(s));return null;}
  const p=gl.createProgram()!;gl.attachShader(p,vs);gl.attachShader(p,fs);gl.bindAttribLocation(p,0,'index');gl.linkProgram(p);shaders.forEach(s=>gl.deleteShader(s));
  if(!gl.getProgramParameter(p,gl.LINK_STATUS)){gl.deleteProgram(p);return null;}
  const t=gl.createTexture()!,f=gl.createFramebuffer()!,b=gl.createBuffer()!;
  gl.activeTexture(gl.TEXTURE7);gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,internal,256,1,0,gl.RGBA,textureType,null);
  gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);
  if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE){gl.deleteProgram(p);gl.deleteTexture(t);gl.deleteFramebuffer(f);gl.deleteBuffer(b);return null;}
  return new GpuHighlightHistogram(gl,p,b,t,f,textureType,internal,sumInternal);
 }
 prepare(source:WebGLTexture,w:number,h:number,key:string|undefined,coverage:number,quad:WebGLBuffer,compile:(key:string,fs:string)=>WebGLProgram|null){
  const gl=this.gl,n=w*h;gl.bindBuffer(gl.ARRAY_BUFFER,this.vertices);
  if(n>16777216)return null;
  // Encode alpha in four base-4 digits. At most 512 samples contribute to a
  // shard, keeping every half-float counter exact (512*3 < 2048), even for PNG.
  const rows=Math.max(128,2**Math.ceil(Math.log2(Math.ceil(n/512))));
  if(rows!==this.rows&&rows>gl.getParameter(gl.MAX_TEXTURE_SIZE))return null;
  if(rows!==this.rows){this.rows=rows;this.key=undefined;gl.activeTexture(gl.TEXTURE7);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texImage2D(gl.TEXTURE_2D,0,this.internal,256,rows,0,gl.RGBA,this.textureType,null);this.sums.forEach(t=>gl.deleteTexture(t));this.sums=[];}
  const header='precision highp float;precision highp sampler2D;varying vec2 vUv;uniform sampler2D uTex;';
  const reduce=compile('__histReduce',header+'uniform vec2 uInputSize;uniform float uRows;void main(){float row=floor(gl_FragCoord.y)*16.;vec4 sum=vec4(0.);for(int i=0;i<16;i++){float r=row+float(i);if(r<uRows)sum+=texture2D(uTex,vec2(gl_FragCoord.x/uInputSize.x,(r+.5)/uInputSize.y));}gl_FragColor=sum;}');
  const select=compile('__histSelect',header+'uniform float uCoverage;uniform float uHeight;float countAt(float bin){return dot(texture2D(uTex,vec2((bin+.5)/256.,.5/uHeight)),vec4(1.,4.,16.,64.));}void main(){float total=0.;for(int i=0;i<256;i++)total+=countAt(float(i));float left=total*clamp(uCoverage/100.,0.,1.);vec2 result=vec2(255.,0.);bool found=left<=0.;for(int i=255;i>=0;i--){float count=countAt(float(i));if(!found){if(count>=left){result=vec2(float(i),count>0.?left/count:0.);found=true;}else left-=count;}}gl_FragColor=vec4(result,0.,1.);}');
  if(!reduce||!select)return null;
  const make=(width:number,height:number)=>{const t=gl.createTexture()!;gl.activeTexture(gl.TEXTURE7);gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,this.sumInternal,width,height,0,gl.RGBA,gl.FLOAT,null);return t;};
  const height=Math.ceil(rows/16);
  if(!this.sums.length)this.sums=[make(256,height),make(256,height)];
  this.selection ||= make(1,1);
  if(!key||key!==this.key){
  if(n!==this.count){const a=new Float32Array(n);for(let i=0;i<n;i++)a[i]=i;gl.bufferData(gl.ARRAY_BUFFER,a,gl.STATIC_DRAW);this.count=n;}
  gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,1,gl.FLOAT,false,0,0);gl.useProgram(this.program);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,source);gl.uniform1i(uniformLocation(gl,this.program,'source'),0);gl.uniform2f(uniformLocation(gl,this.program,'size'),w,h);
  gl.uniform1f(uniformLocation(gl,this.program,'rows'),rows);
  gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.texture,0);gl.viewport(0,0,256,rows);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendFunc(gl.ONE,gl.ONE);gl.drawArrays(gl.POINTS,0,n);gl.disable(gl.BLEND);
  gl.bindBuffer(gl.ARRAY_BUFFER,quad);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);gl.useProgram(reduce);
  let input=this.texture,activeRows=rows,inputHeight=rows,index=0;
  while(activeRows>1){const next=Math.ceil(activeRows/16),target=this.sums[index%2];gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,input);gl.uniform1i(uniformLocation(gl,reduce,'uTex'),0);gl.uniform2f(uniformLocation(gl,reduce,'uInputSize'),256,inputHeight);gl.uniform1f(uniformLocation(gl,reduce,'uRows'),activeRows);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);gl.viewport(0,0,256,next);gl.drawArrays(gl.TRIANGLES,0,3);input=target;inputHeight=height;activeRows=next;index++;}
  // Keep the reduced histogram in sums[0] regardless of pass count.
  if(input!==this.sums[0])this.sums.reverse();this.key=key;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER,quad);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);gl.useProgram(select);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.sums[0]);gl.uniform1i(uniformLocation(gl,select,'uTex'),0);gl.uniform1f(uniformLocation(gl,select,'uHeight'),height);gl.uniform1f(uniformLocation(gl,select,'uCount'),n);gl.uniform1f(uniformLocation(gl,select,'uCoverage'),coverage);gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.selection,0);gl.viewport(0,0,1,1);gl.drawArrays(gl.TRIANGLES,0,3);
  if(import.meta.env.DEV&&location.search.includes('spatialSceneAudit')){const value=new Float32Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.FLOAT,value);this.diagnostic=Array.from(value);}
  return this.selection;
 }
 dispose(){const gl=this.gl;gl.deleteProgram(this.program);gl.deleteBuffer(this.vertices);gl.deleteTexture(this.texture);gl.deleteTexture(this.selection);this.sums.forEach(t=>gl.deleteTexture(t));gl.deleteFramebuffer(this.framebuffer);}
}
