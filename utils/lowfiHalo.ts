import {blurAlpha} from './alphaBoxBlur.js';
const header='precision highp float; varying vec2 vUv; uniform sampler2D uTex;';
export const LOWFI_HALO_SEED=header+'void main(){float l=dot(texture2D(uTex,vUv).rgb,vec3(.299,.587,.114));float a=pow(max(0.,(l-160./255.)/(95./255.)),1.5);gl_FragColor=vec4(0.,0.,0.,floor(a*255.+.5)/255.);}';
export const LOWFI_HALO_BLUR=header+'uniform vec2 uStep;uniform float uRadius;void main(){float a=0.;for(int i=-5;i<=5;i++){if(abs(float(i))<=uRadius)a+=texture2D(uTex,vUv+float(i)*uStep).a;}gl_FragColor=vec4(0.,0.,0.,floor(a/(2.*uRadius+1.)*255.+.5)/255.);}';
/** Same highlight mask, box kernel and rounding as the existing halation.
 * Only its mask is sampled at the legacy 800px analysis size: the photograph
 * and LUT stay full-resolution. Strength dragging only changes a uniform. */
export class LowfiHaloMask {
 private sample=document.createElement('canvas');
 private mask=document.createElement('canvas');
 private key?:string;
 texture:WebGLTexture|null=null;
 private gpuScratch:WebGLTexture|null=null;
 private gpuSize='';
 private gpuKey?:string;
 /** Identical 800px highlight analysis and four rounded box passes, kept
  * inside the photo effect context rather than reading the photo back to CPU. */
 prepareGpu(gl:WebGLRenderingContext,source:WebGLTexture,w:number,h:number,key:string|undefined,fb:WebGLFramebuffer,compile:(name:string,source:string)=>WebGLProgram|null){
  const k=Math.min(1,800/Math.max(w,h)),mw=Math.max(1,Math.floor(w*k)),mh=Math.max(1,Math.floor(h*k)),size=`${mw}x${mh}`;
  const seed=compile('__lowfiHaloSeed',LOWFI_HALO_SEED);
  const blur=compile('__lowfiHaloBlur',LOWFI_HALO_BLUR);
  if(!seed||!blur)return false;
  if(!this.texture||!this.gpuScratch||size!==this.gpuSize){
   this.texture ||= gl.createTexture();this.gpuScratch ||= gl.createTexture();
   for(const t of [this.texture,this.gpuScratch]){gl.activeTexture(gl.TEXTURE6);gl.bindTexture(gl.TEXTURE_2D,t);for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,p,gl.LINEAR);for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,mw,mh,0,gl.RGBA,gl.UNSIGNED_BYTE,null);}
   this.gpuSize=size;this.gpuKey=undefined;
  }
  if(!key||key!==this.gpuKey){
   gl.viewport(0,0,mw,mh);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
   const draw=(p:WebGLProgram,input:WebGLTexture,target:WebGLTexture)=>{gl.useProgram(p);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,input);gl.uniform1i(gl.getUniformLocation(p,'uTex'),0);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);gl.drawArrays(gl.TRIANGLES,0,3);};
   draw(seed,source,this.texture!);
   gl.useProgram(blur);gl.uniform1f(gl.getUniformLocation(blur,'uRadius'),Math.floor(Math.max(1,mw*.08*.8553125*.1)));
   for(let i=0;i<2;i++){gl.uniform2f(gl.getUniformLocation(blur,'uStep'),1/mw,0);draw(blur,this.texture!,this.gpuScratch!);gl.uniform2f(gl.getUniformLocation(blur,'uStep'),0,1/mh);draw(blur,this.gpuScratch!,this.texture!);}
   this.gpuKey=key;this.key=undefined;
  }
  gl.viewport(0,0,w,h);return true;
 }
 bindGpu(gl:WebGLRenderingContext,program:WebGLProgram){gl.activeTexture(gl.TEXTURE6);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.uniform1i(gl.getUniformLocation(program,'uLowfiHalo'),6);}
 bind(gl:WebGLRenderingContext,program:WebGLProgram,source:HTMLCanvasElement|OffscreenCanvas,w:number,h:number,key?:string){
  const k=Math.min(1,800/Math.max(w,h)),mw=Math.max(1,Math.floor(w*k)),mh=Math.max(1,Math.floor(h*k));
  if(!this.texture){this.texture=gl.createTexture();gl.activeTexture(gl.TEXTURE6);gl.bindTexture(gl.TEXTURE_2D,this.texture);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);}
  gl.activeTexture(gl.TEXTURE6);gl.bindTexture(gl.TEXTURE_2D,this.texture);
  if(!key||key!==this.key||this.mask.width!==mw||this.mask.height!==mh){
   this.sample.width=mw;this.sample.height=mh;this.mask.width=mw;this.mask.height=mh;
   const ctx=this.sample.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(source,0,0,mw,mh);
   const data=ctx.getImageData(0,0,mw,mh).data,n=mw*mh,a=new Uint8ClampedArray(n),blurred=new Uint8ClampedArray(n),scratch=new Uint8ClampedArray(n);
   for(let j=0,i=0;j<n;j++,i+=4){const l=data[i]*.299+data[i+1]*.587+data[i+2]*.114;a[j]=l>160?Math.pow((l-160)/95,1.5)*255:0;}
   blurAlpha(a,blurred,scratch,mw,mh,Math.floor(Math.max(1,mw*.08*.8553125*.1)));
   const out=this.mask.getContext('2d')!,pixels=out.createImageData(mw,mh);
   for(let j=0;j<n;j++)pixels.data[j*4+3]=blurred[j];out.putImageData(pixels,0,0);
   gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,1);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.mask);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,0);this.key=key;this.gpuKey=undefined;
  }
  gl.uniform1i(gl.getUniformLocation(program,'uLowfiHalo'),6);
 }
 dispose(gl:WebGLRenderingContext){if(this.texture)gl.deleteTexture(this.texture);if(this.gpuScratch)gl.deleteTexture(this.gpuScratch);this.texture=this.gpuScratch=null;this.gpuKey=undefined;this.gpuSize='';this.sample.width=this.sample.height=this.mask.width=this.mask.height=1;}
}
