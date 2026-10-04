import {FX_DEFS} from './glEffects';
import {blurRGBA} from './artMaterials';

/** Material layers sample preceding scene ink, never a saved source photograph. */
export const MASK_SHAPE_ITEMS = [
 {id:'mask-mosaic',kind:'mask-mosaic',filled:true,label:'方形馬賽克'},
 {id:'mask-bricks',kind:'mask-bricks',filled:true,label:'方形玻璃磚'},
 {id:'mask-frost',kind:'mask-frost',filled:true,label:'方形毛玻璃'},
 {id:'mask-negative',kind:'mask-negative',filled:true,label:'方形負片'},
 {id:'mask-frost-circle',kind:'mask-frost-circle',filled:true,label:'圓形毛玻璃'},
 {id:'mask-frost-feather',kind:'mask-frost-feather',filled:true,label:'羽化圓形毛玻璃'},
] as const;
export const isBackdropMask=(kind?:string)=>MASK_SHAPE_ITEMS.some(s=>s.kind===kind);
export const maskGeometry=(kind:string)=>kind.includes('circle')||kind.includes('feather')?'circle':'square';
export type MaskSettings={maskAmount?:number;maskCells?:number;maskRefract?:number;maskFeather?:number};
export const maskDefaults=(kind:string):MaskSettings=>({maskAmount:kind.includes('frost')?50:100,maskCells:kind==='mask-mosaic'?50:22,maskRefract:100,maskFeather:kind==='mask-frost-feather'?35:0});
export function maskPhysicalBounds(m:DOMMatrix,w:number,h:number,width:number,height:number,pad=0){
 const pts=[[-w/2,-h/2],[w/2,-h/2],[-w/2,h/2],[w/2,h/2]].map(([x,y])=>({x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f}));
 const left=Math.max(0,Math.floor(Math.min(...pts.map(p=>p.x))-pad)),top=Math.max(0,Math.floor(Math.min(...pts.map(p=>p.y))-pad));
 return {left,top,width:Math.max(0,Math.min(width,Math.ceil(Math.max(...pts.map(p=>p.x))+pad))-left),height:Math.max(0,Math.min(height,Math.ceil(Math.max(...pts.map(p=>p.y))+pad))-top)};
}

const body=(id:string)=>FX_DEFS.find(d=>d.id===id)!.passes[0].body.replace(/texture2D\(uTex,\s*([^;]+?)\)\.rgb/g,'sampleBackdrop($1).rgb').replace('floor(fxGlassBlocks * uRes.y / uRes.x)','max(1., floor(fxGlassBlocks * uRes.y / uRes.x))');
const vertex='attribute vec2 p;varying vec2 uv;void main(){uv=(p+1.)*.5;gl_Position=vec4(p,0.,1.);}';
const header=`precision highp float;varying vec2 uv;uniform sampler2D image;uniform vec2 size;`;
// The exact same 49-tap Gaussian, but weights are evaluated once per mask,
// not 49 exponential functions for every pixel in both passes.
const blur=header+`uniform vec2 direction;uniform float stepSize;uniform float weights[25];void main(){vec4 sum=texture2D(image,uv)*weights[0];for(int i=1;i<=24;i++){vec2 d=direction*float(i)*stepSize;sum+=(texture2D(image,uv+d)+texture2D(image,uv-d))*weights[i];}gl_FragColor=sum;}`;
const material=header+`
 uniform sampler2D softened;uniform vec3 mapX,mapY,invX,invY;uniform vec2 uRes;
 uniform float mode,circle,feather,amount,edgeAA;
 uniform float fxMosaicBlocks,fxMosaicGap,fxMosaicShape,fxGlassBlocks,fxGlassRound,fxGlassRefract,fxGlassBevel;
 vec2 screenUV(vec2 p){vec3 q=vec3((p-.5)*uRes,1.);return vec2(dot(mapX,q)/size.x,1.-dot(mapY,q)/size.y);}
 vec4 sampleBackdrop(vec2 p){return texture2D(image,screenUV(p));}
 vec4 mosaic(vec2 uv){${body('fxMosaic')}}
 vec4 bricks(vec2 uv){${body('fxGlass')}}
 void main(){
  vec3 screen=vec3(uv.x*size.x,(1.-uv.y)*size.y,1.);
  vec2 local=vec2(dot(invX,screen),dot(invY,screen))/uRes+.5;
  vec2 delta=local-.5;float distance=circle>.5?length(delta):max(abs(delta.x),abs(delta.y));
  float alpha=1.-smoothstep(.5-max(edgeAA,feather*.5),.5,distance);
  vec4 original=texture2D(image,uv);vec3 c=original.rgb;
  if(mode<.5)c=mosaic(local).rgb;else if(mode<1.5)c=bricks(local).rgb;
  else if(mode<2.5)c=texture2D(softened,uv).rgb;else c=1.-c;
  if(mode<1.5||mode>2.5)c=mix(original.rgb,c,amount);
  alpha*=original.a;gl_FragColor=vec4(c*alpha,alpha);
 }`;
class MaskGpu {
 canvas=document.createElement('canvas');crop=document.createElement('canvas');
 gl:WebGLRenderingContext;program:WebGLProgram;blurProgram:WebGLProgram;copyProgram:WebGLProgram;
 input:WebGLTexture;first:WebGLTexture;second:WebGLTexture;frame:WebGLFramebuffer;
 width=0;height=0;blurWidth=0;blurHeight=0;
 maxTextureSize=0;positions=new Map<WebGLProgram,number>();locations=new Map<WebGLProgram,Map<string,WebGLUniformLocation|null>>();
 location=(program:WebGLProgram,name:string)=>this.locations.get(program)!.get(name)??null;
 constructor(){
  const gl=this.canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:false,preserveDrawingBuffer:true});
  if(!gl)throw Error('遮罩需要 WebGL');this.gl=gl;
  const compile=(fragment:string)=>{const p=gl.createProgram()!;for(const [type,code]of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]] as const){const s=gl.createShader(type)!;gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s)||'mask shader');gl.attachShader(p,s);gl.deleteShader(s);}gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p)||'mask link');return p;};
  const copy=header+'void main(){vec4 c=texture2D(image,uv);gl_FragColor=vec4(c.rgb*c.a,c.a);}';
  this.program=compile(material);this.blurProgram=compile(blur);this.copyProgram=compile(copy);this.maxTextureSize=gl.getParameter(gl.MAX_TEXTURE_SIZE);
  for(const [program,code]of [[this.program,material],[this.blurProgram,blur],[this.copyProgram,copy]] as const){
   this.positions.set(program,gl.getAttribLocation(program,'p'));const locations=new Map<string,WebGLUniformLocation|null>();
   for(const match of code.matchAll(/uniform\s+\w+\s+([^;]+);/g))for(const variable of match[1].split(',')){const name=variable.trim().replace(/\[\d+\]/,'[0]');locations.set(name,gl.getUniformLocation(program,name));}this.locations.set(program,locations);
  }
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  const texture=()=>{const t=gl.createTexture()!;gl.bindTexture(gl.TEXTURE_2D,t);for(const [k,v]of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,k,v);return t;};
  this.input=texture();this.first=texture();this.second=texture();this.frame=gl.createFramebuffer()!;
 }
 render(source:HTMLCanvasElement,m:DOMMatrix,w:number,h:number,kind:string,settings:MaskSettings,b:{left:number;top:number;width:number;height:number},sigma:number){
  const start=performance.now(),gl=this.gl;if(gl.isContextLost())throw Error('mask context lost');
  // Capacity grows in small blocks; moving a mask never reallocates its source.
  const width=Math.ceil(b.width/64)*64,height=Math.ceil(b.height/64)*64;
  if(width>this.maxTextureSize||height>this.maxTextureSize)throw Error('mask texture too large');
  if(width>this.width||height>this.height||this.width>width*2||this.height>height*2){this.width=width;this.height=height;this.crop.width=width;this.crop.height=height;}
  const c=this.crop.getContext('2d',{willReadFrequently:true})!;c.clearRect(0,0,this.width,this.height);c.drawImage(source,b.left,b.top,b.width,b.height,0,0,b.width,b.height);
  // Extend the actual source edge across capacity padding. Transparent padding
  // must never enter the Gaussian kernel as a dark rectangle around the mask.
  if(this.width>b.width)c.drawImage(this.crop,b.width-1,0,1,b.height,b.width,0,this.width-b.width,b.height);
  if(this.height>b.height)c.drawImage(this.crop,0,b.height-1,this.width,1,0,b.height,this.width,this.height-b.height);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.input);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,1);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.crop);
  backdropMaskDiagnostics.uploadMs=performance.now()-start;
  gl.viewport(0,0,this.width,this.height);gl.disable(gl.BLEND);
  const use=(p:WebGLProgram)=>{gl.useProgram(p);const pos=this.positions.get(p)!;gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);gl.uniform1i(this.location(p,'image'),0);};
  if(kind.includes('frost')){
   // Existing art-material Gaussian uses six samples per sigma. Only this
   // deliberately band-limited blur is sampled at that bandwidth: original
   // ink, negative/mosaic/brick sampling and analytic mask edges stay native.
   const bandwidth=Math.min(1,6/Math.max(1,sigma));
   const bw=Math.max(1,Math.ceil(this.width*bandwidth)),bh=Math.max(1,Math.ceil(this.height*bandwidth));
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
   gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,bw,bh);use(this.copyProgram);gl.bindTexture(gl.TEXTURE_2D,this.second);gl.drawArrays(gl.TRIANGLES,0,6);return this.canvas;
  }
  if(this.canvas.width!==this.width)this.canvas.width=this.width;if(this.canvas.height!==this.height)this.canvas.height=this.height;
  gl.viewport(0,0,this.width,this.height);gl.bindFramebuffer(gl.FRAMEBUFFER,null);use(this.program);
  const f=(name:string,v:number)=>gl.uniform1f(this.location(this.program,name),v),v3=(name:string,x:number,y:number,z:number)=>gl.uniform3f(this.location(this.program,name),x,y,z);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.input);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.second);gl.uniform1i(this.location(this.program,'softened'),1);gl.activeTexture(gl.TEXTURE0);
  const local=new DOMMatrix([m.a,m.b,m.c,m.d,m.e-b.left,m.f-b.top]),inverse=local.inverse();
  v3('mapX',local.a,local.c,local.e);v3('mapY',local.b,local.d,local.f);v3('invX',inverse.a,inverse.c,inverse.e);v3('invY',inverse.b,inverse.d,inverse.f);
  gl.uniform2f(this.location(this.program,'size'),this.width,this.height);gl.uniform2f(this.location(this.program,'uRes'),w,h);
  f('mode',kind==='mask-mosaic'?0:kind==='mask-bricks'?1:kind==='mask-negative'?3:2);f('circle',maskGeometry(kind)==='circle'?1:0);f('feather',kind==='mask-frost-feather'?(settings.maskFeather??35)/100:0);f('amount',(settings.maskAmount??maskDefaults(kind).maskAmount!)/100);
  f('edgeAA',1/Math.max(1,Math.min(w*Math.hypot(m.a,m.b),h*Math.hypot(m.c,m.d))));
  f('fxMosaicBlocks',settings.maskCells??50);f('fxMosaicGap',0);f('fxMosaicShape',0);f('fxGlassBlocks',settings.maskCells??22);f('fxGlassRound',0);f('fxGlassRefract',(settings.maskRefract??100)/100);f('fxGlassBevel',0);
  gl.drawArrays(gl.TRIANGLES,0,6);return this.canvas;
 }
 dispose(){this.gl.getExtension('WEBGL_lose_context')?.loseContext();this.canvas.width=this.canvas.height=this.crop.width=this.crop.height=1;}
}
const renderers=new WeakMap<HTMLCanvasElement,MaskGpu|null>();
export const backdropMaskDiagnostics={gpuFrames:0,cpuFrames:0,lastError:'',renderMs:0,compositeMs:0,uploadMs:0};
const featherSurfaces=new WeakMap<HTMLCanvasElement,HTMLCanvasElement>();
export const disposeBackdropMasks=(canvas:HTMLCanvasElement)=>{renderers.get(canvas)?.dispose();renderers.delete(canvas);const f=featherSurfaces.get(canvas);if(f)f.width=f.height=1;featherSurfaces.delete(canvas);};
function fallbackMask(source:HTMLCanvasElement,m:DOMMatrix,w:number,h:number,kind:string,settings:MaskSettings,b:{left:number;top:number;width:number;height:number},sigma:number){
 const canvas=document.createElement('canvas');canvas.width=b.width;canvas.height=b.height;const g=canvas.getContext('2d',{willReadFrequently:true})!;
 g.drawImage(source,b.left,b.top,b.width,b.height,0,0,b.width,b.height);const data=g.getImageData(0,0,b.width,b.height),original=data.data.slice();
 const softened=kind.includes('frost')&&sigma>.25?blurRGBA(original,b.width,b.height,sigma):original;
 const inv=m.inverse(),circle=maskGeometry(kind)==='circle',amount=Math.max(0,Math.min(100,settings.maskAmount??maskDefaults(kind).maskAmount!))/100;
 const feather=kind==='mask-frost-feather'?(settings.maskFeather??35)/200:0,aa=1/Math.max(1,Math.min(w*Math.hypot(m.a,m.b),h*Math.hypot(m.c,m.d)));
 const cells=Math.max(1,settings.maskCells??(kind==='mask-mosaic'?50:22)),gy=kind==='mask-bricks'?Math.max(1,Math.floor(cells*h/w)):Math.max(.001,cells*h/w);
 for(let y=0;y<b.height;y++)for(let x=0;x<b.width;x++){
  const screenX=x+b.left+.5,screenY=y+b.top+.5,u=(inv.a*screenX+inv.c*screenY+inv.e)/w+.5,v=(inv.b*screenX+inv.d*screenY+inv.f)/h+.5;
  const distance=circle?Math.hypot(u-.5,v-.5):Math.max(Math.abs(u-.5),Math.abs(v-.5));let t=Math.max(0,Math.min(1,(.5-distance)/Math.max(aa,feather)));const alpha=t*t*(3-2*t),i=(y*b.width+x)*4;
  let sample=i;
  if(kind==='mask-mosaic'||kind==='mask-bricks'){
   let a=u,c=v;if(kind==='mask-mosaic'){a=(Math.floor(u*cells)+.5)/cells;c=(Math.floor(v*gy)+.5)/gy;}else{a=Math.max(0,Math.min(1,u-((u*cells)%1-.5)*2*(settings.maskRefract??100)/100*.06));c=Math.max(0,Math.min(1,v-((v*gy)%1-.5)*2*(settings.maskRefract??100)/100*.06));}
   const lx=(a-.5)*w,ly=(c-.5)*h,sx=Math.max(0,Math.min(b.width-1,Math.round(m.a*lx+m.c*ly+m.e-b.left-.5))),sy=Math.max(0,Math.min(b.height-1,Math.round(m.b*lx+m.d*ly+m.f-b.top-.5)));sample=(sy*b.width+sx)*4;
  }
  for(let ch=0;ch<3;ch++){const value=kind.includes('frost')?softened[i+ch]:kind==='mask-negative'?255-original[i+ch]:original[sample+ch];data.data[i+ch]=original[i+ch]+(value-original[i+ch])*(kind.includes('frost')?1:amount);}
  data.data[i+3]=original[i+3]*alpha;
 }g.putImageData(data,0,0);return canvas;
}
/** ctx is object-local; source shares ctx.canvas's physical viewport coordinates. */
export function drawBackdropMask(ctx:CanvasRenderingContext2D,kind:string,w:number,h:number,settings:MaskSettings={},source=ctx.canvas){
 if(w<=0||h<=0)return;const m=ctx.getTransform();if(![m.a,m.b,m.c,m.d,m.e,m.f].every(Number.isFinite)||Math.abs(m.a*m.d-m.b*m.c)<1e-8)return;
 const sigma=kind.includes('frost')?Math.min(w*Math.hypot(m.a,m.b),h*Math.hypot(m.c,m.d))*.12*(settings.maskAmount??50)/100:0;
 const b=maskPhysicalBounds(m,w,h,source.width,source.height,Math.max(sigma*3,kind==='mask-mosaic'||kind==='mask-bricks'?Math.max(w*Math.hypot(m.a,m.b),h*Math.hypot(m.c,m.d))*.1:0)+2);if(!b.width||!b.height)return;
 let renderer=renderers.get(ctx.canvas),output:HTMLCanvasElement;const renderStart=performance.now();
 try{
  if(renderer===undefined||renderer?.gl.isContextLost()){renderer?.dispose();renderer=new MaskGpu();renderers.set(ctx.canvas,renderer);}
  output=renderer?renderer.render(source,m,w,h,kind,settings,b,sigma):fallbackMask(source,m,w,h,kind,settings,b,sigma);
  if(renderer)backdropMaskDiagnostics.gpuFrames++;else backdropMaskDiagnostics.cpuFrames++;
 }catch(error){renderer?.dispose();renderer=null;renderers.set(ctx.canvas,null);backdropMaskDiagnostics.lastError=String(error);backdropMaskDiagnostics.cpuFrames++;console.warn('遮罩 GPU 改用安全備援',error);output=fallbackMask(source,m,w,h,kind,settings,b,sigma);}
 backdropMaskDiagnostics.renderMs=performance.now()-renderStart;const compositeStart=performance.now();ctx.save();try{
  if(renderer&&kind.includes('frost')){
   const sw=output.width*b.width/renderer.width,sh=output.height*b.height/renderer.height;
   if(kind==='mask-frost-feather'&&(settings.maskFeather??35)>0){
    const surface=featherSurfaces.get(ctx.canvas)??document.createElement('canvas');featherSurfaces.set(ctx.canvas,surface);
    if(surface.width!==b.width)surface.width=b.width;if(surface.height!==b.height)surface.height=b.height;
    const g=surface.getContext('2d')!;g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,b.width,b.height);g.drawImage(output,0,0,sw,sh,0,0,b.width,b.height);
    g.save();g.globalCompositeOperation='destination-in';g.setTransform(m.a,m.b,m.c,m.d,m.e-b.left,m.f-b.top);g.scale(w,h);
    const gradient=g.createRadialGradient(0,0,Math.max(0,.5-(settings.maskFeather??35)/200),0,0,.5);gradient.addColorStop(0,'#fff');gradient.addColorStop(1,'#fff0');g.fillStyle=gradient;g.fillRect(-.5,-.5,1,1);g.restore();
    ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(surface,b.left,b.top);
   }else{ctx.beginPath();if(maskGeometry(kind)==='circle')ctx.ellipse(0,0,w/2,h/2,0,0,Math.PI*2);else ctx.rect(-w/2,-h/2,w,h);ctx.clip();ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(output,0,0,sw,sh,b.left,b.top,b.width,b.height);}
  }else{ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(output,0,0,b.width,b.height,b.left,b.top,b.width,b.height);}
 }finally{ctx.restore();backdropMaskDiagnostics.compositeMs=performance.now()-compositeStart;}
}
