import {uniformLocation} from './uniformLocation';
import {bakePhotoFxLut,colorKeyOf,getLoadedLut,getPreparedFilterPair,hasPhotoFx,photoFxParams,type PhotoFx} from './photoFx';
import {copyPixelDither} from './photoPixelCore';
import {hasActiveFx} from './glEffects';
import {configureWebglWide} from './colorSpace';
export const supportsSceneColour=(fx:PhotoFx={})=>!hasActiveFx(fx)&&![fx.soft,fx.blur,fx.fringeIntensity,fx.leakOpacity,fx.colorNoise,fx.vignette].some(Boolean);
const vert=`#version 300 es
in vec2 p;out vec2 uv;void main(){uv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}`;
const frag=`#version 300 es
precision highp float;precision highp sampler3D;
uniform sampler2D originalScene;uniform sampler2D blackScene;uniform sampler2D whiteScene;
uniform sampler3D colours;uniform sampler3D plainColours;uniform bool paired;uniform float filmWeight;uniform bool identity;uniform bool wide;uniform bool masterMode;in vec2 uv;out vec4 outColor;
vec3 lookup(sampler3D table,vec3 c){
 if(!masterMode)return texture(table,c*(32./33.)+(.5/33.)).rgb;
 vec3 f=c*31.;ivec3 a=ivec3(floor(f)),b=min(a+1,ivec3(31));vec3 d=f-vec3(a);
 ivec3 iA,iB;vec4 w;
 if(d.r>d.g){if(d.g>d.b){iA=ivec3(b.r,a.g,a.b);iB=ivec3(b.r,b.g,a.b);w=vec4(1.-d.r,d.r-d.g,d.g-d.b,d.b);}
 else if(d.r>d.b){iA=ivec3(b.r,a.g,a.b);iB=ivec3(b.r,a.g,b.b);w=vec4(1.-d.r,d.r-d.b,d.b-d.g,d.g);}
 else{iA=ivec3(a.r,a.g,b.b);iB=ivec3(b.r,a.g,b.b);w=vec4(1.-d.b,d.b-d.r,d.r-d.g,d.g);}}
 else{if(d.b>d.g){iA=ivec3(a.r,a.g,b.b);iB=ivec3(a.r,b.g,b.b);w=vec4(1.-d.b,d.b-d.g,d.g-d.r,d.r);}
 else if(d.b>d.r){iA=ivec3(a.r,b.g,a.b);iB=ivec3(a.r,b.g,b.b);w=vec4(1.-d.g,d.g-d.b,d.b-d.r,d.r);}
 else{iA=ivec3(a.r,b.g,a.b);iB=ivec3(b.r,b.g,a.b);w=vec4(1.-d.g,d.g-d.r,d.r-d.b,d.b);}}
 return texelFetch(table,a,0).rgb*w.x+texelFetch(table,iA,0).rgb*w.y+texelFetch(table,iB,0).rgb*w.z+texelFetch(table,b,0).rgb*w.w;
}
vec3 linearRGB(vec3 c){return mix(c/12.92,pow((max(c,vec3(0.))+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
vec3 encodedRGB(vec3 c){c=max(c,vec3(0.));return mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(vec3(.0031308),c));}
vec3 toSrgb(vec3 c){if(!wide)return c;c=linearRGB(c);return clamp(encodedRGB(vec3(1.224745*c.r-.224904*c.g,-.042058*c.r+1.042081*c.g,-.019642*c.r-.078655*c.g+1.098537*c.b)),0.,1.);}
vec3 toWide(vec3 c){if(!wide)return c;c=linearRGB(c);return encodedRGB(vec3(.822593*c.r+.177534*c.g,.033200*c.r+.966784*c.g,.017085*c.r+.072396*c.g+.910301*c.b));}
void main(){
 vec4 original=texture(originalScene,uv);
 if(identity){outColor=original;return;}
 vec3 black=texture(blackScene,uv).rgb,white=texture(whiteScene,uv).rgb;
 vec3 coverage=max(white-black,vec3(0.));
 if(max(coverage.r,max(coverage.g,coverage.b))<.002){outColor=original;return;}
 vec3 photo=clamp((original.rgb-black)/max(coverage,vec3(.0001)),0.,1.);
 vec3 inputColour=toSrgb(photo),mapped=lookup(colours,inputColour);
 if(paired)mapped=mix(lookup(plainColours,inputColour),mapped,filmWeight);
 vec3 changed=toWide(mapped);
 outColor=vec4(clamp(black+coverage*changed,0.,1.),original.a);
}`;

/** Verification only: WebKit's drawImage(WebGL canvas) can lose the buffer's
 * P3 tag. Read the explicitly tagged pixels instead; never used on slider frames. */
export function copySceneColourPixels(canvas:HTMLCanvasElement,ctx:CanvasRenderingContext2D){
 const gl=canvas.getContext('webgl2')!;const w=canvas.width,h=canvas.height;
 const bytes=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
 const flipped=new Uint8ClampedArray(bytes.length);for(let y=0;y<h;y++)flipped.set(bytes.subarray(y*w*4,(y+1)*w*4),(h-1-y)*w*4);
 ctx.putImageData(new ImageData(flipped,w,h,{colorSpace:canvas.dataset.previewColourSpace==='display-p3'?'display-p3':'srgb'}),0,0);
}

/** Display the resident scene directly. Never read a WebGL photo back into the
 * 2D collage per slider frame (especially expensive in WebKit). The three
 * immutable scenes describe the selected photo's contribution, including
 * holes, masks, translucent foregrounds and overlapping photos. */
export class PhotoSceneColour {
 readonly canvas=document.createElement('canvas');
 private gl:WebGL2RenderingContext|null=null;
 private program:WebGLProgram|null=null;
 private textures:WebGLTexture[]=[];
 private lut:WebGLTexture|null=null;
 private plainLut:WebGLTexture|null=null;
 private paired=false;
  private key='';private film:unknown;
  private worker:Worker|null=null;
  private workerFilm:unknown;
  private workerBusy=false;
  private pending:{fx:PhotoFx;key:string;film:any;generation:number}|null=null;
  private generation=0;
  private requestedKey='';
  private workerFailed=false;
  private latestFx:PhotoFx={};
  private lutCache=new Map<string,{tex:Uint8Array|Float32Array;plain?:Float32Array;film:unknown;master:boolean}>();
  private masterMode=false;
  private workerStarted=0;
  private colourSpace:{colorSpace:'srgb'|'display-p3';directUpload:boolean}={colorSpace:'srgb',directUpload:false};
 signature='';width=0;height=0;scale=0;
 constructor(){
  // Start decoding and compiling the worker when the scene is created, not on
  // the first slider input. Warm-up stays off the UI thread and is interruptible.
  if(typeof Worker!=='undefined'&&this.ensureWorker())this.worker!.postMessage({warm:photoFxParams({})});
  this.canvas.addEventListener('webglcontextlost',event=>{
   event.preventDefault();this.generation++;this.pending=null;this.requestedKey='';this.hide();
  });
  this.canvas.addEventListener('webglcontextrestored',()=>{
   // Restored contexts invalidate every GPU resource. Rebuild from the exact
   // scene on the next paint; never keep displaying a stale colour surface.
   this.gl=null;this.program=null;this.textures=[];this.lut=null;this.plainLut=null;this.paired=false;
   this.signature='';this.key='';this.film=undefined;this.masterMode=false;
  });
 }
 get ready(){return !!this.program&&!this.gl?.isContextLost();}
 prepare(main:HTMLCanvasElement,signature:string,scale:number,scenes:HTMLCanvasElement[]):boolean{
  this.hide();
  if(!this.gl){
   const gl=this.canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:false,antialias:false,preserveDrawingBuffer:true,depth:false,stencil:false});
   if(!gl)return false;this.gl=gl;
   this.colourSpace=configureWebglWide(gl);
   this.canvas.dataset.previewColourSpace=this.colourSpace.colorSpace;
   const shader=(type:number,text:string)=>{const s=gl.createShader(type)!;gl.shaderSource(s,text);gl.compileShader(s);return gl.getShaderParameter(s,gl.COMPILE_STATUS)?s:null;};
   const v=shader(gl.VERTEX_SHADER,vert),f=shader(gl.FRAGMENT_SHADER,frag);if(!v||!f)return false;
   const p=gl.createProgram()!;gl.attachShader(p,v);gl.attachShader(p,f);gl.bindAttribLocation(p,0,'p');gl.linkProgram(p);
   if(!gl.getProgramParameter(p,gl.LINK_STATUS))return false;this.program=p;gl.useProgram(p);
   const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
   gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
   for(let i=0;i<3;i++){const t=gl.createTexture()!;this.textures.push(t);gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.uniform1i(uniformLocation(gl,p,['originalScene','blackScene','whiteScene'][i]),i);}
   this.lut=gl.createTexture();gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_3D,this.lut);
   gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
   for(const direction of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_3D,direction,gl.CLAMP_TO_EDGE);
   gl.uniform1i(uniformLocation(gl,p,'colours'),3);
   gl.texImage3D(gl.TEXTURE_3D,0,gl.RGBA8,33,33,33,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
   this.plainLut=gl.createTexture();gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_3D,this.plainLut);
   gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
   for(const direction of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_3D,direction,gl.CLAMP_TO_EDGE);
   gl.texImage3D(gl.TEXTURE_3D,0,gl.RGBA32F,32,32,32,0,gl.RGBA,gl.FLOAT,null);
   gl.uniform1i(uniformLocation(gl,p,'plainColours'),4);
   this.canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;z-index:2;pointer-events:none;display:none';
   this.canvas.dataset.baseColourPresentation='1';
  }
  const gl=this.gl;if(!this.ready||main.width>gl.getParameter(gl.MAX_TEXTURE_SIZE)||main.height>gl.getParameter(gl.MAX_TEXTURE_SIZE))return false;
  this.canvas.width=main.width;this.canvas.height=main.height;
  for(let i=0;i<3;i++){gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,this.textures[i]);
   if(this.colourSpace.colorSpace==='display-p3'&&!this.colourSpace.directUpload){const data=scenes[i].getContext('2d')!.getImageData(0,0,scenes[i].width,scenes[i].height).data;gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,scenes[i].width,scenes[i].height,0,gl.RGBA,gl.UNSIGNED_BYTE,data);}
   else gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,scenes[i]);}
  this.signature=signature;this.width=main.width;this.height=main.height;this.scale=scale;this.key='';this.film=undefined;
  this.generation++;this.requestedKey='';this.pending=null;
  main.parentElement?.append(this.canvas);
  // Preflight the actual float master texture and tetrahedral shader, rather
  // than the old RGBA8 path (which left float allocation on the first drag).
  const identity=new Float32Array(32*32*32*4);
  for(let b=0;b<32;b++)for(let g=0;g<32;g++)for(let r=0;r<32;r++){const i=((b*32+g)*32+r)*4;identity.set([r/31,g/31,b/31,1],i);}
  gl.useProgram(this.program!);this.installLut(identity,true);
  gl.uniform1i(uniformLocation(gl,this.program!,'identity'),0);
  gl.uniform1i(uniformLocation(gl,this.program!,'wide'),this.colourSpace.colorSpace==='display-p3'?1:0);
  gl.viewport(0,0,this.width,this.height);gl.drawArrays(gl.TRIANGLES,0,3);
  gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));
  this.hide();return true;
 }
 draw(fx:PhotoFx,synchronous=false):boolean{
  if(!this.ready||!supportsSceneColour(fx))return false;
  const gl=this.gl!,p=this.program!,film=getLoadedLut(fx.lut),key=this.bakeKey(fx);
  this.latestFx=fx;
  if(!hasPhotoFx(fx)&&this.requestedKey){this.generation++;this.requestedKey='';this.pending=null;}
  gl.useProgram(p);
  gl.uniform1i(uniformLocation(gl,p,'wide'),this.colourSpace.colorSpace==='display-p3'?1:0);
  if(key!==this.key||film!==this.film){
   // Import-time worker preparation uses the identical floating-point master
   // pipeline. Only consume it for an otherwise unadjusted photo.
   if(fx.lut&&this.canPair(fx)&&key===this.bakeKey({lut:fx.lut,lutAmount:100})){
    const prepared=getPreparedFilterPair(fx.lut);
    if(prepared)this.lutCache.set(key,{...prepared,film,master:true});
   }
   const cached=this.lutCache.get(key);
   if(cached&&cached.film===film){
    this.generation++;this.pending=null;this.requestedKey='';
    gl.uniform1i(uniformLocation(gl,p,'identity'),0);this.installLut(cached.tex,cached.master,cached.plain);
    this.key=key;this.film=film;
   }else if(!synchronous&&!this.workerFailed&&hasPhotoFx(fx)&&typeof Worker!=='undefined'){
    if(key!==this.requestedKey||film!==this.film){this.requestedKey=key;this.pending={fx:{...fx},key,film,generation:this.generation};this.runWorker();}
   }else{
    const lut=bakePhotoFxLut(fx,33);
   gl.uniform1i(uniformLocation(gl,p,'identity'),lut?0:1);
   if(lut)this.installLut(lut.tex,false);
   this.key=key;this.film=film;}
  }
  this.setFilmWeight();gl.viewport(0,0,this.width,this.height);gl.drawArrays(gl.TRIANGLES,0,3);this.recordFrame();this.canvas.style.display='block';return true;
 }
 private canPair(fx:PhotoFx){return !!getLoadedLut(fx.lut)&&photoFxParams(fx).hsl.every(b=>!b.h&&!b.s&&!b.l);}
 private bakeKey(fx:PhotoFx){return this.canPair(fx)?'pair:'+colorKeyOf({...fx,lutAmount:100}):colorKeyOf(fx);}
 private setFilmWeight(){const gl=this.gl!;gl.uniform1f(uniformLocation(gl,this.program!,'filmWeight'),Math.pow((this.latestFx.lutAmount??100)/100,2));}
 private recordFrame(){
  const displayed=this.paired?this.key+'|amount:'+(this.latestFx.lutAmount??100):this.key;
  if(!import.meta.env.DEV||this.canvas.dataset.presentedColourKey===displayed)return;
  this.canvas.dataset.presentedColourKey=displayed;
  const times=JSON.parse(this.canvas.dataset.colourFrameTimes||'[]');times.push(performance.now());this.canvas.dataset.colourFrameTimes=JSON.stringify(times.slice(-100));
 }
 hide(){this.canvas.style.display='none';}
 private ensureWorker(){
  if(this.workerFailed)return false;
  if(!this.worker){
   try{
    this.worker=new Worker(new URL('./photoLut.worker.ts',import.meta.url),{type:'module'});
    this.workerFilm=undefined;
    this.worker.postMessage({dither:copyPixelDither()});
    this.worker.onmessage=e=>{
     if(e.data.warmReady)return;
     this.workerBusy=false;
     if(e.data.error){this.failWorker();return;}
     if(!e.data.error&&e.data.generation===this.generation&&e.data.key===this.bakeKey(this.latestFx)&&this.ready){
      const gl=this.gl!;gl.useProgram(this.program!);gl.uniform1i(uniformLocation(gl,this.program!,'identity'),0);
      this.installLut(e.data.tex,!!e.data.master,e.data.plain);this.setFilmWeight();
      this.key=e.data.key;this.film=this.workerFilm;
      this.lutCache.set(this.key,{tex:e.data.tex,plain:e.data.plain,film:this.film,master:!!e.data.master});
      while(this.lutCache.size>8)this.lutCache.delete(this.lutCache.keys().next().value!);
      gl.drawArrays(gl.TRIANGLES,0,3);this.recordFrame();
      if(import.meta.env.DEV){const jobs=JSON.parse(this.canvas.dataset.colourJobs||'[]');jobs.push({at:performance.now(),bake:e.data.bakeMs,total:performance.now()-this.workerStarted});this.canvas.dataset.colourJobs=JSON.stringify(jobs.slice(-100));}
     }
     this.runWorker();
    };
    this.worker.onerror=()=>this.failWorker();
   }catch{this.workerFailed=true;return false;}
  }
  return true;
 }
 private runWorker(){
  if(this.workerBusy||!this.pending)return;
  if(!this.ensureWorker()){this.draw(this.latestFx,true);return;}
  const job=this.pending;this.pending=null;this.workerBusy=true;
  this.workerStarted=performance.now();
  const filmChanged=job.film!==this.workerFilm;this.workerFilm=job.film;
  this.worker!.postMessage({id:job.key,key:job.key,generation:job.generation,params:photoFxParams(job.fx),paired:this.canPair(job.fx),filmChanged,filmData:filmChanged?job.film:undefined});
 }
 private failWorker(){this.worker?.terminate();this.worker=null;this.workerBusy=false;this.workerFailed=true;this.pending=null;this.requestedKey='';if(this.canvas.style.display!=='none')this.draw(this.latestFx,true);}
 private installLut(tex:Uint8Array|Float32Array,master:boolean,plain?:Float32Array){
  const gl=this.gl!,n=master?32:33,type=master?gl.FLOAT:gl.UNSIGNED_BYTE;
  gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_3D,this.lut);
  if(master!==this.masterMode)gl.texImage3D(gl.TEXTURE_3D,0,master?gl.RGBA32F:gl.RGBA8,n,n,n,0,gl.RGBA,type,tex);
  else gl.texSubImage3D(gl.TEXTURE_3D,0,0,0,0,n,n,n,gl.RGBA,type,tex);
  gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,master?gl.NEAREST:gl.LINEAR);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,master?gl.NEAREST:gl.LINEAR);
  this.masterMode=master;gl.uniform1i(uniformLocation(gl,this.program!,'masterMode'),master?1:0);
  this.paired=!!plain;gl.uniform1i(uniformLocation(gl,this.program!,'paired'),plain?1:0);
  if(plain){gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_3D,this.plainLut);gl.texSubImage3D(gl.TEXTURE_3D,0,0,0,0,32,32,32,gl.RGBA,gl.FLOAT,plain);}
 }
 dispose(){this.worker?.terminate();this.worker=null;this.pending=null;this.canvas.remove();this.gl?.getExtension('WEBGL_lose_context')?.loseContext();this.gl=null;this.program=null;this.signature='';}
}
