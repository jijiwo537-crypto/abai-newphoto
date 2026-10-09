import {FX_DEFS} from './glEffects';
import {blurRGBA} from './artMaterials';

/** Material layers sample preceding scene ink, never a saved source photograph. */
export const MASK_SHAPE_ITEMS = [
 {id:'mask-mosaic',kind:'mask-mosaic',filled:true,label:'方形馬賽克'},
 {id:'mask-bricks',kind:'mask-bricks',filled:true,label:'方形玻璃磚'},
 {id:'mask-frost',kind:'mask-frost',filled:true,label:'方形毛玻璃'},
 {id:'mask-negative',kind:'mask-negative',filled:true,label:'方形負片'},
 {id:'mask-monochrome',kind:'mask-monochrome',filled:true,label:'方形黑白'},
 {id:'mask-negative-mono',kind:'mask-negative-mono',filled:true,label:'黑白負片'},
] as const;
// Old drafts keep rendering; removed materials are no longer in the picker.
export const isBackdropMask=(kind?:string)=>MASK_SHAPE_ITEMS.some(s=>s.kind===kind)||kind==='mask-thermal'||kind==='mask-frost-circle'||kind==='mask-frost-feather';
export const maskGeometry=(kind:string,settings:MaskSettings={})=>settings.maskShape||(kind.includes('circle')||kind.includes('feather')?'circle':'square');
export type MaskSettings={maskShape?:'square'|'circle'|'star';maskAmount?:number;maskCells?:number;maskRefract?:number;maskFeather?:number};
/** Glass bricks: default 20, at most 50 (older projects may have saved up to 60). */
export const GLASS_DEFAULT_CELLS=20,GLASS_MAX_CELLS=50;
export const glassCells=(settings:MaskSettings)=>Math.max(4,Math.min(GLASS_MAX_CELLS,settings.maskCells??GLASS_DEFAULT_CELLS));
export const maskDefaults=(kind:string):MaskSettings=>({maskShape:kind.includes('circle')||kind.includes('feather')?'circle':'square',maskAmount:kind.includes('frost')?50:100,maskCells:kind==='mask-mosaic'?15:GLASS_DEFAULT_CELLS,maskRefract:100,maskFeather:kind==='mask-frost-feather'?35:0});
function clipMask(ctx:CanvasRenderingContext2D,w:number,h:number,shape:string){
 ctx.beginPath();if(shape==='circle')ctx.ellipse(0,0,w/2,h/2,0,0,Math.PI*2);
 else if(shape==='star'){for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,r=i%2?.45:1,x=Math.cos(a)*w/2*r,y=Math.sin(a)*h/2*r;i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();}
 else ctx.rect(-w/2,-h/2,w,h);ctx.clip();
}
/** How far from a pixel this mask reads the scene beneath it, in the same
    units as w/h. A tiled scene must render at least this much margin. */
export const maskSampleReach=(kind:string,w:number,h:number,settings:MaskSettings={})=>{
 if(kind==='mask-mosaic'){const n=Math.max(1,Math.floor((settings.maskCells??15)+.5));return w/n+2;}
 if(kind==='mask-bricks'){const n=glassCells(settings),rows=Math.max(1,Math.floor(n*h/w+.001));return Math.max(w/n,h/rows)*(1-1/GLASS_MAGNIFY)/2*Math.max(0,(settings.maskRefract??100)/100)+2;}
 if(kind.includes('frost'))return Math.min(w,h)*.12*(settings.maskAmount??50)/100*3.2+2;
 return 0;
};
export const thermalRGB=(l:number)=>{const stops=[[8,4,40],[45,14,124],[190,20,101],[255,85,25],[255,222,66],[255,255,238]],p=Math.max(0,Math.min(1,l))*5,i=Math.min(4,Math.floor(p)),f=p-i;return stops[i].map((v,c)=>v+(stops[i+1][c]-v)*f);};
export function maskPhysicalBounds(m:DOMMatrix,w:number,h:number,width:number,height:number,pad=0){
 const pts=[[-w/2,-h/2],[w/2,-h/2],[-w/2,h/2],[w/2,h/2]].map(([x,y])=>({x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f}));
 const left=Math.max(0,Math.floor(Math.min(...pts.map(p=>p.x))-pad)),top=Math.max(0,Math.floor(Math.min(...pts.map(p=>p.y))-pad));
 return {left,top,width:Math.max(0,Math.min(width,Math.ceil(Math.max(...pts.map(p=>p.x))+pad))-left),height:Math.max(0,Math.min(height,Math.ceil(Math.max(...pts.map(p=>p.y))+pad))-top)};
}

const body=(id:string)=>FX_DEFS.find(d=>d.id===id)!.passes[0].body.replace(/texture2D\(uTex,\s*([^;]+?)\)\.rgb/g,'sampleBackdrop($1).rgb').replace('floor(fxGlassBlocks * uRes.y / uRes.x)','max(1., floor(fxGlassBlocks * uRes.y / uRes.x + .001))');
/* Glass-brick refraction is a lens per brick, sized by the BRICK. The photo
   effect displaces by a fraction of the whole image (0.06), which inside a
   mask meant a magnification of 1 - 0.12 * bricks: about -1.6 (flipped) at
   22 bricks and -6 at 60. A flipped, magnified view slides the other way
   at (1 - magnification) times the brick's own motion, so scaling the mask
   made the content of every brick race up and down. An upright zoom of
   GLASS_MAGNIFY per brick keeps the faceted look; its content slides only
   (1 - 1/GLASS_MAGNIFY) of the brick's motion, about 7x calmer. */
const GLASS_MAGNIFY=1.6;
const bricksBody=(()=>{const b=body('fxGlass'),from='vec2 p = uv - n * fxGlassRefract * 0.06;';if(!b.includes(from))throw Error('mask glass refraction changed');
 return b.replace(from,`vec2 p = uv - n * fxGlassRefract * ${((1-1/GLASS_MAGNIFY)/2).toFixed(4)} / grid;`);})();
/* A mask's mosaic tile is the AVERAGE of the photo under it, not a point
   sample. Point samples (one, or a fixed 5x5 set) are tens of pixels apart
   once a tile is large on a 3x screen: while the mask is scaled they hit or
   miss photo detail and whole rows of tiles flicker, which reads as the grid
   jumping up and down. A separate pass renders one fragment per tile with a
   dense, tile-size-aware sample set (spacing <= ~2 physical px), so a tile's
   colour changes continuously with the geometry. */
const mosaicPoint='sampleBackdrop((cell + 0.5) / grid).rgb';
const mosaicBody=(()=>{const b=body('fxMosaic');if(!b.includes(mosaicPoint))throw Error('mask mosaic sampling changed');
 return b.replace('vec3 c = '+mosaicPoint+';','vec3 c=texture2D(cellColors,(cell+.5)/cellCount).rgb;');})();
const MOSAIC_MAX_SAMPLES=32;
const mosaicSamples=(w:number,n:number,m:{a:number;b:number;c:number;d:number})=>Math.max(5,Math.min(MOSAIC_MAX_SAMPLES,Math.ceil(w/n*Math.max(Math.hypot(m.a,m.b),Math.hypot(m.c,m.d))/2)));
/* The blur runs at a reduced resolution. Snap it to quarter-octave steps:
   scaling a frosted mask changes sigma every frame, and a continuously
   changing intermediate size reallocated the textures and moved the sampling
   grid each frame (visible shimmer). Blur strength stays continuous. */
const blurBandwidth=(sigma:number)=>Math.min(1,2**(Math.floor(Math.log2(6/Math.max(1,sigma))*4)/4));
const vertex='attribute vec2 p;varying vec2 uv;void main(){uv=(p+1.)*.5;gl_Position=vec4(p,0.,1.);}';
const header=`precision highp float;varying vec2 uv;uniform sampler2D image;uniform vec2 size;`;
// The exact same 49-tap Gaussian, but weights are evaluated once per mask,
// not 49 exponential functions for every pixel in both passes.
const blur=header+`uniform vec2 direction;uniform float stepSize;uniform float weights[25];void main(){vec4 sum=texture2D(image,uv)*weights[0];for(int i=1;i<=24;i++){vec2 d=direction*float(i)*stepSize;sum+=(texture2D(image,uv+d)+texture2D(image,uv-d))*weights[i];}gl_FragColor=sum;}`;
const material=header+`
 uniform sampler2D softened,cellColors;uniform vec3 mapX,mapY,invX,invY;uniform vec2 uRes,sampleSize,origin,cellCount;
 uniform float mode,circle,feather,amount,edgeAA;
 uniform float fxMosaicBlocks,fxMosaicGap,fxMosaicShape,fxGlassBlocks,fxGlassRound,fxGlassRefract,fxGlassBevel;
 vec2 screenUV(vec2 p){vec3 q=vec3((p-.5)*uRes,1.);return vec2((dot(mapX,q)+origin.x)/sampleSize.x,1.-(dot(mapY,q)+origin.y)/sampleSize.y);}
 vec4 sampleBackdrop(vec2 p){return texture2D(image,screenUV(p));}
 vec4 mosaic(vec2 uv){${mosaicBody}}
 vec4 bricks(vec2 uv){${bricksBody}}
 void main(){
  vec3 screen=vec3(uv.x*size.x,(1.-uv.y)*size.y,1.);
  vec2 local=vec2(dot(invX,screen),dot(invY,screen))/uRes+.5;
  vec2 delta=local-.5;float distance=circle>.5?length(delta):max(abs(delta.x),abs(delta.y));
  float alpha=1.-smoothstep(.5-max(edgeAA,feather*.5),.5,distance);
  vec4 original=texture2D(image,vec2((uv.x*size.x+origin.x)/sampleSize.x,1.-((1.-uv.y)*size.y+origin.y)/sampleSize.y));vec3 c=original.rgb;
  if(mode<.5)c=mosaic(local).rgb;else if(mode<1.5)c=bricks(local).rgb;
  else if(mode<2.5)c=texture2D(softened,uv).rgb;else if(mode<3.5)c=1.-c;
  else if(mode<4.5)c=vec3(dot(c,vec3(.2126,.7152,.0722)));
  else if(mode>5.5)c=vec3(1.-dot(c,vec3(.2126,.7152,.0722)));
  else{float l=clamp(dot(c,vec3(.2126,.7152,.0722)),0.,1.)*5.;
   vec3 a=vec3(8.,4.,40.),b=vec3(45.,14.,124.);
   if(l>=4.){a=vec3(255.,222.,66.);b=vec3(255.,255.,238.);}
   else if(l>=3.){a=vec3(255.,85.,25.);b=vec3(255.,222.,66.);}
   else if(l>=2.){a=vec3(190.,20.,101.);b=vec3(255.,85.,25.);}
   else if(l>=1.){a=vec3(45.,14.,124.);b=vec3(190.,20.,101.);}
   c=mix(a,b,min(1.,l-floor(min(l,4.))))/255.;}
  if(mode<1.5||mode>2.5)c=mix(original.rgb,c,amount);
  alpha*=original.a;gl_FragColor=vec4(c*alpha,alpha);
 }`;
// Consecutive backdrop layers are one GPU composition, not N GPU→Canvas→GPU
// round trips. Edges are analytic in the current physical viewport.
const batchMaterial=material
 .replace('uniform float mode,circle,feather,amount,edgeAA;','uniform float mode,circle,feather,amount,edgeAA,objectOpacity;uniform vec2 starPoints[10];')
 .replace('vec4 sampleBackdrop(vec2 p){return texture2D(image,screenUV(p));}',`vec4 straight(vec4 c){return vec4(c.rgb/max(c.a,.00001),c.a);}vec4 sampleBackdrop(vec2 p){return straight(texture2D(image,screenUV(p)));}`)
 .replace('float alpha=1.-smoothstep(.5-max(edgeAA,feather*.5),.5,distance);',`float alpha=1.-smoothstep(.5-edgeAA,.5,distance);
  if(circle>1.5){bool inside=false;float nearest=2.;for(int i=0;i<10;i++){vec2 a=starPoints[i],b=starPoints[i==9?0:i+1],v=b-a;nearest=min(nearest,length(delta-a-v*clamp(dot(delta-a,v)/dot(v,v),0.,1.)));if((a.y>delta.y)!=(b.y>delta.y)&&delta.x<(b.x-a.x)*(delta.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}alpha=smoothstep(-edgeAA*.5,edgeAA*.5,inside?nearest:-nearest);}`)
 .replace('vec4 original=texture2D(image,vec2((uv.x*size.x+origin.x)/sampleSize.x,1.-((1.-uv.y)*size.y+origin.y)/sampleSize.y));','vec4 original=straight(texture2D(image,vec2((uv.x*size.x+origin.x)/sampleSize.x,1.-((1.-uv.y)*size.y+origin.y)/sampleSize.y)));')
 .replace('c=texture2D(softened,uv).rgb','c=straight(texture2D(softened,uv)).rgb')
 .replace('alpha*=original.a;gl_FragColor=vec4(c*alpha,alpha);','alpha*=objectOpacity;gl_FragColor=vec4(mix(original.rgb,c,alpha)*original.a,original.a);');
const screenUVSource='vec2 screenUV(vec2 p){vec3 q=vec3((p-.5)*uRes,1.);return vec2((dot(mapX,q)+origin.x)/sampleSize.x,1.-(dot(mapY,q)+origin.y)/sampleSize.y);}';
const cellPass=(sampler:string)=>header+`uniform vec3 mapX,mapY;uniform vec2 uRes,sampleSize,origin;uniform float fxMosaicBlocks,samples;
 ${screenUVSource}${sampler}
 void main(){float n=floor(fxMosaicBlocks+.5);vec2 grid=n*vec2(1.,uRes.y/uRes.x),cell=floor(gl_FragCoord.xy);vec3 c=vec3(0.);
  for(int i=0;i<${MOSAIC_MAX_SAMPLES};i++){if(float(i)>=samples)break;for(int j=0;j<${MOSAIC_MAX_SAMPLES};j++){if(float(j)>=samples)break;c+=sampleBackdrop((cell+(vec2(float(i),float(j))+.5)/samples)/grid).rgb;}}
  gl_FragColor=vec4(c/(samples*samples),1.);}`;
const cellMaterial=cellPass('vec4 sampleBackdrop(vec2 p){return texture2D(image,screenUV(p));}');
const batchCellMaterial=cellPass('vec4 straight(vec4 c){return vec4(c.rgb/max(c.a,.00001),c.a);}vec4 sampleBackdrop(vec2 p){return straight(texture2D(image,screenUV(p)));}');
export type BackdropMaskLayer={kind:string;w:number;h:number;settings:MaskSettings;matrix:DOMMatrix;opacity:number};
export type BackdropPhotoLayer={source:HTMLCanvasElement|HTMLImageElement;key:string;rect:number[];uv:number[];clip:number[]};
class MaskGpu {
 canvas=document.createElement('canvas');
 gl:WebGLRenderingContext;program:WebGLProgram;blurProgram:WebGLProgram;copyProgram:WebGLProgram;batchCopyProgram:WebGLProgram;
 batchProgram:WebGLProgram;batchTextures:WebGLTexture[]=[];batchWidth=0;batchHeight=0;
 photoProgram:WebGLProgram;photoTextures=new Map<string,{source:CanvasImageSource;texture:WebGLTexture;width:number;height:number}>();
 input:WebGLTexture;first:WebGLTexture;second:WebGLTexture;frame:WebGLFramebuffer;
 cellProgram:WebGLProgram;batchCellProgram:WebGLProgram;cells:WebGLTexture;cellsWidth=1;cellsHeight=1;
 width=0;height=0;blurWidth=0;blurHeight=0;
 inputWidth=0;inputHeight=0;
 lastSource:HTMLCanvasElement|null=null;lastStamp:unknown=null;lastBlur='';
 sources=new Map<unknown,{texture:WebGLTexture;source:HTMLCanvasElement|null;stamp:unknown;width:number;height:number}>();
 activeSource:unknown=null;
 maxTextureSize=0;positions=new Map<WebGLProgram,number>();locations=new Map<WebGLProgram,Map<string,WebGLUniformLocation|null>>();
 location=(program:WebGLProgram,name:string)=>this.locations.get(program)!.get(name)??null;
 constructor(){
  const options={alpha:true,premultipliedAlpha:true,antialias:false,preserveDrawingBuffer:true};
  const gl=(this.canvas.getContext('webgl2',options)||this.canvas.getContext('webgl',options)) as WebGLRenderingContext|null;
  if(!gl)throw Error('遮罩需要 WebGL');this.gl=gl;
  const compile=(fragment:string)=>{const p=gl.createProgram()!;for(const [type,code]of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]] as const){const s=gl.createShader(type)!;gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s)||'mask shader');gl.attachShader(p,s);gl.deleteShader(s);}gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p)||'mask link');return p;};
  const copy=header+'void main(){vec4 c=texture2D(image,uv);gl_FragColor=vec4(c.rgb*c.a,c.a);}';
  const batchCopy=header+'void main(){gl_FragColor=texture2D(image,uv);}';
  const photo=header+`uniform vec4 rect,crop,clip;void main(){vec2 p=vec2(uv.x,1.-uv.y)*size;vec2 a=(p-rect.xy)/rect.zw;if(any(lessThan(p,clip.xy))||any(greaterThan(p,clip.xy+clip.zw)))discard;vec2 q=crop.xy+a*crop.zw;gl_FragColor=texture2D(image,vec2(q.x,1.-q.y));}`;
  this.photoProgram=compile(photo);
  this.program=compile(material);this.batchProgram=compile(batchMaterial);this.blurProgram=compile(blur);this.copyProgram=compile(copy);this.batchCopyProgram=compile(batchCopy);this.cellProgram=compile(cellMaterial);this.batchCellProgram=compile(batchCellMaterial);this.maxTextureSize=gl.getParameter(gl.MAX_TEXTURE_SIZE);
  for(const [program,code]of [[this.program,material],[this.batchProgram,batchMaterial],[this.blurProgram,blur],[this.copyProgram,copy],[this.batchCopyProgram,batchCopy],[this.photoProgram,photo],[this.cellProgram,cellMaterial],[this.batchCellProgram,batchCellMaterial]] as const){
   this.positions.set(program,gl.getAttribLocation(program,'p'));const locations=new Map<string,WebGLUniformLocation|null>();
   for(const match of code.matchAll(/uniform\s+\w+\s+([^;]+);/g))for(const variable of match[1].split(',')){const name=variable.trim().replace(/\[\d+\]/,'[0]');locations.set(name,gl.getUniformLocation(program,name));}this.locations.set(program,locations);
  }
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  const texture=()=>{const t=gl.createTexture()!;gl.bindTexture(gl.TEXTURE_2D,t);for(const [k,v]of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,k,v);return t;};
  this.input=texture();this.first=texture();this.second=texture();this.frame=gl.createFramebuffer()!;
  this.cells=texture();gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  // Every sampler must be complete even when its runtime branch is unused.
  // Otherwise WebKit can output transparent black until frost was used once.
  for(const t of [this.input,this.first,this.second,this.cells]){gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]));}
 }
 /** Mosaic tiles: one fragment per tile, each the area average of the
     backdrop beneath it. Leaves the tile texture bound on unit 2 and the
     cellColors/cellCount uniforms set on the material program. */
 mosaicCells(cellProgram:WebGLProgram,material:WebGLProgram,input:WebGLTexture,m:{a:number;b:number;c:number;d:number;e:number;f:number},w:number,h:number,settings:MaskSettings,sampleWidth:number,sampleHeight:number,originX:number,originY:number){
  const gl=this.gl,blocks=settings.maskCells??15,n=Math.max(1,Math.floor(blocks+.5));
  const cols=Math.min(this.maxTextureSize,n),rows=Math.min(this.maxTextureSize,Math.max(1,Math.ceil(n*h/w-1e-6)));
  gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,null);gl.activeTexture(gl.TEXTURE0);
  if(cols!==this.cellsWidth||rows!==this.cellsHeight){this.cellsWidth=cols;this.cellsHeight=rows;gl.bindTexture(gl.TEXTURE_2D,this.cells);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,cols,rows,0,gl.RGBA,gl.UNSIGNED_BYTE,null);}
  gl.bindFramebuffer(gl.FRAMEBUFFER,this.frame);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.cells,0);gl.viewport(0,0,cols,rows);
  gl.useProgram(cellProgram);const pos=this.positions.get(cellProgram)!;gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
  const at=(name:string)=>this.location(cellProgram,name);gl.uniform1i(at('image'),0);
  gl.uniform3f(at('mapX'),m.a,m.c,m.e);gl.uniform3f(at('mapY'),m.b,m.d,m.f);gl.uniform2f(at('uRes'),w,h);gl.uniform2f(at('sampleSize'),sampleWidth,sampleHeight);gl.uniform2f(at('origin'),originX,originY);
  gl.uniform1f(at('fxMosaicBlocks'),blocks);gl.uniform1f(at('samples'),mosaicSamples(w,n,m));
  gl.bindTexture(gl.TEXTURE_2D,input);gl.drawArrays(gl.TRIANGLES,0,6);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  gl.useProgram(material);gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.cells);gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(this.location(material,'cellColors'),2);gl.uniform2f(this.location(material,'cellCount'),cols,rows);
 }
 renderBatch(source:HTMLCanvasElement,layers:BackdropMaskLayer[],photos?:BackdropPhotoLayer[]){
  const gl=this.gl,w=source.width,h=source.height;if(gl.isContextLost()||w>this.maxTextureSize||h>this.maxTextureSize)throw Error('mask batch unavailable');
  if(!this.batchTextures.length)for(let i=0;i<3;i++){const t=gl.createTexture()!;this.batchTextures.push(t);gl.bindTexture(gl.TEXTURE_2D,t);for(const [k,v]of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,k,v);}
  if(this.batchWidth!==w||this.batchHeight!==h){this.batchWidth=w;this.batchHeight=h;for(const t of this.batchTextures){gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);}}
  if(this.canvas.width!==w)this.canvas.width=w;if(this.canvas.height!==h)this.canvas.height=h;
  const use=(p:WebGLProgram)=>{gl.useProgram(p);const pos=this.positions.get(p)!;gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);gl.uniform1i(this.location(p,'image'),0);};
  gl.activeTexture(gl.TEXTURE0);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,1);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,1);
  if(photos?.length){
   const sourcePixels=photos.filter((p,i)=>photos.findIndex(q=>q.key===p.key)===i).reduce((n,p)=>n+(p.source instanceof HTMLImageElement?p.source.naturalWidth*p.source.naturalHeight:p.source.width*p.source.height),0);
   if(sourcePixels>64*1024*1024)throw Error('resident photo budget exceeded');
   gl.bindFramebuffer(gl.FRAMEBUFFER,this.frame);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.batchTextures[0],0);gl.viewport(0,0,w,h);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);use(this.photoProgram);gl.uniform2f(this.location(this.photoProgram,'size'),w,h);
   for(const photo of photos){
    let slot=this.photoTextures.get(photo.key);
    if(!slot||slot.source!==photo.source){
     if(slot)gl.deleteTexture(slot.texture);const texture=gl.createTexture()!;gl.bindTexture(gl.TEXTURE_2D,texture);for(const [k,v]of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,k,v);
     const width=photo.source instanceof HTMLImageElement?photo.source.naturalWidth:photo.source.width,height=photo.source instanceof HTMLImageElement?photo.source.naturalHeight:photo.source.height;
     if(width>this.maxTextureSize||height>this.maxTextureSize)throw Error('mask photo texture too large');
     gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,photo.source);
     // Retain full intrinsic pixels and use the same trilinear footprint at
     // rest and during gestures. Minification must not alias fine photo detail.
     if('texStorage2D' in gl||(width&(width-1))===0&&(height&(height-1))===0){gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);}
     slot={source:photo.source,texture,width,height};backdropMaskDiagnostics.uploads++;
    }else{gl.bindTexture(gl.TEXTURE_2D,slot.texture);backdropMaskDiagnostics.reuses++;}
    this.photoTextures.delete(photo.key);this.photoTextures.set(photo.key,slot);
    for(const [name,value]of [['rect',photo.rect],['crop',photo.uv],['clip',photo.clip]] as const)gl.uniform4fv(this.location(this.photoProgram,name),value);
    gl.drawArrays(gl.TRIANGLES,0,6);
   }
   let pixels=[...this.photoTextures.values()].reduce((n,t)=>n+t.width*t.height,0);const keep=new Set(photos.map(p=>p.key));
   for(const [key,slot]of this.photoTextures){if(this.photoTextures.size<=9&&pixels<=64*1024*1024)break;if(keep.has(key))continue;gl.deleteTexture(slot.texture);this.photoTextures.delete(key);pixels-=slot.width*slot.height;}
  }else{gl.bindTexture(gl.TEXTURE_2D,this.batchTextures[0]);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,source);backdropMaskDiagnostics.uploads++;}
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,0);
  gl.disable(gl.BLEND);let input=this.batchTextures[0];
  for(let i=0;i<layers.length;i++){
   const layer=layers[i],m=layer.matrix,inv=m.inverse(),settings=layer.settings,program=this.batchProgram;
   const sigma=layer.kind.includes('frost')?Math.min(layer.w*Math.hypot(m.a,m.b),layer.h*Math.hypot(m.c,m.d))*.12*(settings.maskAmount??50)/100:0;
   if(sigma>.25){
    const bandwidth=blurBandwidth(sigma),bw=Math.max(1,Math.ceil(w*bandwidth)),bh=Math.max(1,Math.ceil(h*bandwidth));
    if(bw!==this.blurWidth||bh!==this.blurHeight){this.blurWidth=bw;this.blurHeight=bh;for(const t of [this.first,this.second]){gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,bw,bh,0,gl.RGBA,gl.UNSIGNED_BYTE,null);}}
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,input);use(this.blurProgram);gl.viewport(0,0,bw,bh);
    const radius=Math.max(.25,sigma*bandwidth),step=Math.max(1,radius/8),weights=new Float32Array(25);let total=0;for(let j=0;j<=24;j++){weights[j]=Math.exp(-((j*step)**2)/(2*radius*radius));total+=weights[j]*(j?2:1);}for(let j=0;j<=24;j++)weights[j]/=total;
    gl.uniform1f(this.location(this.blurProgram,'stepSize'),step);gl.uniform1fv(this.location(this.blurProgram,'weights[0]'),weights);gl.bindFramebuffer(gl.FRAMEBUFFER,this.frame);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.first,0);gl.uniform2f(this.location(this.blurProgram,'direction'),1/bw,0);gl.drawArrays(gl.TRIANGLES,0,6);
    gl.bindTexture(gl.TEXTURE_2D,this.first);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.second,0);gl.uniform2f(this.location(this.blurProgram,'direction'),0,1/bh);gl.drawArrays(gl.TRIANGLES,0,6);
   }
   if(layer.kind==='mask-mosaic')this.mosaicCells(this.batchCellProgram,program,input,m,layer.w,layer.h,settings,w,h,0,0);
   use(program);gl.viewport(0,0,w,h);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,input);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,sigma>.25?this.second:input);gl.uniform1i(this.location(program,'softened'),1);gl.activeTexture(gl.TEXTURE0);
   const f=(name:string,v:number)=>gl.uniform1f(this.location(program,name),v),v3=(name:string,a:number,b:number,c:number)=>gl.uniform3f(this.location(program,name),a,b,c);
   v3('mapX',m.a,m.c,m.e);v3('mapY',m.b,m.d,m.f);v3('invX',inv.a,inv.c,inv.e);v3('invY',inv.b,inv.d,inv.f);gl.uniform2f(this.location(program,'size'),w,h);gl.uniform2f(this.location(program,'sampleSize'),w,h);gl.uniform2f(this.location(program,'origin'),0,0);gl.uniform2f(this.location(program,'uRes'),layer.w,layer.h);
   const shape=maskGeometry(layer.kind,settings);f('circle',shape==='star'?2:shape==='circle'?1:0);const points=new Float32Array(20);for(let j=0;j<10;j++){const a=-Math.PI/2+j*Math.PI/5,r=j%2?.225:.5;points[j*2]=Math.cos(a)*r;points[j*2+1]=Math.sin(a)*r;}gl.uniform2fv(this.location(program,'starPoints[0]'),points);
   f('edgeAA',1/Math.max(1,Math.min(layer.w*Math.hypot(m.a,m.b),layer.h*Math.hypot(m.c,m.d))));f('objectOpacity',layer.opacity);f('feather',0);f('mode',layer.kind==='mask-mosaic'?0:layer.kind==='mask-bricks'?1:layer.kind==='mask-negative'?3:kind==='mask-negative-mono'?6:layer.kind==='mask-negative-mono'?6:layer.kind==='mask-monochrome'?4:layer.kind==='mask-thermal'?5:2);f('amount',layer.kind.includes('frost')||layer.kind==='mask-mosaic'||layer.kind==='mask-bricks'||layer.kind==='mask-negative'||layer.kind==='mask-negative-mono'?1:(settings.maskAmount??100)/100);
   f('fxMosaicBlocks',settings.maskCells??15);f('fxMosaicGap',0);f('fxMosaicShape',0);f('fxGlassBlocks',glassCells(settings));f('fxGlassRound',0);f('fxGlassRefract',(settings.maskRefract??100)/100);f('fxGlassBevel',0);
   const last=i===layers.length-1;gl.bindFramebuffer(gl.FRAMEBUFFER,last?null:this.frame);if(!last){const output=this.batchTextures[1+i%2];gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,output,0);input=output;}
   // Outside the mask, use a cheap exact texture copy. Only its visible
   // physical bounds need the material shader (including analytic edges).
   use(this.batchCopyProgram);gl.drawArrays(gl.TRIANGLES,0,6);use(program);
   const bounds=maskPhysicalBounds(m,layer.w,layer.h,w,h,2);
   if(bounds.width&&bounds.height){gl.enable(gl.SCISSOR_TEST);gl.scissor(bounds.left,h-bounds.top-bounds.height,bounds.width,bounds.height);gl.drawArrays(gl.TRIANGLES,0,6);gl.disable(gl.SCISSOR_TEST);}
  }
  this.lastBlur='';this.activeSource=null;return this.canvas;
 }
 render(source:HTMLCanvasElement,m:DOMMatrix,w:number,h:number,kind:string,settings:MaskSettings,b:{left:number;top:number;width:number;height:number},sigma:number,sourceStamp?:unknown,sourceKey:unknown='default'){
  const start=performance.now(),gl=this.gl;if(gl.isContextLost())throw Error('mask context lost');
  // Capacity grows in small blocks; moving a mask never reallocates its source.
  const width=Math.ceil(b.width/64)*64,height=Math.ceil(b.height/64)*64;
  if(width>this.maxTextureSize||height>this.maxTextureSize)throw Error('mask texture too large');
  const resized=width>this.width||height>this.height;
  if(resized){this.width=Math.max(width,this.width);this.height=Math.max(height,this.height);}
  // Upload the already-composited viewport directly. No 2D staging/readback;
  // mask pose is a uniform, not an object-sized bitmap allocation.
  if(source.width>this.maxTextureSize||source.height>this.maxTextureSize)throw Error('mask source too large');
  // Each logical layer has its own resident lower-ink texture. Alternating
  // masks must not upload the entire viewport again just because another
  // mask was painted between frames. This cache is bounded, not object-sized.
  let slot=this.sources.get(sourceKey);
  if(!slot){
   const texture=this.sources.size?gl.createTexture()!:this.input;
   gl.bindTexture(gl.TEXTURE_2D,texture);
   for(const [k,v]of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,k,v);
   slot={texture,source:null,stamp:null,width:0,height:0};
  }
  this.sources.delete(sourceKey);this.sources.set(sourceKey,slot);
  this.input=slot.texture;this.lastSource=slot.source;this.lastStamp=slot.stamp;this.inputWidth=slot.width;this.inputHeight=slot.height;
  if(this.activeSource!==sourceKey)this.lastBlur='';this.activeSource=sourceKey;
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.input);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,1);
  const unchanged=sourceStamp!==undefined&&this.lastSource===source&&this.lastStamp===sourceStamp&&this.inputWidth===source.width&&this.inputHeight===source.height;
  if(!unchanged){
   if(this.inputWidth!==source.width||this.inputHeight!==source.height){this.inputWidth=source.width;this.inputHeight=source.height;gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);}
   else gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,source);
   this.lastSource=source;this.lastStamp=sourceStamp;this.lastBlur='';backdropMaskDiagnostics.uploads++;
  }else backdropMaskDiagnostics.reuses++;
  Object.assign(slot,{source:this.lastSource,stamp:this.lastStamp,width:this.inputWidth,height:this.inputHeight});
  let pixels=[...this.sources.values()].reduce((n,s)=>n+s.width*s.height,0);
  for(const [key,value]of this.sources){
   if(this.sources.size<=8&&pixels<=32*1024*1024)break;
   if(key===sourceKey)continue;gl.deleteTexture(value.texture);this.sources.delete(key);pixels-=value.width*value.height;
  }
  backdropMaskDiagnostics.uploadMs=performance.now()-start;
  gl.viewport(0,0,this.width,this.height);gl.disable(gl.BLEND);
  const use=(p:WebGLProgram)=>{gl.useProgram(p);const pos=this.positions.get(p)!;gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);gl.uniform1i(this.location(p,'image'),0);};
  if(kind.includes('frost')){
   const blurKey=`${sigma}|${source.width}x${source.height}`;
   if(unchanged&&this.lastBlur===blurKey)return this.canvas;
   // Existing art-material Gaussian uses six samples per sigma. Only this
   // deliberately band-limited blur is sampled at that bandwidth: original
   // ink, negative/mosaic/brick sampling and analytic mask edges stay native.
   const bandwidth=blurBandwidth(sigma);
   const bw=Math.max(1,Math.ceil(source.width*bandwidth)),bh=Math.max(1,Math.ceil(source.height*bandwidth));
   if(bw!==this.blurWidth||bh!==this.blurHeight){this.blurWidth=bw;this.blurHeight=bh;for(const t of [this.first,this.second]){gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,bw,bh,0,gl.RGBA,gl.UNSIGNED_BYTE,null);}}
   gl.bindTexture(gl.TEXTURE_2D,this.input);gl.viewport(0,0,bw,bh);
   use(this.blurProgram);const radius=Math.max(.25,sigma*bandwidth),step=Math.max(1,radius/8),weights=new Float32Array(25);let total=0;
   for(let i=0;i<=24;i++){weights[i]=Math.exp(-((i*step)**2)/(2*radius*radius));total+=weights[i]*(i?2:1);}for(let i=0;i<=24;i++)weights[i]/=total;
   gl.uniform1f(this.location(this.blurProgram,'stepSize'),step);gl.uniform1fv(this.location(this.blurProgram,'weights[0]'),weights);
   gl.bindFramebuffer(gl.FRAMEBUFFER,this.frame);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.first,0);gl.uniform2f(this.location(this.blurProgram,'direction'),1/bw,0);gl.drawArrays(gl.TRIANGLES,0,6);
   gl.bindTexture(gl.TEXTURE_2D,this.first);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.second,0);gl.uniform2f(this.location(this.blurProgram,'direction'),0,1/bh);gl.drawArrays(gl.TRIANGLES,0,6);
   // Transfer only the blurred bandwidth, not a full-resolution GPU bitmap.
   // Canvas clips/composites this material with native analytic edges below.
   if(this.canvas.width!==bw)this.canvas.width=bw;if(this.canvas.height!==bh)this.canvas.height=bh;
   gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,bw,bh);use(this.copyProgram);gl.bindTexture(gl.TEXTURE_2D,this.second);gl.drawArrays(gl.TRIANGLES,0,6);this.lastBlur=blurKey;return this.canvas;
  }
  this.lastBlur='';
  if(this.canvas.width!==this.width)this.canvas.width=this.width;if(this.canvas.height!==this.height)this.canvas.height=this.height;
  const local=new DOMMatrix([m.a,m.b,m.c,m.d,m.e-b.left,m.f-b.top]),inverse=local.inverse();
  if(kind==='mask-mosaic')this.mosaicCells(this.cellProgram,this.program,this.input,local,w,h,settings,source.width,source.height,b.left,b.top);
  gl.viewport(0,0,this.width,this.height);gl.bindFramebuffer(gl.FRAMEBUFFER,null);use(this.program);
  const f=(name:string,v:number)=>gl.uniform1f(this.location(this.program,name),v),v3=(name:string,x:number,y:number,z:number)=>gl.uniform3f(this.location(this.program,name),x,y,z);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.input);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.second);gl.uniform1i(this.location(this.program,'softened'),1);gl.activeTexture(gl.TEXTURE0);
  v3('mapX',local.a,local.c,local.e);v3('mapY',local.b,local.d,local.f);v3('invX',inverse.a,inverse.c,inverse.e);v3('invY',inverse.b,inverse.d,inverse.f);
  gl.uniform2f(this.location(this.program,'size'),this.width,this.height);gl.uniform2f(this.location(this.program,'uRes'),w,h);
  gl.uniform2f(this.location(this.program,'sampleSize'),source.width,source.height);gl.uniform2f(this.location(this.program,'origin'),b.left,b.top);
  f('mode',kind==='mask-mosaic'?0:kind==='mask-bricks'?1:kind==='mask-negative'?3:kind==='mask-negative-mono'?6:kind==='mask-monochrome'?4:kind==='mask-thermal'?5:2);f('circle',0);f('feather',0);f('amount',kind==='mask-mosaic'||kind==='mask-bricks'||kind==='mask-negative'||kind==='mask-negative-mono'?1:(settings.maskAmount??maskDefaults(kind).maskAmount!)/100);
  f('edgeAA',1/Math.max(1,Math.min(w*Math.hypot(m.a,m.b),h*Math.hypot(m.c,m.d))));
  f('fxMosaicBlocks',settings.maskCells??15);f('fxMosaicGap',0);f('fxMosaicShape',0);f('fxGlassBlocks',glassCells(settings));f('fxGlassRound',0);f('fxGlassRefract',(settings.maskRefract??100)/100);f('fxGlassBevel',0);
  gl.drawArrays(gl.TRIANGLES,0,6);return this.canvas;
 }
 /** A target canvas went away: drop every reference to it so it can be
     collected. Its texture slots stay allocated and simply re-upload. */
 release(canvas:HTMLCanvasElement){
  for(const slot of this.sources.values())if(slot.source===canvas){slot.source=null;slot.stamp=null;slot.width=slot.height=0;}
  if(this.lastSource===canvas){this.lastSource=null;this.lastStamp=null;this.inputWidth=this.inputHeight=0;}
  for(const [key,slot]of this.photoTextures)if(slot.source===canvas){this.gl.deleteTexture(slot.texture);this.photoTextures.delete(key);}
 }
 dispose(){this.sources.clear();this.photoTextures.clear();this.gl.getExtension('WEBGL_lose_context')?.loseContext();this.canvas.width=this.canvas.height=1;this.lastSource=null;this.lastStamp=null;}
}
/* One GPU program set serves every target canvas. It used to be one WebGL
   context + six compiled programs PER canvas (every preview tile, the prefix
   cache, every classic scene surface): the first mask frame stalled on shader
   compilation, and iOS's ~16 live-context limit started evicting the photo
   renderers' contexts. Nothing in the renderer depends on which canvas it
   draws into: sources are keyed by identity + stamp and the output is
   consumed synchronously. */
const renderers={shared:undefined as MaskGpu|null|undefined,failures:0};
const maskRenderer=()=>{
 let renderer=renderers.shared;
 if(renderer===undefined||renderer?.gl.isContextLost()){
  renderer?.dispose();renderer=null;
  try{renderer=new MaskGpu();}catch(error){renderers.failures++;backdropMaskDiagnostics.lastError=String(error);}
  // A device without usable WebGL keeps the full-resolution CPU fallback.
  renderers.shared=renderer??(renderers.failures<3?undefined:null);
 }
 return renderer;
};
const dropRenderer=(renderer:MaskGpu|null)=>{if(renderer&&renderer.gl.isContextLost()){renderer.dispose();if(renderers.shared===renderer)renderers.shared=undefined;}};
/** Warm the shared programs before the first mask is added (idle time). */
export const warmBackdropMasks=()=>{try{maskRenderer();}catch{}};
export const backdropMaskDiagnostics={gpuFrames:0,cpuFrames:0,uploads:0,reuses:0,lastError:'',renderMs:0,compositeMs:0,uploadMs:0};
const featherSurfaces=new WeakMap<HTMLCanvasElement,HTMLCanvasElement>();
export const disposeBackdropMasks=(canvas:HTMLCanvasElement)=>{renderers.shared?.release(canvas);const f=featherSurfaces.get(canvas);if(f)f.width=f.height=1;featherSurfaces.delete(canvas);};
export function drawBackdropMaskBatch(ctx:CanvasRenderingContext2D,layers:BackdropMaskLayer[],photos?:BackdropPhotoLayer[]){
 layers=layers.filter(layer=>layer.opacity>0);
 if(!layers.length)return;let renderer:MaskGpu|null=null;const start=performance.now();
 try{
  renderer=maskRenderer();
  if(!renderer)throw Error('mask batch fallback');const output=renderer.renderBatch(ctx.canvas,layers,photos);backdropMaskDiagnostics.gpuFrames+=layers.length;backdropMaskDiagnostics.renderMs=performance.now()-start;
  const t=performance.now();ctx.save();try{
   // Preserve untouched wide-gamut pixels outside the material footprints.
   // Union contours all share winding even when an object was mirrored.
   ctx.beginPath();for(const layer of layers){const m=layer.matrix;ctx.setTransform(m.a,m.b,m.c,m.d,m.e,m.f);const shape=maskGeometry(layer.kind,layer.settings),reverse=m.a*m.d-m.b*m.c<0;
    if(shape==='circle'){ctx.moveTo(layer.w/2,0);ctx.ellipse(0,0,layer.w/2,layer.h/2,0,0,Math.PI*2,reverse);ctx.closePath();}
    else {const points=shape==='star'?Array.from({length:10},(_,i)=>{const a=-Math.PI/2+i*Math.PI/5,r=i%2?.45:1;return[Math.cos(a)*layer.w/2*r,Math.sin(a)*layer.h/2*r];}):[[-layer.w/2,-layer.h/2],[layer.w/2,-layer.h/2],[layer.w/2,layer.h/2],[-layer.w/2,layer.h/2]];if(reverse)points.reverse();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();}
   }ctx.setTransform(1,0,0,1,0,0);ctx.clip();ctx.globalAlpha=1;ctx.globalCompositeOperation='copy';ctx.drawImage(output,0,0);
  }finally{ctx.restore();}backdropMaskDiagnostics.compositeMs=performance.now()-t;
 }catch(error){
  dropRenderer(renderer);backdropMaskDiagnostics.lastError=String(error);
  for(const layer of layers){ctx.save();try{const m=layer.matrix;ctx.setTransform(m.a,m.b,m.c,m.d,m.e,m.f);ctx.globalAlpha=layer.opacity;drawBackdropMask(ctx,layer.kind,layer.w,layer.h,layer.settings);}finally{ctx.restore();}}
 }
}
function fallbackMask(source:HTMLCanvasElement,m:DOMMatrix,w:number,h:number,kind:string,settings:MaskSettings,b:{left:number;top:number;width:number;height:number},sigma:number){
 const canvas=document.createElement('canvas');canvas.width=b.width;canvas.height=b.height;const g=canvas.getContext('2d',{willReadFrequently:true})!;
 g.drawImage(source,b.left,b.top,b.width,b.height,0,0,b.width,b.height);const data=g.getImageData(0,0,b.width,b.height),original=data.data.slice();
 const softened=kind.includes('frost')&&sigma>.25?blurRGBA(original,b.width,b.height,sigma):original;
 const inv=m.inverse(),circle=false,amount=kind==='mask-mosaic'||kind==='mask-bricks'||kind==='mask-negative'||kind==='mask-negative-mono'?1:Math.max(0,Math.min(100,settings.maskAmount??maskDefaults(kind).maskAmount!))/100;
 const feather=kind==='mask-frost-feather'?(settings.maskFeather??35)/200:0,aa=1/Math.max(1,Math.min(w*Math.hypot(m.a,m.b),h*Math.hypot(m.c,m.d)));
 const cells=kind==='mask-bricks'?glassCells(settings):Math.max(1,settings.maskCells??15),gy=kind==='mask-bricks'?Math.max(1,Math.floor(cells*h/w+.001)):Math.max(.001,cells*h/w);
 for(let y=0;y<b.height;y++)for(let x=0;x<b.width;x++){
  const screenX=x+b.left+.5,screenY=y+b.top+.5,u=(inv.a*screenX+inv.c*screenY+inv.e)/w+.5,v=(inv.b*screenX+inv.d*screenY+inv.f)/h+.5;
  const distance=circle?Math.hypot(u-.5,v-.5):Math.max(Math.abs(u-.5),Math.abs(v-.5));let t=Math.max(0,Math.min(1,(.5-distance)/Math.max(aa,feather)));const alpha=t*t*(3-2*t),i=(y*b.width+x)*4;
  let sample=i;
  if(kind==='mask-mosaic'||kind==='mask-bricks'){
   let a=u,c=v;if(kind==='mask-mosaic'){a=(Math.floor(u*cells)+.5)/cells;c=(Math.floor(v*gy)+.5)/gy;}else{const k=(settings.maskRefract??100)/100*(1-1/GLASS_MAGNIFY);a=Math.max(0,Math.min(1,u-((u*cells)%1-.5)*k/cells));c=Math.max(0,Math.min(1,v-((v*gy)%1-.5)*k/gy));}
   const lx=(a-.5)*w,ly=(c-.5)*h,sx=Math.max(0,Math.min(b.width-1,Math.round(m.a*lx+m.c*ly+m.e-b.left-.5))),sy=Math.max(0,Math.min(b.height-1,Math.round(m.b*lx+m.d*ly+m.f-b.top-.5)));sample=(sy*b.width+sx)*4;
  }
  const l=(original[i]*.2126+original[i+1]*.7152+original[i+2]*.0722),heat=kind==='mask-thermal'?thermalRGB(l/255):null;
  for(let ch=0;ch<3;ch++){const value=kind.includes('frost')?softened[i+ch]:kind==='mask-negative'?255-original[i+ch]:kind==='mask-negative-mono'?255-l:kind==='mask-monochrome'?l:heat?heat[ch]:original[sample+ch];data.data[i+ch]=original[i+ch]+(value-original[i+ch])*(kind.includes('frost')?1:amount);}
  data.data[i+3]=original[i+3]*alpha;
 }g.putImageData(data,0,0);return canvas;
}
/** ctx is object-local; source shares ctx.canvas's physical viewport coordinates. */
export function drawBackdropMask(ctx:CanvasRenderingContext2D,kind:string,w:number,h:number,settings:MaskSettings={},source=ctx.canvas,sourceStamp?:unknown,sourceKey?:unknown){
 if(w<=0||h<=0)return;const m=ctx.getTransform();if(![m.a,m.b,m.c,m.d,m.e,m.f].every(Number.isFinite)||Math.abs(m.a*m.d-m.b*m.c)<1e-8)return;
 const sigma=kind.includes('frost')?Math.min(w*Math.hypot(m.a,m.b),h*Math.hypot(m.c,m.d))*.12*(settings.maskAmount??50)/100:0;
 const b=maskPhysicalBounds(m,w,h,source.width,source.height,Math.max(sigma*3,kind==='mask-mosaic'||kind==='mask-bricks'?Math.max(w*Math.hypot(m.a,m.b),h*Math.hypot(m.c,m.d))*.1:0)+2);if(!b.width||!b.height)return;
 let renderer:MaskGpu|null=null,output:HTMLCanvasElement;const renderStart=performance.now();
 try{
  renderer=maskRenderer();
  output=renderer?renderer.render(source,m,w,h,kind,settings,b,sigma,sourceStamp,sourceKey):fallbackMask(source,m,w,h,kind,settings,b,sigma);
  if(renderer)backdropMaskDiagnostics.gpuFrames++;else backdropMaskDiagnostics.cpuFrames++;
 }catch(error){dropRenderer(renderer);renderer=null;backdropMaskDiagnostics.lastError=String(error);backdropMaskDiagnostics.cpuFrames++;console.warn('遮罩 GPU 改用安全備援',error);output=fallbackMask(source,m,w,h,kind,settings,b,sigma);}
 backdropMaskDiagnostics.renderMs=performance.now()-renderStart;const compositeStart=performance.now();ctx.save();try{
  // Shape belongs to the native analytic clip, not a low-resolution blur bitmap.
  clipMask(ctx,w,h,maskGeometry(kind,settings));
  if(renderer&&kind.includes('frost')){
   const sx=output.width*b.left/source.width,sy=output.height*b.top/source.height,sw=output.width*b.width/source.width,sh=output.height*b.height/source.height;
   if(kind==='mask-frost-feather'&&(settings.maskFeather??35)>0){
    const surface=featherSurfaces.get(ctx.canvas)??document.createElement('canvas');featherSurfaces.set(ctx.canvas,surface);
    if(surface.width!==b.width)surface.width=b.width;if(surface.height!==b.height)surface.height=b.height;
    const g=surface.getContext('2d')!;g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,b.width,b.height);g.drawImage(output,sx,sy,sw,sh,0,0,b.width,b.height);
    g.save();g.globalCompositeOperation='destination-in';g.setTransform(m.a,m.b,m.c,m.d,m.e-b.left,m.f-b.top);g.scale(w,h);
    const gradient=g.createRadialGradient(0,0,Math.max(0,.5-(settings.maskFeather??35)/200),0,0,.5);gradient.addColorStop(0,'#fff');gradient.addColorStop(1,'#fff0');g.fillStyle=gradient;g.fillRect(-.5,-.5,1,1);g.restore();
    ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(surface,b.left,b.top);
   }else{ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(output,sx,sy,sw,sh,b.left,b.top,b.width,b.height);}
  }else{ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(output,0,0,b.width,b.height,b.left,b.top,b.width,b.height);}
 }finally{ctx.restore();backdropMaskDiagnostics.compositeMs=performance.now()-compositeStart;}
}
