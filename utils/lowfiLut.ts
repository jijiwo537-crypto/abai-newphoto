import lutUrl from '../assets/lowfi-lut.jpg?url';
import {repairedLutCanvas} from './lutAtlasRepair.js';
let image:HTMLImageElement|null=null;
let repaired:HTMLCanvasElement|null=null;
let ready:Promise<void>|null=null;
const textures=new WeakMap<WebGLRenderingContext|WebGL2RenderingContext,{tex:WebGLTexture;uploaded:boolean}>();
/** Decode the user's original 8×8 / 64-slice LUT once, never during dragging. */
export function warmLowfiLut(){
 if(ready)return ready;
 if(typeof Image==='undefined')return Promise.resolve();
 ready=new Promise<void>((resolve,reject)=>{
  image=new Image();image.onload=()=>{try{repaired=repairedLutCanvas(image!);resolve();}catch(error){ready=null;reject(error);}};image.onerror=()=>{ready=null;reject(Error('低保真色階圖載入失敗'));};image.src=lutUrl;
 });
 return ready;
}
export function bindLowfiLut(gl:WebGLRenderingContext|WebGL2RenderingContext,program:WebGLProgram,unit=7){
 if(!ready)void warmLowfiLut().catch(console.error);
 let cached=textures.get(gl);
 const loaded=!!repaired;
 gl.activeTexture(gl.TEXTURE0+unit);
 if(!cached){cached={tex:gl.createTexture()!,uploaded:false};textures.set(gl,cached);gl.bindTexture(gl.TEXTURE_2D,cached.tex);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]));
 }else gl.bindTexture(gl.TEXTURE_2D,cached.tex);
 if(loaded&&!cached.uploaded){gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,repaired!);cached.uploaded=true;}
 gl.uniform1i(gl.getUniformLocation(program,'uLowfiLut'),unit);
 gl.uniform1f(gl.getUniformLocation(program,'uLowfiLutReady'),loaded?1:0);
}
export const LOWFI_LUT_GLSL=`
uniform sampler2D uLowfiLut;
uniform float uLowfiLutReady;
vec3 lowfiLookup(vec3 c){
 if(uLowfiLutReady<.5)return c;
 c=clamp(c,0.,1.);float b=c.b*63.;vec2 rg=c.rg*(127./1024.)+vec2(.5/1024.);
 vec2 lo=vec2(mod(floor(b),8.),floor(floor(b)/8.))/8.+rg;
 vec2 hi=vec2(mod(ceil(b),8.),floor(ceil(b)/8.))/8.+rg;
 return mix(texture2D(uLowfiLut,lo).rgb,texture2D(uLowfiLut,hi).rgb,fract(b));
}`;
