/**
 * 在空間特效的 context 裡查色彩表。33³ 的 RGBA8 網格和三線性內插跟 LutGpu 一樣，只是儲存的排列不同
 */
export type FxColourInput={full:Uint8Array;plain:Uint8Array;amount:number;sourceKey:string};
export const FX_COLOUR_SHADER=`precision highp float;
varying vec2 vUv;uniform sampler2D uTex;uniform sampler2D uFull;uniform sampler2D uPlain;uniform float uMix;
vec3 slice(sampler2D table,vec2 rg,float b){return texture2D(table,vec2((rg.x+b*33.+.5)/1089.,(rg.y+.5)/33.)).rgb;}
vec3 lookup(sampler2D table,vec3 c){vec3 p=clamp(c,0.,1.)*32.;float z=floor(p.z);return mix(slice(table,p.xy,z),slice(table,p.xy,min(32.,z+1.)),fract(p.z));}
void main(){vec4 c=texture2D(uTex,vUv);gl_FragColor=vec4(mix(lookup(uPlain,c.rgb),lookup(uFull,c.rgb),uMix),c.a);}`;
/** 3D 記憶體是 r 變化最快、g 居中、b 最慢；攤平時不重新取樣 */
export function colourAtlas(input:Uint8Array){
 const out=new Uint8Array(input.length);
 for(let b=0;b<33;b++)for(let g=0;g<33;g++)out.set(input.subarray((b*33+g)*33*4,(b*33+g+1)*33*4),(g*1089+b*33)*4);
 return out;
}
