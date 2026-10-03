import {FX_DEFS, LOWFI_FIXED} from './glEffects';

export interface CameraFx { soft:number; blur:number; soft2:number; halo:number; lowfi:number; }
export const CAMERA_FX_ZERO:CameraFx={soft:0,blur:0,soft2:0,halo:0,lowfi:0};
const spill=FX_DEFS.find(d=>d.id==='fxExposureSpill')!;
const lowfi=FX_DEFS.find(d=>d.id==='fxLowfi')!;
const param=(d:typeof spill,id:string)=>d.params.find(p=>p.id===id)!.def;
export const CAMERA_FX_ITEMS:{id:keyof CameraFx;label:string;on:number}[]=[
 {id:'soft',label:'柔光',on:70},
 {id:'soft2',label:'柔光ll',on:spill.onAmount!},
 {id:'halo',label:'光暈',on:80},
 {id:'lowfi',label:'低保真',on:lowfi.onAmount!},
 {id:'blur',label:'朦朧',on:70},
];
export const CAMERA_SPILL_RANGE=param(spill,'fxSpillRange')/100;
export const CAMERA_SPILL_STEP=param(spill,'fxSpillDiffusion')*.02/400;
export const CAMERA_LOWFI_GLSL=`
float hash21(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
vec3 lowfiColor(vec3 c,vec2 uv,vec2 res,float lum){
 vec2 cell=floor(uv*vec2(1200.,1200.*res.y/res.x)/${.5+LOWFI_FIXED.grainSize*.025});
 float mono=hash21(cell+731.)-.5;
 vec3 noise=vec3(hash21(cell+1949.),hash21(cell+2896.),hash21(cell+3843.))-.5;
 c=((c-.5)*(1.+${param(lowfi,'fxLowfiContrast').toFixed(1)}*.004)+.5)*exp2(${LOWFI_FIXED.exposure*.008});
 c+=${param(lowfi,'fxLowfiGrain').toFixed(1)}*1.6*(.55+.45*(1.-lum))*(mono*.55+noise*.85)/255.;
 return clamp(c,0.,1.);
}
vec2 lowfiShift(vec2 uv){vec2 d=uv-.5;return d*${param(lowfi,'fxLowfiAberration').toFixed(1)}*.00008*(.15+dot(d,d)*3.);}
`;

/** GPU-only sampled percentile: never synchronously read camera pixels to CPU. */
export const CAMERA_HIGHLIGHT_FS=`#version 300 es
precision highp float;
uniform sampler2D u_tex;
out vec4 outColor;
void main(){
 float lo=0.,hi=1.;
 for(int k=0;k<8;k++){
  float cut=(lo+hi)*.5,above=0.;
  for(int y=0;y<8;y++)for(int x=0;x<8;x++){
   vec3 c=texture(u_tex,(vec2(float(x),float(y))+.5)/8.).rgb;
   above+=step(cut,dot(c,vec3(.299,.587,.114)));
  }
  if(above/64.>${CAMERA_SPILL_RANGE})lo=cut;else hi=cut;
 }
 outColor=vec4((lo+hi)*.5,0.,0.,1.);
}`;
