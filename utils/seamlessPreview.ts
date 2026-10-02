import { seamGeometry, seamImageTransform, type SeamPhoto, type SeamRect } from './seamlessLayout';
import { configureWebglWide, get2dWide } from './colorSpace';
export type SeamTexture = { image: CanvasImageSource; width: number; height: number } | null;
export type SeamView = { width:number;height:number;xx:number;xy:number;x0:number;yx:number;yy:number;y0:number };

/** Original-size source textures + physical-pixel viewport rendering. Fusion
 * changes uniforms only; dragging and resting use the identical quality path. */
class SeamGpu {
  private canvas:HTMLCanvasElement|OffscreenCanvas;
  private transferred:boolean;
  private gl:WebGL2RenderingContext;
  private color:{colorSpace:'srgb'|'display-p3';directUpload:boolean};
  private programs=new Map<number,WebGLProgram>();
  private textures=new Map<CanvasImageSource,WebGLTexture>();
  private textureBytes=new Map<CanvasImageSource,number>();
  private blank=document.createElement('canvas');
  private invalid=false;
  private uploads=0;
  private buffer:WebGLBuffer|null=null;
  constructor(canvas:HTMLCanvasElement,direct=false){
    const webkit=/AppleWebKit/.test(navigator.userAgent)&&(!/Chrome\//.test(navigator.userAgent)||/iPhone|iPad|iPod/.test(navigator.userAgent));
    this.transferred=!direct&&!webkit&&typeof OffscreenCanvas!=='undefined'&&!!canvas.getContext('bitmaprenderer');
    this.canvas=this.transferred?new OffscreenCanvas(canvas.width,canvas.height):canvas;
    const gl=this.canvas.getContext('webgl2',{alpha:false,antialias:false,premultipliedAlpha:false,preserveDrawingBuffer:true}) as WebGL2RenderingContext|null;
    if(!gl)throw new Error('無縫拼圖 GPU 無法啟動');this.gl=gl;this.color=configureWebglWide(gl);
    this.canvas.addEventListener('webglcontextlost',e=>{this.invalid=true;e.preventDefault();if(this.transferred)canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true}));},{once:true});
    if(this.transferred)this.canvas.addEventListener('webglcontextrestored',()=>canvas.dispatchEvent(new Event('webglcontextrestored')),{once:true});
    this.blank.width=this.blank.height=1;const empty=this.blank.getContext('2d')!;empty.fillStyle='#121212';empty.fillRect(0,0,1,1);
    this.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  }
  dispose(){const gl=this.gl;for(const t of this.textures.values())gl.deleteTexture(t);for(const p of this.programs.values())gl.deleteProgram(p);gl.deleteBuffer(this.buffer);this.textures.clear();this.programs.clear();if(!gl.isContextLost())gl.getExtension('WEBGL_lose_context')?.loseContext();}
  get lost(){return this.invalid||this.gl.isContextLost();}
  copyPixels(ctx:CanvasRenderingContext2D,x:number,y:number){
    const gl=this.gl,w=this.canvas.width,h=this.canvas.height;
    const raw=new Uint8Array(w*h*4),pixels=new Uint8ClampedArray(raw.length);
    gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,raw);
    for(let row=0;row<h;row++)pixels.set(raw.subarray((h-1-row)*w*4,(h-row)*w*4),row*w*4);
    ctx.putImageData(new ImageData(pixels,w,h,{colorSpace:this.color.colorSpace}),x,y);
  }
  private program(count:number){
    const gl=this.gl;let p=this.programs.get(count);if(p)return p;
    const shader=(type:number,source:string)=>{const s=gl.createShader(type)!;gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s)||'Shader');return s;};
    const vs=shader(gl.VERTEX_SHADER,`#version 300 es
      in vec2 position;out vec2 uv;void main(){uv=vec2((position.x+1.)*.5,(1.-position.y)*.5);gl_Position=vec4(position,0.,1.);}`);
    const uniforms=Array.from({length:count},(_,i)=>`uniform sampler2D photo${i};uniform vec4 box${i};uniform vec4 edges${i};uniform vec4 crop${i};uniform vec4 source${i};uniform float opacity${i};`).join('\n');
    const layers=Array.from({length:count},(_,i)=>`{
      vec4 b=box${i},e=edges${i},c=crop${i},s=source${i};
      if(p.x>=b.x&&p.y>=b.y&&p.x<=b.x+b.z&&p.y<=b.y+b.w){
        float wx=(e.x>0.?smoothstep(b.x,b.x+2.*e.x,p.x):1.)*(e.z>0.?1.-smoothstep(b.x+b.z-2.*e.z,b.x+b.z,p.x):1.);
        float wy=(e.y>0.?smoothstep(b.y,b.y+2.*e.y,p.y):1.)*(e.w>0.?1.-smoothstep(b.y+b.w-2.*e.w,b.y+b.w,p.y):1.);
        vec2 d=p-(b.xy+b.zw*.5);d=vec2(d.x*s.z+d.y*s.w,-d.x*s.w+d.y*s.z)-c.xy;
        vec4 tex=texture(photo${i},d/(s.xy*c.z)+.5);
        float a=tex.a*opacity${i};vec3 rgb=tex.rgb*opacity${i}+vec3(18./255.)*(1.-a);
        float weight=wx*wy;sum+=rgb*weight;coverage+=weight;
      }
    }`).join('\n');
    const fs=shader(gl.FRAGMENT_SHADER,`#version 300 es
      precision highp float;in vec2 uv;out vec4 color;uniform vec2 size;uniform vec3 viewX;uniform vec3 viewY;
      ${uniforms}
      void main(){vec2 p=clamp(vec2(dot(uv,viewX.xy)+viewX.z,dot(uv,viewY.xy)+viewY.z),vec2(.00001),size-vec2(.00001));vec3 sum=vec3(0.);float coverage=0.;${layers}
        color=vec4(sum/max(.000001,min(1.,coverage)),1.);}`);
    p=gl.createProgram()!;gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p)||'Program');
    this.programs.set(count,p);return p;
  }
  draw(target:HTMLCanvasElement,cells:SeamPhoto[],rects:SeamRect[],sources:SeamTexture[],amount:number,view:SeamView){
    const gl=this.gl,w=view.width,h=view.height,count=rects.length;
    const active=new Set(sources.map(s=>s?.image||this.blank));
    const incoming=sources.reduce((n,s)=>n+(s&&!this.textures.has(s.image)?s.width*s.height*4*4/3:0),0);
    let resident=Array.from(this.textureBytes.values()).reduce((a,b)=>a+b,0);
    // Evict only inactive source textures. Keep every current photo at original
    // quality, even when a large layout itself needs more than the cache budget.
    for(const [image,tex] of this.textures){
      if(resident+incoming<=128*1024*1024&&this.textures.size<=24)break;
      if(active.has(image))continue;
      resident-=this.textureBytes.get(image)||0;gl.deleteTexture(tex);this.textures.delete(image);this.textureBytes.delete(image);
    }
    if(count>gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS))throw new Error('佈局相片數超過 GPU 上限');
    if(this.canvas.width!==target.width)this.canvas.width=target.width;if(this.canvas.height!==target.height)this.canvas.height=target.height;
    gl.viewport(0,0,target.width,target.height);const p=this.program(count);gl.useProgram(p);
    const loc=gl.getAttribLocation(p,'position');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
    gl.uniform2f(gl.getUniformLocation(p,'size'),w,h);
    gl.uniform3f(gl.getUniformLocation(p,'viewX'),view.xx,view.xy,view.x0);gl.uniform3f(gl.getUniformLocation(p,'viewY'),view.yx,view.yy,view.y0);
    for(let i=0;i<count;i++){
      const c=cells[i]||{url:'',zoom:1,offsetX:0,offsetY:0,rotation:0},source=sources[i];
      const g=seamGeometry(rects,i,w,h,amount),t=seamImageTransform(c,source?.width||1,source?.height||1,g);
      gl.activeTexture(gl.TEXTURE0+i);
      const image=source?.image||this.blank;let tex=this.textures.get(image);
      if(!tex){tex=gl.createTexture()!;gl.bindTexture(gl.TEXTURE_2D,tex);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
        if(this.color.directUpload){
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image as TexImageSource);
        }else{
          // Safari's DOM texture importer can apply the profile twice. Manage
          // ICC conversion explicitly once at original resolution, then upload
          // raw bytes in the output color space (no per-gesture readback).
          const pixels=document.createElement('canvas');pixels.width=source?.width||1;pixels.height=source?.height||1;
          const ctx=pixels.getContext('2d',{colorSpace:this.color.colorSpace})!;ctx.drawImage(image,0,0);
          const data=ctx.getImageData(0,0,pixels.width,pixels.height);
          // Typed-array uploads do not perform UNPACK_PREMULTIPLY_ALPHA_WEBGL.
          for(let k=0;k<data.data.length;k+=4){const a=data.data[k+3]/255;if(a!==1){data.data[k]*=a;data.data[k+1]*=a;data.data[k+2]*=a;}}
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,pixels.width,pixels.height,0,gl.RGBA,gl.UNSIGNED_BYTE,data.data);
          pixels.width=pixels.height=1;
        }
        // One immutable antialiasing pyramid per original prevents fine photo
        // details shimmering when minified. Trilinear sampling is continuous;
        // dragging and resting never switch resolution/quality modes.
        gl.generateMipmap(gl.TEXTURE_2D);const anisotropy=gl.getExtension('EXT_texture_filter_anisotropic');if(anisotropy)gl.texParameterf(gl.TEXTURE_2D,anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT));
        this.uploads++;this.textures.set(image,tex);this.textureBytes.set(image,(source?.width||1)*(source?.height||1)*4*4/3);
      }else {gl.bindTexture(gl.TEXTURE_2D,tex);this.textures.delete(image);this.textures.set(image,tex);}
      gl.uniform1i(gl.getUniformLocation(p,`photo${i}`),i);
      gl.uniform4f(gl.getUniformLocation(p,`box${i}`),g.ex,g.ey,g.ew,g.eh);
      gl.uniform4f(gl.getUniformLocation(p,`edges${i}`),g.left,g.top,g.right,g.bottom);
      gl.uniform4f(gl.getUniformLocation(p,`crop${i}`),t.tx,t.ty,t.scale,0);
      gl.uniform4f(gl.getUniformLocation(p,`source${i}`),source?.width||1,source?.height||1,Math.cos(t.angle),Math.sin(t.angle));
      gl.uniform1f(gl.getUniformLocation(p,`opacity${i}`),(c.opacity??100)/100);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    if(this.transferred){const bitmap=(this.canvas as OffscreenCanvas).transferToImageBitmap();target.getContext('bitmaprenderer')!.transferFromImageBitmap(bitmap);bitmap.close();}
    target.dataset.sourceUploads=String(this.uploads);
    target.dataset.colorSpace=this.color.colorSpace;
    // WebKit displays the GPU surface directly; its transfer/copy forces a
    // synchronous readback. Other engines transfer ownership without a 2D copy.
    // Both paths sample original pixels through the same continuous matrix.
  }
}
const renderers=new WeakMap<HTMLCanvasElement,SeamGpu>();
export function drawSeamPreview(target:HTMLCanvasElement,cells:SeamPhoto[],rects:SeamRect[],sources:SeamTexture[],amount:number,view:SeamView){
  let gpu=renderers.get(target);if(!gpu||gpu.lost){gpu=new SeamGpu(target);renderers.set(target,gpu);}gpu.draw(target,cells,rects,sources,amount,view);
}
export function disposeSeamPreview(target:HTMLCanvasElement){renderers.get(target)?.dispose();renderers.delete(target);}

/** Export uses exactly the preview's original textures and complementary
 * weights. Bounded tiles avoid a full-resolution GPU framebuffer allocation;
 * tagged raw pixels avoid WebKit's drawImage(WebGL) color-space conversion. */
export async function renderSeamlessGpu(cells:SeamPhoto[],rects:SeamRect[],sources:SeamTexture[],width:number,height:number,amount:number,cancelled:()=>boolean){
  const out=document.createElement('canvas');out.width=Math.max(1,Math.round(width));out.height=Math.max(1,Math.round(height));const ctx=get2dWide(out)!;
  const tile=document.createElement('canvas');tile.width=Math.min(1024,out.width);tile.height=Math.min(1024,out.height);
  const gpu=new SeamGpu(tile,true);
  try{
    for(let y=0;y<out.height;y+=1024)for(let x=0;x<out.width;x+=1024){
      if(cancelled())throw new DOMException('Superseded render','AbortError');
      if(gpu.lost)throw new Error('無縫拼圖 GPU context lost');
      tile.width=Math.min(1024,out.width-x);tile.height=Math.min(1024,out.height-y);
      gpu.draw(tile,cells,rects,sources,amount,{width:out.width,height:out.height,xx:tile.width,xy:0,x0:x,yx:0,yy:tile.height,y0:y});
      gpu.copyPixels(ctx,x,y);
      await new Promise<void>(resolve=>setTimeout(resolve,0));
    }
    return out;
  }finally{gpu.dispose();tile.width=tile.height=1;}
}
