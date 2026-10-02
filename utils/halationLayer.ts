import {blurAlpha} from './alphaBoxBlur.js';
import {highlightHistogram,selectHighlights} from './highlightSelection';

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
  private maxTextureSize=0;
  private softSeed?: WebGLProgram;
  private softBlur?: WebGLProgram;
  private softTextures: WebGLTexture[]=[];
  private leak?:WebGLProgram;
  constructor(private presentation?:HTMLCanvasElement){this.canvas=presentation||document.createElement('canvas');}

  private init() {
    if (this.failed) return false;
    if (this.gl && this.program) return !this.gl.isContextLost();
    const gl = this.canvas.getContext('webgl', {premultipliedAlpha:false, preserveDrawingBuffer:true});
    if (!gl) {this.failed = true; return false;}
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
    for(const n of ['source','mask','color','amount','falloff','soft','premultiply'])this.uniforms[n]=gl.getUniformLocation(p,n);
    const makeProgram=(body:string)=>{
      const v=shader(gl.VERTEX_SHADER,'attribute vec2 p; varying vec2 uv; void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}');
      const f=shader(gl.FRAGMENT_SHADER,body);if(!v||!f)return null;
      const p=gl.createProgram()!;gl.attachShader(p,v);gl.attachShader(p,f);gl.bindAttribLocation(p,0,'p');gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);
      if(!gl.getProgramParameter(p,gl.LINK_STATUS)){gl.deleteProgram(p);return null;}return p;
    };
    this.softSeed=makeProgram(`precision highp float; varying vec2 uv; uniform sampler2D source; uniform float cutoff; uniform float tie;
      void main(){vec3 c=texture2D(source,uv).rgb;float bin=floor(dot(c,vec3(.299,.587,.114))*255.+.5);float a=bin>cutoff?1.:bin==cutoff?tie:0.;gl_FragColor=vec4(c,a);}`)||undefined;
    this.softBlur=makeProgram(`precision highp float; varying vec2 uv; uniform sampler2D source; uniform vec2 step; uniform float radius;
      void main(){vec4 sum=vec4(0.);for(int i=-60;i<=60;i++){if(abs(float(i))<=radius)sum+=texture2D(source,uv+float(i)*step);}gl_FragColor=floor(sum*255./(radius*2.+1.)+.5)/255.;}`)||undefined;
    if(!this.softSeed||!this.softBlur){this.failed=true;return false;}
    this.softTextures=[texture(),texture(),texture()];this.framebuffer=gl.createFramebuffer()!;
    this.leak=makeProgram(`precision highp float;varying vec2 uv;uniform sampler2D base;uniform vec2 size;uniform vec2 direction;uniform vec3 color;uniform float amount;
      void main(){vec3 b=texture2D(base,uv).rgb;vec2 pixel=(vec2(uv.x,1.-uv.y)-.5)*size;float a=clamp(dot(pixel,direction)/(max(size.x,size.y)*1.5),0.,1.)*amount;gl_FragColor=vec4(b+(1.-b)*color*a,1.);}`)||undefined;
    if(this.presentation){
      const f=shader(gl.FRAGMENT_SHADER,'precision highp float; varying vec2 uv; uniform sampler2D base; uniform sampler2D layer; uniform float strength; void main(){vec3 b=texture2D(base,uv).rgb;vec3 l=texture2D(layer,uv).rgb*strength;gl_FragColor=vec4(b+(1.-b)*l,1.);}');
      const v=shader(gl.VERTEX_SHADER,'attribute vec2 p; varying vec2 uv; void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}');
      if(!f||!v)return false;const c=gl.createProgram()!;gl.attachShader(c,v);gl.attachShader(c,f);gl.bindAttribLocation(c,0,'p');gl.linkProgram(c);gl.deleteShader(v);gl.deleteShader(f);
      if(!gl.getProgramParameter(c,gl.LINK_STATUS))return false;this.composite=c;this.baseTex=texture();this.layerTex=texture();
    }
    return true;
  }

  private begin(ctx:CanvasRenderingContext2D,w:number,h:number,mw:number,mh:number,key:string){
    const gl=this.gl!;gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.disable(gl.DITHER);
    if(this.presentation){
      if(this.canvas.width!==w)this.canvas.width=w;if(this.canvas.height!==h)this.canvas.height=h;
      if(this.presentKey!==key){
        gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.baseTex!);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,1);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,ctx.canvas);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,0);
        gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,this.layerTex!);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,mw,mh,0,gl.RGBA,gl.UNSIGNED_BYTE,null);this.presentKey=key;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer!);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.layerTex!,0);
    }else gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  }
  private finish(w:number,h:number,strength=1){
    const gl=this.gl!;
    if(this.presentation){
      gl.useProgram(this.composite!);gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.baseTex!);gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,this.layerTex!);
      gl.uniform1i(gl.getUniformLocation(this.composite!,'base'),2);gl.uniform1i(gl.getUniformLocation(this.composite!,'layer'),3);
      gl.uniform1f(gl.getUniformLocation(this.composite!,'strength'),strength>1?1:strength);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,w,h);gl.drawArrays(gl.TRIANGLES,0,3);
    }
    return this.canvas;
  }

  render(ctx:CanvasRenderingContext2D,w:number,h:number,key:string,p:any,color:number[]):HTMLCanvasElement|null {
    if(!this.init())return null;
    const gl=this.gl!,mw=Math.max(1,Math.floor(w*Math.min(1,800/Math.max(w,h)))),mh=Math.max(1,Math.floor(h*Math.min(1,800/Math.max(w,h))));
    if(this.presentation&&(w>this.maxTextureSize||h>this.maxTextureSize))return null;
    if(this.key!==key||this.sample.width!==mw||this.sample.height!==mh){
      this.sample.width=mw;this.sample.height=mh;if(!this.presentation){this.canvas.width=mw;this.canvas.height=mh;}
      const s=this.sample.getContext('2d',{willReadFrequently:true})!;s.drawImage(ctx.canvas,0,0,mw,mh);
      const pixels=s.getImageData(0,0,mw,mh),count=mw*mh;
      if(this.alpha.length!==count){this.alpha=new Uint8ClampedArray(count);this.blurred=new Uint8ClampedArray(count);this.scratch=new Uint8ClampedArray(count);}
      for(let j=0,i=0;j<count;j++,i+=4){const l=pixels.data[i]*.299+pixels.data[i+1]*.587+pixels.data[i+2]*.114;this.alpha[j]=l>160?Math.pow((l-160)/95,1.5)*255:0;}
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.sourceTex!);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,1);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.sample);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,0);
      this.key=key;this.radius=-1;
    }
    this.begin(ctx,w,h,mw,mh,key);
    const radius=Math.floor(Math.max(1,mw*.08*.8553125*p.fringeSize/100));
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.maskTex!);
    if(this.radius!==radius){
      blurAlpha(this.alpha,this.blurred,this.scratch,mw,mh,radius);
      // Typed array rows have to be flipped explicitly (UNPACK_FLIP only
      // applies to DOM sources). Reuse scratch after the last blur pass.
      for(let y=0;y<mh;y++)this.scratch.set(this.blurred.subarray(y*mw,(y+1)*mw),(mh-y-1)*mw);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.texImage2D(gl.TEXTURE_2D,0,gl.ALPHA,mw,mh,0,gl.ALPHA,gl.UNSIGNED_BYTE,this.scratch);
      this.radius=radius;
    }
    gl.useProgram(this.program!);gl.bindBuffer(gl.ARRAY_BUFFER,this.quad!);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.sourceTex!);
    gl.uniform1i(this.uniforms.source,0);gl.uniform1i(this.uniforms.mask,1);
    gl.uniform3f(this.uniforms.color,color[0],color[1],color[2]);gl.uniform1f(this.uniforms.amount,p.fringeIntensity/50*3);
    gl.uniform1f(this.uniforms.falloff,1+(100-p.fringeFeather)/100*4);
    gl.uniform1f(this.uniforms.soft,0);
    gl.viewport(0,0,mw,mh);gl.drawArrays(gl.TRIANGLES,0,3);
    return this.finish(w,h);
  }

  renderSoft(ctx:CanvasRenderingContext2D,w:number,h:number,key:string,p:any,color:number[]):HTMLCanvasElement|null {
    if(!this.init())return null;
    const gl=this.gl!,ratio=Math.min(1,800/Math.max(w,h)),mw=Math.max(1,Math.floor(w*ratio)),mh=Math.max(1,Math.floor(h*ratio)),count=mw*mh;
    if(this.presentation&&(w>this.maxTextureSize||h>this.maxTextureSize))return null;
    if(this.key!==key||this.sample.width!==mw||this.sample.height!==mh){
      this.sample.width=mw;this.sample.height=mh;if(!this.presentation){this.canvas.width=mw;this.canvas.height=mh;}
      const s=this.sample.getContext('2d',{willReadFrequently:true})!;s.drawImage(ctx.canvas,0,0,mw,mh);
      this.softSource=s.getImageData(0,0,mw,mh);this.softBins=highlightHistogram(this.softSource.data);
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
        gl.useProgram(program);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,input);gl.uniform1i(gl.getUniformLocation(program,'source'),0);
        gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer!);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);gl.drawArrays(gl.TRIANGLES,0,3);
      };
      if(this.softRange!==p.softThreshold){
        const selected=selectHighlights(this.softBins!,100-p.softThreshold);gl.useProgram(this.softSeed!);
        gl.uniform1f(gl.getUniformLocation(this.softSeed!,'cutoff'),selected.cutoff);gl.uniform1f(gl.getUniformLocation(this.softSeed!,'tie'),selected.tie);
        draw(this.softSeed!,this.sourceTex!,this.softTextures[0]);
      }
      if(radius>=1){
        for(let i=0;i<4;i++){
          gl.useProgram(this.softBlur!);gl.uniform1f(gl.getUniformLocation(this.softBlur!,'radius'),radius);
          gl.uniform2f(gl.getUniformLocation(this.softBlur!,'step'),i%2?0:1/mw,i%2?1/mh:0);
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
    const gl=this.gl!;this.begin(ctx,w,h,1,1,key);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,w,h);
    gl.useProgram(this.leak);gl.bindBuffer(gl.ARRAY_BUFFER,this.quad!);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.baseTex!);gl.uniform1i(gl.getUniformLocation(this.leak,'base'),2);
    const angle=(p.leakAngle-180)*Math.PI/180;gl.uniform2f(gl.getUniformLocation(this.leak,'size'),w,h);gl.uniform2f(gl.getUniformLocation(this.leak,'direction'),Math.cos(angle),Math.sin(angle));
    gl.uniform3f(gl.getUniformLocation(this.leak,'color'),color[0]/255,color[1]/255,color[2]/255);gl.uniform1f(gl.getUniformLocation(this.leak,'amount'),p.leakOpacity/100);
    gl.drawArrays(gl.TRIANGLES,0,3);return this.canvas;
  }

  dispose(){const gl=this.gl;if(gl){if(this.sourceTex)gl.deleteTexture(this.sourceTex);if(this.maskTex)gl.deleteTexture(this.maskTex);if(this.baseTex)gl.deleteTexture(this.baseTex);if(this.layerTex)gl.deleteTexture(this.layerTex);this.softTextures.forEach(t=>gl.deleteTexture(t));if(this.softSeed)gl.deleteProgram(this.softSeed);if(this.softBlur)gl.deleteProgram(this.softBlur);if(this.framebuffer)gl.deleteFramebuffer(this.framebuffer);if(this.composite)gl.deleteProgram(this.composite);if(this.quad)gl.deleteBuffer(this.quad);if(this.program)gl.deleteProgram(this.program);}
    if(gl&&this.leak)gl.deleteProgram(this.leak);this.canvas.width=this.sample.width=1;this.alpha=this.blurred=this.scratch=new Uint8ClampedArray(0);this.softSource=undefined;this.key='';}
}
