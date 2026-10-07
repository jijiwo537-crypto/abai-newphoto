import { seamGeometry, seamImageTransform, type SeamPhoto, type SeamRect } from './seamlessLayout';
import { configureWebglWide, get2dWide } from './colorSpace';
export type SeamTexture = { image: CanvasImageSource; width: number; height: number } | null;
export type SeamView = { width:number;height:number;xx:number;xy:number;x0:number;yx:number;yy:number;y0:number;isolated?:boolean;sealEdges?:boolean;radii?:number[];crops?:{tx:number;ty:number;scale:number;angle:number}[];viewport?:number[];clip?:number[];clipGuard?:[number,number];other?:{xx:number;xy:number;x0:number;yx:number;yy:number;y0:number;clip:number[]} };

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
  private revisions=new Map<CanvasImageSource,string>();
  private blank=document.createElement('canvas');
  private invalid=false;
  private uploads=0;
  private buffer:WebGLBuffer|null=null;
  private maxTextureUnits:number;
  private uniforms=new Map<WebGLProgram,Map<string,WebGLUniformLocation|null>>();
  private lastPresentation:(()=>void)|null=null;
  constructor(canvas:HTMLCanvasElement,direct=false,private presentationOnly=false,srgbOutput=false){
    const webkit=/AppleWebKit/.test(navigator.userAgent)&&(!/Chrome\//.test(navigator.userAgent)||/iPhone|iPad|iPod/.test(navigator.userAgent));
    this.transferred=!direct&&!webkit&&typeof OffscreenCanvas!=='undefined'&&!!canvas.getContext('bitmaprenderer');
    this.canvas=this.transferred?new OffscreenCanvas(canvas.width,canvas.height):canvas;
    const gl=this.canvas.getContext('webgl2',{alpha:true,antialias:false,premultipliedAlpha:false,preserveDrawingBuffer:!presentationOnly}) as WebGL2RenderingContext|null;
    if(!gl)throw new Error('無縫拼圖 GPU 無法啟動');this.gl=gl;
    // srgbOutput: this surface is drawn into a 2D canvas with drawImage. WebKit
    // treats a WebGL canvas as sRGB there, so render sRGB (colour-managed
    // uploads) instead of Display-P3 bytes it would misread as washed out.
    this.color=srgbOutput?{colorSpace:'srgb',directUpload:false}:configureWebglWide(gl);
    this.maxTextureUnits=gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
    this.canvas.addEventListener('webglcontextlost',e=>{this.invalid=true;e.preventDefault();if(this.transferred)canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true}));},{once:true});
    if(this.transferred)this.canvas.addEventListener('webglcontextrestored',()=>canvas.dispatchEvent(new Event('webglcontextrestored')),{once:true});
    this.blank.width=this.blank.height=1;const empty=this.blank.getContext('2d')!;empty.fillStyle='#121212';empty.fillRect(0,0,1,1);
    this.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  }
  dispose(){const gl=this.gl;for(const t of this.textures.values())gl.deleteTexture(t);for(const p of this.programs.values())gl.deleteProgram(p);gl.deleteBuffer(this.buffer);this.textures.clear();this.textureBytes.clear();this.revisions.clear();this.programs.clear();this.uniforms.clear();this.lastPresentation=null;if(!gl.isContextLost())gl.getExtension('WEBGL_lose_context')?.loseContext();}
  get lost(){return this.invalid||this.gl.isContextLost();}
  copyPixels(ctx:CanvasRenderingContext2D,x:number,y:number,presentation?:HTMLCanvasElement){
    // Chromium transfers the rendered bitmap into the displayed canvas and
    // clears the OffscreenCanvas framebuffer. Read the displayed bitmap, not
    // the now-empty framebuffer; WebKit and tiled exports still read raw GL.
    if(this.transferred&&presentation){ctx.drawImage(presentation,x,y);return;}
    // A displayed WebGL canvas need not retain an extra framebuffer copy.
    // Pixel audits/exports explicitly redraw before reading, in the same task.
    if(this.presentationOnly)this.lastPresentation?.();
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
    const uniforms=Array.from({length:count},(_,i)=>`uniform sampler2D photo${i};uniform vec4 box${i};uniform vec4 limits${i};uniform vec4 edges${i};uniform vec4 crop${i};uniform vec4 source${i};uniform float opacity${i};uniform float radius${i};uniform bool srgb${i};`).join('\n');
    const owners=Array.from({length:count},(_,i)=>`{vec4 b=box${i},bounds=limits${i};vec2 outside=max(max(b.xy-p,p-(b.xy+b.zw)),vec2(0.));float distance=dot(outside,outside);bool inside=all(greaterThanEqual(p,bounds.xy))&&all(lessThan(p,bounds.zw));if(isolated&&!sealEdges?inside:distance<nearest){nearest=distance;owner=${i};}}`).join('\n');
    const layers=Array.from({length:count},(_,i)=>`{
      vec4 b=box${i},e=edges${i},c=crop${i},s=source${i};
      // Screen derivatives are analytic (dpx/dpy), never dFdx/fwidth inside
      // the per-pixel owner branch, where neighbouring corner fragments would
      // obtain undefined edge widths.
      float roundCoverage=1.;
      if(isolated&&radius${i}>0.){vec2 q=abs(p-(b.xy+b.zw*.5))-(b.zw*.5-radius${i});float sd=length(max(q,vec2(0.)))+min(max(q.x,q.y),0.)-radius${i};roundCoverage=1.-smoothstep(-aa*.5,aa*.5,sd);}
      if(!fused?owner==${i}:(p.x>=b.x&&p.y>=b.y&&p.x<=b.x+b.z&&p.y<=b.y+b.w)){
        float wx=(e.x>0.?smoothstep(b.x,b.x+2.*e.x,p.x):1.)*(e.z>0.?1.-smoothstep(b.x+b.z-2.*e.z,b.x+b.z,p.x):1.);
        float wy=(e.y>0.?smoothstep(b.y,b.y+2.*e.y,p.y):1.)*(e.w>0.?1.-smoothstep(b.y+b.w-2.*e.w,b.y+b.w,p.y):1.);
        vec2 d=p-(b.xy+b.zw*.5);d=vec2(d.x*s.z+d.y*s.w,-d.x*s.w+d.y*s.z)-c.xy;
        // Implicit texture() derivatives are undefined in this divergent owner
        // branch. At a shared cell edge the 2x2 quad mixes two owners, the GPU
        // then picks a tiny mip level and paints a 1-2px averaged line that
        // appears/disappears as zoom shifts the quad grid. Use exact gradients.
        vec2 st=s.xy*c.z,gx=vec2(dpx.x*s.z+dpx.y*s.w,-dpx.x*s.w+dpx.y*s.z)/st,gy=vec2(dpy.x*s.z+dpy.y*s.w,-dpy.x*s.w+dpy.y*s.z)/st;
        vec4 tex=textureGrad(photo${i},d/st+.5,gx,gy);
        vec3 encoded=tex.a>0.?tex.rgb/tex.a:vec3(0.);
        if(srgb${i})encoded=toP3(encoded);
        vec3 linearSource=toLinear(encoded);
        float a=tex.a*opacity${i};
        // Match the app's established canvas source-over appearance. Linear-light
        // averaging brightens mixed photo edges and makes the whole seam feel washed
        // out; keep encoded, color-managed RGB and only blend inside the feather band.
        vec3 rgb=encoded*a+vec3(18./255.)*(1.-a);
        float weight=wx*wy;
        if(isolated){
          // Real gaps/rounded corners; straight cell edges have one owner.
          vec4 bounds=limits${i};bool inside=all(greaterThanEqual(p,bounds.xy))&&all(lessThan(p,bounds.zw));
          if(!inside&&!sealEdges)weight=0.;
          weight*=roundCoverage;
          sum+=linearSource*a*weight;coverage+=a*weight;
        }else{sum+=rgb*weight;coverage+=weight;}
      }
    }`).join('\n');
    const fs=shader(gl.FRAGMENT_SHADER,`#version 300 es
      precision highp float;in vec2 uv;out vec4 color;uniform vec2 size;uniform vec3 viewX;uniform vec3 viewY;uniform vec2 pixels;uniform bool fused;uniform bool isolated;uniform bool sealEdges;
      uniform bool zones;uniform bool second;uniform vec4 clip;uniform vec4 otherClip;uniform vec2 clipGuard;uniform vec3 otherX;uniform vec3 otherY;
      ${uniforms}
      vec3 toP3(vec3 v){vec3 linear=mix(v/12.92,pow((v+.055)/1.055,vec3(2.4)),step(vec3(.04045),v));
        linear=mat3(.82259287,.03319951,.01708535,.17753395,.96678350,.07239572,0.,0.,.91030148)*linear;
        return mix(linear*12.92,1.055*pow(max(linear,vec3(0.)),vec3(1./2.4))-.055,step(vec3(.0031308),linear));}
      vec3 toLinear(vec3 v){return mix(v/12.92,pow((v+.055)/1.055,vec3(2.4)),step(vec3(.04045),v));}
      vec3 toEncoded(vec3 v){return mix(v*12.92,1.055*pow(max(v,vec3(0.)),vec3(1./2.4))-.055,step(vec3(.0031308),v));}
      void main(){bool a=all(greaterThanEqual(uv,clip.xy))&&all(lessThanEqual(uv,clip.zw));bool b=second&&all(greaterThanEqual(uv,otherClip.xy))&&all(lessThanEqual(uv,otherClip.zw));
        // A separately composited canvas is bilinearly sampled by the browser.
        // Replicate photo edges into its filter footprint, beneath the main
        // canvas's authoritative mask. Do not alter crop, cell bounds or UVs.
        bool guardA=all(greaterThanEqual(uv,clip.xy-clipGuard))&&all(lessThanEqual(uv,clip.zw+clipGuard));
        bool guardB=second&&all(greaterThanEqual(uv,otherClip.xy-clipGuard))&&all(lessThanEqual(uv,otherClip.zw+clipGuard));
        if(zones&&!guardA&&!guardB){color=vec4(0.);return;}
        vec3 vx=zones&&!a&&b?otherX:viewX,vy=zones&&!a&&b?otherY:viewY;
        vec2 p=clamp(vec2(dot(uv,vx.xy)+vx.z,dot(uv,vy.xy)+vy.z),vec2(.00001),size-vec2(.00001));
        // One framebuffer pixel step in layout space (uv spans the viewport).
        vec2 dpx=vec2(vx.x,vy.x)/pixels.x,dpy=vec2(vx.y,vy.y)/pixels.y;float aa=max(length(dpx),length(dpy));
        float nearest=1.e30;int owner=-1;if(!fused){${owners}}
        vec3 sum=vec3(0.);float coverage=0.;${layers}
        // T-junctions and antialiased cell bands can contribute a coverage
        // sum slightly above one. Clamp only output alpha; clamping the RGB
        // divisor changes image tone as the fusion width moves.
        float divisor=isolated?max(.000001,min(1.,coverage)):max(.000001,coverage);
        color=vec4(isolated?toEncoded(sum/divisor):sum/divisor,isolated?min(1.,coverage):1.);}`);
    p=gl.createProgram()!;gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p)||'Program');
    this.programs.set(count,p);return p;
  }
  draw(target:HTMLCanvasElement,cells:SeamPhoto[],rects:SeamRect[],sources:SeamTexture[],amount:number,view:SeamView){
    if(this.presentationOnly)this.lastPresentation=()=>this.draw(target,cells,rects,sources,amount,view);
    const gl=this.gl,w=view.width,h=view.height,count=rects.length;
    const active=new Set(sources.map(s=>s?.image||this.blank));
    const incoming=sources.reduce((n,s)=>n+(s&&!this.textures.has(s.image)?s.width*s.height*4*4/3:0),0);
    let resident=Array.from(this.textureBytes.values()).reduce((a,b)=>a+b,0);
    // Edited canvases are transient results, not reusable photo originals.
    // Release them as soon as another result replaces them, rather than
    // retaining a second native-size copy throughout repeated edits/swaps.
    for(const [image,tex] of this.textures){
      if(active.has(image))continue;
      if(!(image instanceof HTMLCanvasElement)&&resident+incoming<=32*1024*1024&&this.textures.size<=12)continue;
      resident-=this.textureBytes.get(image)||0;gl.deleteTexture(tex);this.textures.delete(image);this.textureBytes.delete(image);this.revisions.delete(image);
    }
    if(count>this.maxTextureUnits)throw new Error('佈局相片數超過 GPU 上限');
    if(this.canvas.width!==target.width)this.canvas.width=target.width;if(this.canvas.height!==target.height)this.canvas.height=target.height;
    gl.viewport(0,0,target.width,target.height);const p=this.program(count);gl.useProgram(p);
    let locations=this.uniforms.get(p);if(!locations){locations=new Map();this.uniforms.set(p,locations);}
    const uniform=(name:string)=>{if(!locations!.has(name))locations!.set(name,gl.getUniformLocation(p,name));return locations!.get(name)!;};
    const loc=gl.getAttribLocation(p,'position');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
    gl.uniform2f(uniform('size'),w,h);gl.uniform2f(uniform('pixels'),target.width,target.height);
    gl.uniform1i(uniform('fused'),amount>=0?1:0);
    gl.uniform1i(uniform('isolated'),view.isolated?1:0);
    gl.uniform1i(uniform('sealEdges'),view.sealEdges?1:0);
    gl.uniform3f(uniform('viewX'),view.xx,view.xy,view.x0);gl.uniform3f(uniform('viewY'),view.yx,view.yy,view.y0);
    gl.uniform1i(uniform('zones'),view.clip?1:0);gl.uniform1i(uniform('second'),view.other?1:0);
    gl.uniform4fv(uniform('clip'),view.clip||[-1,-1,2,2]);
    gl.uniform2fv(uniform('clipGuard'),view.clipGuard||[0,0]);
    gl.uniform4fv(uniform('otherClip'),view.other?.clip||[-1,-1,-1,-1]);
    const other=view.other||view;gl.uniform3f(uniform('otherX'),other.xx,other.xy,other.x0);gl.uniform3f(uniform('otherY'),other.yx,other.yy,other.y0);
    for(let i=0;i<count;i++){
      const c=cells[i]||{url:'',zoom:1,offsetX:0,offsetY:0,rotation:0},source=sources[i];
      const g=seamGeometry(rects,i,w,h,amount),t=view.crops?.[i]||seamImageTransform(c,source?.width||1,source?.height||1,g);
      gl.activeTexture(gl.TEXTURE0+i);
      const image=source?.image||this.blank;let tex=this.textures.get(image);
      const revision=(image as HTMLCanvasElement).dataset?.seamRevision||'';
      // Immutable edited photos are colour-managed once at texture upload,
      // just like originals. Only live mutable effect canvases need the shader
      // conversion, avoiding repeated gamma powers during preview zoom.
      const srgbCanvas=image instanceof HTMLCanvasElement&&!!revision&&image.dataset.regionImmutable!=='1';
      if(!tex||this.revisions.get(image)!==revision){tex||=gl.createTexture()!;gl.bindTexture(gl.TEXTURE_2D,tex);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
        if(srgbCanvas){
          // Photo effects are explicitly sRGB. Import their resident canvas
          // directly and convert primaries in the shader, avoiding a synchronous
          // GPU -> CPU -> GPU readback on every effect input in Safari.
          gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image as TexImageSource);
          gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.BROWSER_DEFAULT_WEBGL);
        }else if(this.color.directUpload){
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
        // These placements have no perspective or nonuniform texture stretch;
        // ordinary trilinear mipmaps already sample their isotropic footprint.
        // Forcing maximum anisotropy adds work without additional image detail.
        gl.generateMipmap(gl.TEXTURE_2D);
        this.uploads++;this.textures.set(image,tex);this.revisions.set(image,revision);this.textureBytes.set(image,(source?.width||1)*(source?.height||1)*4*4/3);
      }else {gl.bindTexture(gl.TEXTURE_2D,tex);this.textures.delete(image);this.textures.set(image,tex);}
      gl.uniform1i(uniform(`photo${i}`),i);
      gl.uniform1i(uniform(`srgb${i}`),srgbCanvas&&this.color.colorSpace==='display-p3'?1:0);
      gl.uniform4f(uniform(`box${i}`),g.ex,g.ey,g.ew,g.eh);
      gl.uniform4f(uniform(`limits${i}`),g.ex,g.ey,g.ex+g.ew,g.ey+g.eh);
      gl.uniform4f(uniform(`edges${i}`),g.left,g.top,g.right,g.bottom);
      gl.uniform4f(uniform(`crop${i}`),t.tx,t.ty,t.scale,0);
      gl.uniform4f(uniform(`source${i}`),source?.width||1,source?.height||1,Math.cos(t.angle),Math.sin(t.angle));
      gl.uniform1f(uniform(`opacity${i}`),(c.opacity??100)/100);
      gl.uniform1f(uniform(`radius${i}`),view.radii?.[i]||0);
    }
    if(view.viewport){gl.disable(gl.SCISSOR_TEST);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.enable(gl.SCISSOR_TEST);gl.scissor(view.viewport[0],view.viewport[1],view.viewport[2],view.viewport[3]);}
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);gl.disable(gl.SCISSOR_TEST);
    if(this.transferred){const bitmap=(this.canvas as OffscreenCanvas).transferToImageBitmap();target.getContext('bitmaprenderer')!.transferFromImageBitmap(bitmap);bitmap.close();}
    target.dataset.sourceUploads=String(this.uploads);
    target.dataset.residentTextureBytes=String(Array.from(this.textureBytes.values()).reduce((a,b)=>a+b,0));
    target.dataset.residentTextures=String(this.textures.size);
    target.dataset.colorSpace=this.color.colorSpace;
    // WebKit displays the GPU surface directly; its transfer/copy forces a
    // synchronous readback. Other engines transfer ownership without a 2D copy.
    // Both paths sample original pixels through the same continuous matrix.
  }
}
const renderers=new WeakMap<HTMLCanvasElement,SeamGpu>();
export function drawSeamPreview(target:HTMLCanvasElement,cells:SeamPhoto[],rects:SeamRect[],sources:SeamTexture[],amount:number,view:SeamView,presentationOnly=false,srgbOutput=false){
  let gpu=renderers.get(target);if(!gpu||gpu.lost){gpu=new SeamGpu(target,false,presentationOnly,srgbOutput);renderers.set(target,gpu);}gpu.draw(target,cells,rects,sources,amount,view);
}
export function disposeSeamPreview(target:HTMLCanvasElement){renderers.get(target)?.dispose();renderers.delete(target);}
/** A 2D collage composition cannot display the WebGL layer directly. On
 * WebKit use tagged raw pixels, avoiding its second DOM color conversion. */
export function copySeamPreviewPixels(target:HTMLCanvasElement,ctx:CanvasRenderingContext2D,x=0,y=0){
  const gpu=renderers.get(target);if(!gpu)throw new Error('Missing seam renderer');gpu.copyPixels(ctx,x,y,target);
}

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
