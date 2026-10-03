import {blurAlpha} from './alphaBoxBlur.js';
/** Same highlight mask, box kernel and rounding as the existing halation.
 * Only its mask is sampled at the legacy 800px analysis size: the photograph
 * and LUT stay full-resolution. Strength dragging only changes a uniform. */
export class LowfiHaloMask {
 private sample=document.createElement('canvas');
 private mask=document.createElement('canvas');
 private key?:string;
 texture:WebGLTexture|null=null;
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
   gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,1);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.mask);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,0);this.key=key;
  }
  gl.uniform1i(gl.getUniformLocation(program,'uLowfiHalo'),6);
 }
 dispose(gl:WebGLRenderingContext){if(this.texture)gl.deleteTexture(this.texture);this.texture=null;this.sample.width=this.sample.height=this.mask.width=this.mask.height=1;}
}
