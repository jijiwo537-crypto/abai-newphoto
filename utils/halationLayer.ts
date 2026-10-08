import {blurAlpha} from './alphaBoxBlur.js';
import {highlightHistogram,selectHighlights} from './highlightSelection';
import {composeFxScene,disposeFxScene,type FxScene} from './glEffects';
import {uniformLocation} from './uniformLocation';

/** Persistent halation layer: identical 800px highlight kernel at rest and
 * during input. Radius changes only blur one byte/channel; hue and feather
 * change shader uniforms. Never shrink the photograph or defer to release. */
export class HalationLayer {
  private canvas: HTMLCanvasElement;
  private sample = document.createElement('canvas');
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private quad?: WebGLBuffer;
  private sourceTex?: WebGLTexture;
  private maskTex?: WebGLTexture;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private key = '';
  private radius = -1;
  private alpha = new Uint8ClampedArray(0);
  private blurred = new Uint8ClampedArray(0);
  private scratch = new Uint8ClampedArray(0);
  private failed = false;
  private softSource?: ImageData;
  private softBins?: Float64Array;
  private softRange = NaN;
  private softRadius = -1;
  private baseTex?: WebGLTexture;
  private layerTex?: WebGLTexture;
  private framebuffer?: WebGLFramebuffer;
  private composite?: WebGLProgram;
  private presentKey='';
  private layerSize='';
  private maxTextureSize=0;
  private softSeed?: WebGLProgram;
  private haloSeed?: WebGLProgram;
  private haloGpu=false;
  private haloMask?:WebGLTexture;
  private haloMaskKey='';
  private haloPhoto?:WebGLTexture;
  private haloPhotoKey='';
  private haloPhotoSize='';
  private softBlur?: WebGLProgram;
  private softTextures: WebGLTexture[]=[];
  private leak?:WebGLProgram;
  private simple?:WebGLProgram;
  private noiseTex?:WebGLTexture;
  private mixLayer=false;
  private scene?:FxScene;
  private sceneResult?:WebGLTexture;
  private sceneResultSize='';
  setScene(scene?:FxScene){this.scene=scene;}
  /* Context loss/restoration is tracked by events. gl.isProgram() is a
     synchronous query: the browser waits for the GPU to finish all queued
     work before answering, and this getter runs every frame. */
  private stale=false;
  private listening=false;
  get lost(){return !!this.gl&&(this.gl.isContextLost()||this.stale);}
  constructor(private presentation?:HTMLCanvasElement){this.canvas=presentation||document.createElement('canvas');}
  /** Compile once before interaction without changing any presented pixels. */
  warm(){return this.init();}

  private init() {
    if (this.failed) return false;
    if (this.gl && this.program) return !this.gl.isContextLost();
    const gl = this.canvas.getContext('webgl', {premultipliedAlpha:false, preserveDrawingBuffer:true});
    if (!gl) {this.failed = true; return false;}
    if(!this.listening){this.listening=true;const mark=()=>{this.stale=true;};this.canvas.addEventListener('webglcontextlost',mark);this.canvas.addEventListener('webglcontextrestored',mark);}
    const shader = (type:number, text:string) => {
      const s=gl.createShader(type)!;gl.shaderSource(s,text);gl.compileShader(s);
      if (!gl.getShaderParameter(s,gl.COMPILE_STATUS)) {gl.deleteShader(s);return null;} return s;
    };
    const vs=shader(gl.VERTEX_SHADER,'attribute vec2 p; varying vec2 uv; void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}');
    const fs=shader(gl.FRAGMENT_SHADER,`precision highp float;
      varying vec2 uv; uniform sampler2D source; uniform sampler2D mask;
      uniform vec3 color; uniform float amount; uniform float falloff; uniform float soft; uniform float premultiply;
      void main(){
        if(soft>.5){vec4 c=texture2D(source,uv);vec3 rgb=color.x<0.?c.rgb:color/255.;gl_FragColor=vec4(rgb*(premultiply>.5?c.a:1.),c.a);return;}
        float a=texture2D(mask,uv).a;
        float darkness=1.-dot(texture2D(source,uv).rgb,vec3(.299,.587,.114));
        float s=min(1.,a*pow(max(0.,darkness),falloff)*amount);
        gl_FragColor=a>.005&&s>.001 ? vec4(floor(color*s+.5)/255.,1.) : vec4(0.);
      }`);
    if(!vs||!fs){this.failed=true;return false;}
    const p=gl.createProgram()!;gl.attachShader(p,vs);gl.attachShader(p,fs);gl.bindAttribLocation(p,0,'p');gl.linkProgram(p);
    gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)){gl.deleteProgram(p);this.failed=true;return false;}
    this.gl=gl;this.program=p;this.quad=gl.createBuffer()!;
    this.maxTextureSize=gl.getParameter(gl.MAX_TEXTURE_SIZE);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    const texture=()=>{const t=gl.createTexture()!;gl.bindTexture(gl.TEXTURE_2D,t);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return t;};
    this.sourceTex=texture();this.maskTex=texture();
    for(const n of ['source','mask','color','amount','falloff','soft','premultiply'])this.uniforms[n]=uniformLocation(gl,p,n);
    const makeProgram=(body:string)=>{
      const v=shader(gl.VERTEX_SHADER,'attribute vec2 p; varying vec2 uv; void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}');
      const f=shader(gl.FRAGMENT_SHADER,body);if(!v||!f)return null;
      const p=gl.createProgram()!;gl.attachShader(p,v);gl.attachShader(p,f);gl.bindAttribLocation(p,0,'p');gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);
      if(!gl.getProgramParameter(p,gl.LINK_STATUS)){gl.deleteProgram(p);return null;}return p;
    };
    this.softSeed=makeProgram(`precision highp float; varying vec2 uv; uniform sampler2D source; uniform float cutoff; uniform float tie;
      void main(){vec3 c=texture2D(source,uv).rgb;float bin=floor(dot(c,vec3(.299,.587,.114))*255.+.5);float a=bin>cutoff?1.:bin==cutoff?tie:0.;gl_FragColor=vec4(c,a);}`)||undefined;
    this.haloSeed=makeProgram(`precision highp float; varying vec2 uv; uniform sampler2D source;
      void main(){float l=dot(texture2D(source,uv).rgb,vec3(.299,.587,.114));float a=pow(max(0.,(l-160./255.)/(95./255.)),1.5);gl_FragColor=vec4(0.,0.,0.,floor(a*255.+.5)/255.);}`)||undefined;
    this.softBlur=makeProgram(`precision highp float; varying vec2 uv; uniform sampler2D source; uniform vec2 step; uniform float radius;
      void main(){vec4 sum=vec4(0.);for(int i=-60;i<=60;i++){if(abs(float(i))<=radius)sum+=texture2D(source,uv+float(i)*step);}gl_FragColor=floor(sum*255./(radius*2.+1.)+.5)/255.;}`)||undefined;
    if(!this.softSeed||!this.softBlur||!this.haloSeed){this.failed=true;return false;}
    this.softTextures=[texture(),texture(),texture()];this.framebuffer=gl.createFramebuffer()!;
    this.leak=makeProgram(`precision highp float;varying vec2 uv;uniform sampler2D base;uniform vec2 size;uniform vec2 direction;uniform vec3 color;uniform float amount;
      void main(){vec3 b=texture2D(base,uv).rgb;vec2 pixel=(vec2(uv.x,1.-uv.y)-.5)*size;float a=clamp(dot(pixel,direction)/(max(size.x,size.y)*1.5),0.,1.)*amount;gl_FragColor=vec4(b+(1.-b)*color*a,1.);}`)||undefined;
    if(this.presentation){
      const f=shader(gl.FRAGMENT_SHADER,'precision highp float; varying vec2 uv; uniform sampler2D base; uniform sampler2D layer; uniform float strength; uniform float mixLayer; void main(){vec3 b=texture2D(base,uv).rgb;vec3 l=texture2D(layer,uv).rgb;gl_FragColor=vec4(mixLayer>.5?mix(b,l,strength):b+(1.-b)*l*strength,1.);}');
      const v=shader(gl.VERTEX_SHADER,'attribute vec2 p; varying vec2 uv; void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}');
      if(!f||!v)return false;const c=gl.createProgram()!;gl.attachShader(c,v);gl.attachShader(c,f);gl.bindAttribLocation(c,0,'p');gl.linkProgram(c);gl.deleteShader(v);gl.deleteShader(f);
      if(!gl.getProgramParameter(c,gl.LINK_STATUS))return false;this.composite=c;this.baseTex=texture();this.layerTex=texture();
    }
    this.simple=makeProgram(`precision highp float;varying vec2 uv;uniform sampler2D base;uniform sampler2D noise;uniform vec2 size;uniform float vignette;uniform float grain;
      void main(){vec3 b=texture2D(base,uv).rgb;vec2 pixel=vec2(uv.x,1.-uv.y)*size;
      vec3 n=texture2D(noise,fract(pixel/(max(size.x,size.y)/1080.*512.))).rgb;
      vec3 overlay=mix(2.*b*n,1.-2.*(1.-b)*(1.-n),step(vec3(.5),b));b=mix(b,overlay,grain*.63);
      float radial=clamp((length(pixel-size*.5)-size.x/3.)/(max(size.x,size.y)-size.x/3.),0.,1.);
      b*=1.-radial*min(1.,vignette*.8);gl_FragColor=vec4(b,1.);}`)||undefined;
    return true;
  }

  private begin(ctx:CanvasRenderingContext2D,w:number,h:number,mw:number,mh:number,key:string){
    const gl=this.gl!;gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.disable(gl.DITHER);
    // The optical kind changes the layer, not the underlying photograph.
    // Re-uploading that same multi-megapixel canvas on soft/halo/leak switches
    // forces WebKit to synchronize its 2D and GPU queues unnecessarily.
    const sourceKey=key.replace(/\|(soft|halo|leak|blur|simple)$/,'');
    if(this.presentation){
      const ow=this.scene?.black.width||w,oh=this.scene?.black.height||h;
      if(this.canvas.width!==ow)this.canvas.width=ow;if(this.canvas.height!==oh)this.canvas.height=oh;
      if(this.presentKey!==sourceKey){
        gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.baseTex!);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,1);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.src(ctx));gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,0);
        this.presentKey=sourceKey;
      }
      if(this.layerSize!==`${mw}x${mh}`){
        gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,this.layerTex!);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,mw,mh,0,gl.RGBA,gl.UNSIGNED_BYTE,null);this.layerSize=`${mw}x${mh}`;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer!);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.layerTex!,0);
    }else gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  }
  private resultTarget(w:number,h:number){
    const gl=this.gl!;
    if(!this.scene){gl.bindFramebuffer(gl.FRAMEBUFFER,null);return;}
    this.sceneResult ||=gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,this.sceneResult);
    if(this.sceneResultSize!==`${w}x${h}`){gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);this.sceneResultSize=`${w}x${h}`;
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);}
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer!);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.sceneResult,0);
  }
  private finish(w:number,h:number,strength=1){
    const gl=this.gl!;
    if(this.presentation){
      gl.useProgram(this.composite!);gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.baseTex!);gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,this.layerTex!);
      gl.uniform1i(uniformLocation(gl,this.composite!,'base'),2);gl.uniform1i(uniformLocation(gl,this.composite!,'layer'),3);
      gl.uniform1f(uniformLocation(gl,this.composite!,'strength'),strength>1?1:strength);
      gl.uniform1f(uniformLocation(gl,this.composite!,'mixLayer'),this.mixLayer?1:0);
      this.resultTarget(w,h);gl.viewport(0,0,w,h);gl.drawArrays(gl.TRIANGLES,0,3);
      if(this.scene)composeFxScene(gl,this.sceneResult!,this.scene);
    }
    return this.canvas;
  }

  render(ctx:CanvasRenderingContext2D,w:number,h:number,key:string,p:any,color:number[]):HTMLCanvasElement|null {
    const timings:Record<string,number>={};let mark=import.meta.env.DEV?performance.now():0;const phase=(name:string)=>{if(!import.meta.env.DEV)return;const now=performance.now();timings[name]=now-mark;mark=now;};
    this.mixLayer=false;
    if(!this.init())return null;
    phase('init');
    const gl=this.gl!,mw=Math.max(1,Math.floor(w*Math.min(1,800/Math.max(w,h)))),mh=Math.max(1,Math.floor(h*Math.min(1,800/Math.max(w,h))));
    const gpu=!!this.presentation,cachePhoto=gpu&&!!this.scene;
    const photoKey=`${key}|${w}x${h}|${JSON.stringify([p.fringeIntensity,p.fringeSize,p.fringeFeather,color])}`;
    if(cachePhoto&&this.haloPhoto&&this.haloPhotoKey===photoKey){
      const ow=this.scene!.black.width,oh=this.scene!.black.height;
      if(this.canvas.width!==ow)this.canvas.width=ow;if(this.canvas.height!==oh)this.canvas.height=oh;
      composeFxScene(gl,this.haloPhoto,this.scene!);
      if(import.meta.env.DEV)this.canvas.dataset.haloPhases=JSON.stringify({cachedPhoto:true});
      return this.canvas;
    }
    timings.reusedSample=Number(this.haloGpu&&this.key.replace(/\|(soft|halo|leak|blur|simple)$/,'')===key.replace(/\|(soft|halo|leak|blur|simple)$/,''));
    timings.reusedBase=Number(this.presentKey===key.replace(/\|(soft|halo|leak|blur|simple)$/,''));
    timings.outputChanged=Number(this.canvas.width!==(this.scene?.black.width||w)||this.canvas.height!==(this.scene?.black.height||h));
    if(gpu&&this.haloGpu&&this.key.replace(/\|(soft|halo|leak|blur|simple)$/,'')===key.replace(/\|(soft|halo|leak|blur|simple)$/,''))this.key=key;
    if(this.presentation&&(w>this.maxTextureSize||h>this.maxTextureSize))return null;
    if(this.key!==key||this.haloGpu!==gpu||this.sample.width!==mw||this.sample.height!==mh){
      this.sample.width=mw;this.sample.height=mh;if(!this.presentation){this.canvas.width=mw;this.canvas.height=mh;}
      const s=this.sample.getContext('2d',{willReadFrequently:true})!;s.drawImage(this.src(ctx),0,0,mw,mh);
      if(!gpu){
        const pixels=s.getImageData(0,0,mw,mh),count=mw*mh;
        if(this.alpha.length!==count){this.alpha=new Uint8ClampedArray(count);this.blurred=new Uint8ClampedArray(count);this.scratch=new Uint8ClampedArray(count);}
        for(let j=0,i=0;j<count;j++,i+=4){const l=pixels.data[i]*.299+pixels.data[i+1]*.587+pixels.data[i+2]*.114;this.alpha[j]=l>160?Math.pow((l-160)/95,1.5)*255:0;}
      }
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.sourceTex!);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,1);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.sample);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,0);
      if(gpu)for(const t of this.softTextures){gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,mw,mh,0,gl.RGBA,gl.UNSIGNED_BYTE,null);}
      this.haloGpu=gpu;this.key=key;this.radius=-1;
    }
    this.begin(ctx,w,h,mw,mh,key);
    phase('source');
    const radius=Math.floor(Math.max(1,mw*.08*.8553125*p.fringeSize/100));
    const haloMaskKey=`${key}|${mw}x${mh}|${radius}`;
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.maskTex!);
    if(gpu&&this.haloMaskKey!==haloMaskKey){
      // Same 800px mask and four rounded box passes as the CPU path. Keep it
      // resident on the GPU instead of stalling to read pixels into JavaScript.
      gl.bindBuffer(gl.ARRAY_BUFFER,this.quad!);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);gl.viewport(0,0,mw,mh);
      const draw=(program:WebGLProgram,input:WebGLTexture,target:WebGLTexture)=>{
        gl.useProgram(program);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,input);gl.uniform1i(uniformLocation(gl,program,'source'),0);
        gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer!);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);gl.drawArrays(gl.TRIANGLES,0,3);
      };
      draw(this.haloSeed!,this.sourceTex!,this.softTextures[0]);
      this.haloMask ||=gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D,this.haloMask);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,mw,mh,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      gl.useProgram(this.softBlur!);gl.uniform1f(uniformLocation(gl,this.softBlur!,'radius'),radius);
      for(let pass=0;pass<4;pass++){
        gl.uniform2f(uniformLocation(gl,this.softBlur!,'step'),pass%2===0?1/mw:0,pass%2===0?0:1/mh);
        draw(this.softBlur!,this.softTextures[pass===0?0:pass%2===1?1:2],pass===3?this.haloMask:this.softTextures[pass%2===0?1:2]);
      }
      this.haloMaskKey=haloMaskKey;this.radius=radius;this.begin(ctx,w,h,mw,mh,key);
    }else if(!gpu&&this.radius!==radius){
      blurAlpha(this.alpha,this.blurred,this.scratch,mw,mh,radius);
      // Typed array rows have to be flipped explicitly (UNPACK_FLIP only
      // applies to DOM sources). Reuse scratch after the last blur pass.
      for(let y=0;y<mh;y++)this.scratch.set(this.blurred.subarray(y*mw,(y+1)*mw),(mh-y-1)*mw);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.texImage2D(gl.TEXTURE_2D,0,gl.ALPHA,mw,mh,0,gl.ALPHA,gl.UNSIGNED_BYTE,this.scratch);
      this.radius=radius;
    }
    gl.useProgram(this.program!);gl.bindBuffer(gl.ARRAY_BUFFER,this.quad!);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    phase('mask');
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,gpu?this.haloMask!:this.maskTex!);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.sourceTex!);
    gl.uniform1i(this.uniforms.source,0);gl.uniform1i(this.uniforms.mask,1);
    gl.uniform3f(this.uniforms.color,color[0],color[1],color[2]);gl.uniform1f(this.uniforms.amount,p.fringeIntensity/50*3);
    gl.uniform1f(this.uniforms.falloff,1+(100-p.fringeFeather)/100*4);
    gl.uniform1f(this.uniforms.soft,0);
    gl.viewport(0,0,mw,mh);gl.drawArrays(gl.TRIANGLES,0,3);
    // Keep one halo photograph, not a full collage or a result for every
    // photo. Other optical families may reuse sceneResult without overwriting
    // this result. Geometry changes then only recompose unchanged pixels.
    const otherResult=this.sceneResult,otherSize=this.sceneResultSize;
    if(cachePhoto){this.sceneResult=this.haloPhoto;this.sceneResultSize=this.haloPhotoSize;}
    let result:HTMLCanvasElement;
    try{result=this.finish(w,h);if(cachePhoto){this.haloPhoto=this.sceneResult;this.haloPhotoSize=this.sceneResultSize;this.haloPhotoKey=photoKey;}}
    finally{if(cachePhoto){this.sceneResult=otherResult;this.sceneResultSize=otherSize;}}
    phase('present');if(import.meta.env.DEV)this.canvas.dataset.haloPhases=JSON.stringify(timings);return result!;
  }

  private histSample:HTMLCanvasElement|null=null;
  /** When set, the photo is read from this canvas (e.g. the colour GPU's own
   *  canvas during a drag) instead of the 2D canvas passed in as ctx. */
  sourceOverride:HTMLCanvasElement|null=null;
  private src(ctx:CanvasRenderingContext2D){return this.sourceOverride||ctx.canvas;}
  /** bins: luminance histogram of the colour-processed photo, supplied by the
   *  caller from data it already has (no canvas readback here). */
  renderSoft(ctx:CanvasRenderingContext2D,w:number,h:number,key:string,p:any,color:number[],bins?:Float64Array|null):HTMLCanvasElement|null {
    this.mixLayer=false;
    if(!this.init())return null;
    const gl=this.gl!,ratio=Math.min(1,800/Math.max(w,h)),mw=Math.max(1,Math.floor(w*ratio)),mh=Math.max(1,Math.floor(h*ratio)),count=mw*mh;
    if(this.presentation&&(w>this.maxTextureSize||h>this.maxTextureSize))return null;
    if(this.key!==key||this.sample.width!==mw||this.sample.height!==mh){
      this.sample.width=mw;this.sample.height=mh;if(!this.presentation){this.canvas.width=mw;this.canvas.height=mh;}
      const s=this.sample.getContext('2d')!;s.drawImage(this.src(ctx),0,0,mw,mh);
      /* The highlight threshold is a percentile of the photo's luminance. It
         used to read the whole 800px sample back from the GPU on every colour
         change (a synchronous readback that stalled each slider step). A
         128px copy gives the same percentile to well within one level; it is
         used always, so a drag and its release select the same highlights. */
      if(bins)this.softBins=bins;
      else{
        const hk=Math.min(1,128/Math.max(mw,mh)),hw=Math.max(1,Math.round(mw*hk)),hh=Math.max(1,Math.round(mh*hk));
        const hc=(this.histSample ||=document.createElement('canvas'));if(hc.width!==hw)hc.width=hw;if(hc.height!==hh)hc.height=hh;
        const hx=hc.getContext('2d',{willReadFrequently:true})!;hx.imageSmoothingQuality='high';hx.drawImage(this.src(ctx),0,0,hw,hh);
        this.softBins=highlightHistogram(hx.getImageData(0,0,hw,hh).data);
      }
      if(this.alpha.length!==count){this.alpha=new Uint8ClampedArray(count);this.blurred=new Uint8ClampedArray(count);this.scratch=new Uint8ClampedArray(count);}
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.sourceTex!);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,1);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.sample);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,0);
      for(const t of this.softTextures){gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,mw,mh,0,gl.RGBA,gl.UNSIGNED_BYTE,null);}
      this.key=key;this.softRadius=-1;this.softRange=NaN;
    }
    this.begin(ctx,w,h,mw,mh,key);
    const radius=Math.floor(p.softRadius/100*80*Math.max(w,h)/1080*ratio),changedRadius=this.softRadius!==radius;
    gl.bindBuffer(gl.ARRAY_BUFFER,this.quad!);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);gl.viewport(0,0,mw,mh);
    if(changedRadius||this.softRange!==p.softThreshold){
      const draw=(program:WebGLProgram,input:WebGLTexture,target:WebGLTexture)=>{
        gl.useProgram(program);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,input);gl.uniform1i(uniformLocation(gl,program,'source'),0);
        gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer!);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);gl.drawArrays(gl.TRIANGLES,0,3);
      };
      if(this.softRange!==p.softThreshold){
        const selected=selectHighlights(this.softBins!,100-p.softThreshold);gl.useProgram(this.softSeed!);
        gl.uniform1f(uniformLocation(gl,this.softSeed!,'cutoff'),selected.cutoff);gl.uniform1f(uniformLocation(gl,this.softSeed!,'tie'),selected.tie);
        draw(this.softSeed!,this.sourceTex!,this.softTextures[0]);
      }
      if(radius>=1){
        for(let i=0;i<4;i++){
          gl.useProgram(this.softBlur!);gl.uniform1f(uniformLocation(gl,this.softBlur!,'radius'),radius);
          gl.uniform2f(uniformLocation(gl,this.softBlur!,'step'),i%2?0:1/mw,i%2?1/mh:0);
          draw(this.softBlur!,i===0?this.softTextures[0]:this.softTextures[i%2?1:2],this.softTextures[i%2?2:1]);
        }
      }
      this.softRange=p.softThreshold;this.softRadius=radius;
    }
    // Restore the final layer target after the four exact box passes.
    this.begin(ctx,w,h,mw,mh,key);
    gl.useProgram(this.program!);gl.bindBuffer(gl.ARRAY_BUFFER,this.quad!);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.softTextures[radius>=1?2:0]);gl.uniform1i(this.uniforms.source,0);
    gl.uniform1f(this.uniforms.soft,1);gl.uniform3f(this.uniforms.color,p.softColor>0?color[0]:-1,color[1],color[2]);
    gl.uniform1f(this.uniforms.premultiply,this.presentation?1:0);
    gl.viewport(0,0,mw,mh);gl.drawArrays(gl.TRIANGLES,0,3);return this.finish(w,h,p.soft/100*(p.softColor>0?3:1.5));
  }

  renderLeak(ctx:CanvasRenderingContext2D,w:number,h:number,key:string,p:any,color:number[]):HTMLCanvasElement|null {
    if(!this.presentation||!this.init()||!this.leak||w>this.maxTextureSize||h>this.maxTextureSize)return null;
    const gl=this.gl!;this.begin(ctx,w,h,1,1,key);this.resultTarget(w,h);gl.viewport(0,0,w,h);
    gl.useProgram(this.leak);gl.bindBuffer(gl.ARRAY_BUFFER,this.quad!);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.baseTex!);gl.uniform1i(uniformLocation(gl,this.leak,'base'),2);
    const angle=(p.leakAngle-180)*Math.PI/180;gl.uniform2f(uniformLocation(gl,this.leak,'size'),w,h);gl.uniform2f(uniformLocation(gl,this.leak,'direction'),Math.cos(angle),Math.sin(angle));
    gl.uniform3f(uniformLocation(gl,this.leak,'color'),color[0]/255,color[1]/255,color[2]/255);gl.uniform1f(uniformLocation(gl,this.leak,'amount'),p.leakOpacity/100);
    gl.drawArrays(gl.TRIANGLES,0,3);if(this.scene)composeFxScene(gl,this.sceneResult!,this.scene);return this.canvas;
  }

  renderBlur(ctx:CanvasRenderingContext2D,w:number,h:number,key:string,amount:number):HTMLCanvasElement|null{
    if(!this.init()||!this.presentation)return null;
    const gl=this.gl!,ratio=Math.min(1,800/Math.max(w,h)),mw=Math.max(1,Math.floor(w*ratio)),mh=Math.max(1,Math.floor(h*ratio));
    if(this.key!==key){
      this.sample.width=mw;this.sample.height=mh;this.sample.getContext('2d')!.drawImage(this.src(ctx),0,0,mw,mh);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.sourceTex!);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,1);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.sample);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,0);
      for(const tex of this.softTextures){gl.bindTexture(gl.TEXTURE_2D,tex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,mw,mh,0,gl.RGBA,gl.UNSIGNED_BYTE,null);}this.key=key;
    }
    this.begin(ctx,w,h,mw,mh,key);const radius=Math.floor(amount/6*(Math.max(w,h)/1080)*ratio*1.5);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.quad!);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);gl.viewport(0,0,mw,mh);
    let source=this.sourceTex!;
    for(let i=0;i<4;i++){const target=i===3?this.layerTex!:this.softTextures[i%2];gl.useProgram(this.softBlur!);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,source);gl.uniform1i(uniformLocation(gl,this.softBlur!,'source'),0);gl.uniform1f(uniformLocation(gl,this.softBlur!,'radius'),radius);gl.uniform2f(uniformLocation(gl,this.softBlur!,'step'),i%2?0:1/mw,i%2?1/mh:0);
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer!);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);gl.drawArrays(gl.TRIANGLES,0,3);source=target;
    }
    this.mixLayer=true;return this.finish(w,h,amount/240*1.5);
  }
  renderSimple(ctx:CanvasRenderingContext2D,w:number,h:number,key:string,p:any,noise:HTMLCanvasElement):HTMLCanvasElement|null{
    if(!this.init()||!this.presentation||!this.simple)return null;const gl=this.gl!;
    this.begin(ctx,w,h,1,1,key);this.resultTarget(w,h);
    if(!this.noiseTex){this.noiseTex=gl.createTexture()!;gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,this.noiseTex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,noise);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);}
    gl.useProgram(this.simple);gl.bindBuffer(gl.ARRAY_BUFFER,this.quad!);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.baseTex!);gl.uniform1i(uniformLocation(gl,this.simple,'base'),2);gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,this.noiseTex);gl.uniform1i(uniformLocation(gl,this.simple,'noise'),5);
    gl.uniform2f(uniformLocation(gl,this.simple,'size'),w,h);gl.uniform1f(uniformLocation(gl,this.simple,'vignette'),(p.vignette||0)/100);gl.uniform1f(uniformLocation(gl,this.simple,'grain'),(p.colorNoise||0)/100);
    gl.viewport(0,0,w,h);gl.drawArrays(gl.TRIANGLES,0,3);if(this.scene)composeFxScene(gl,this.sceneResult!,this.scene);return this.canvas;
  }

  dispose(){const gl=this.gl;if(gl){if(this.sourceTex)gl.deleteTexture(this.sourceTex);if(this.maskTex)gl.deleteTexture(this.maskTex);if(this.baseTex)gl.deleteTexture(this.baseTex);if(this.layerTex)gl.deleteTexture(this.layerTex);this.softTextures.forEach(t=>gl.deleteTexture(t));if(this.softSeed)gl.deleteProgram(this.softSeed);if(this.softBlur)gl.deleteProgram(this.softBlur);if(this.framebuffer)gl.deleteFramebuffer(this.framebuffer);if(this.composite)gl.deleteProgram(this.composite);if(this.quad)gl.deleteBuffer(this.quad);if(this.program)gl.deleteProgram(this.program);}
    if(gl){disposeFxScene(gl);if(this.haloPhoto)gl.deleteTexture(this.haloPhoto);if(this.haloMask)gl.deleteTexture(this.haloMask);if(this.haloSeed)gl.deleteProgram(this.haloSeed);if(this.sceneResult)gl.deleteTexture(this.sceneResult);if(this.noiseTex)gl.deleteTexture(this.noiseTex);if(this.simple)gl.deleteProgram(this.simple);}if(gl&&this.leak)gl.deleteProgram(this.leak);gl?.getExtension('WEBGL_lose_context')?.loseContext();this.canvas.width=this.canvas.height=this.sample.width=this.sample.height=1;this.alpha=this.blurred=this.scratch=new Uint8ClampedArray(0);this.softSource=undefined;this.key='';this.haloMaskKey='';this.haloPhotoKey='';}
}
