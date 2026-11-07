import { seamGeometry, seamImageTransform, type SeamPhoto, type SeamRect } from './seamlessLayout';
import { configureWebglWide, get2dWide } from './colorSpace';
export type SeamTexture = { image: CanvasImageSource; width: number; height: number } | null;
export type SeamView = { width:number;height:number;xx:number;xy:number;x0:number;yx:number;yy:number;y0:number;isolated?:boolean;sealEdges?:boolean;radii?:number[];dims?:number[];crops?:{tx:number;ty:number;scale:number;angle:number}[];viewport?:number[];clip?:number[];clipGuard?:[number,number];other?:{xx:number;xy:number;x0:number;yx:number;yy:number;y0:number;clip:number[]} };

/**
 * 原尺寸的來源貼圖加上實體像素的 viewport 繪製。融合只改 uniform；拖動和靜止用一模一樣的畫質路線
 */
/* Safari 的原圖要自己做一次色彩管理再上傳（見下面 draw 的最後一條路）：畫進 2D 畫布 → getImageData →
   預乘透明度 → 上傳原始位元組。一張 12MP 照片這樣做在主執行緒上一口氣要好幾百毫秒，拉照片進佈局時
   整個畫面會停住。改成「一次一條」：每條約 40 萬像素（一格內就做完），中間讓出主執行緒，畫面照常更新；
   做完才一次上傳。每條上下多畫幾排再只取中間，縮小取樣不會在條與條的交界留下接縫。算法、色彩空間完全相同。 */
let seamTextureEpochValue=0;
/** 有原圖的完整解析度材質剛換上：佈局要重畫（底圖的內容簽章也要跟著變） */
export const seamTextureEpoch=()=>seamTextureEpochValue;
const yieldTask=()=>new Promise<void>(r=>setTimeout(r,0));
function premultiplyRows(data:Uint8ClampedArray){
  // 照片幾乎都不透明：先用 32 位元快速確認，有透明像素才逐點預乘
  const u32=new Uint32Array(data.buffer,data.byteOffset,data.byteLength>>2);let opaque=true;
  for(let k=0;k<u32.length;k++)if((u32[k]>>>24)!==255){opaque=false;break;}
  if(opaque)return;
  for(let k=0;k<data.length;k+=4){const a=data[k+3]/255;if(a!==1){data[k]*=a;data[k+1]*=a;data[k+2]*=a;}}
}
/** 小的那張（最長邊 1024）：一次做完，給完整解析度還沒好之前先頂著 */
function smallPixels(image:CanvasImageSource,w:number,h:number,colorSpace:'srgb'|'display-p3'){
  const c=document.createElement('canvas');c.width=w;c.height=h;
  const g=c.getContext('2d',{colorSpace,willReadFrequently:true}) as CanvasRenderingContext2D;g.imageSmoothingQuality='high';g.drawImage(image,0,0,w,h);
  const data=g.getImageData(0,0,w,h).data;premultiplyRows(data);c.width=c.height=1;return data;
}
async function stripPixels(image:CanvasImageSource,sw:number,sh:number,w:number,h:number,colorSpace:'srgb'|'display-p3',alive:()=>boolean){
  const out=new Uint8Array(w*h*4),rows=Math.max(16,Math.floor(400_000/w)),pad=4;
  const strip=document.createElement('canvas');strip.width=w;
  const ctx=()=>{const g=strip.getContext('2d',{colorSpace,willReadFrequently:true}) as CanvasRenderingContext2D;g.imageSmoothingQuality='high';return g;};
  try{
    // 先讓出一次：呼叫的那一格要先把（小的）材質登記好，alive() 才會成立
    await yieldTask();
    for(let y0=0;y0<h;y0+=rows){
      if(!alive())return null;
      const y1=Math.min(h,y0+rows),a=Math.max(0,y0-pad),b=Math.min(h,y1+pad);
      if(strip.height!==b-a)strip.height=b-a;
      const g=ctx();g.clearRect(0,0,w,b-a);
      // 輸出第 a～b 排對應原圖的 a/h～b/h：跟整張一次縮小的取樣位置相同
      g.drawImage(image,0,sh*a/h,sw,sh*(b-a)/h,0,0,w,b-a);
      const data=g.getImageData(0,y0-a,w,y1-y0).data;premultiplyRows(data);
      out.set(data,y0*w*4);
      await yieldTask();
    }
    return out;
  }finally{strip.width=strip.height=1;}
}

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
  /**
   * 每個目標上一次畫了哪些圖。一個共用繪製服務很多目標；沒有任何目標還在顯示它，貼圖才算「沒在用」
   */
  private targetSets=new Map<HTMLCanvasElement,Set<CanvasImageSource>>();
  /** 正在分條準備完整解析度的原圖（這段期間先用 1024 的小材質頂著） */
  private pendingFull=new Map<CanvasImageSource,string>();
  /** 還只是一格底色的材質（背景解碼還沒好）。這一次 draw 用到了就是 incomplete：結果不能拿去蓋畫面 */
  private placeholder=new Set<CanvasImageSource>();
  incomplete=false;
  constructor(canvas:HTMLCanvasElement,private direct=false,private presentationOnly=false,readonly srgbOutput=false,readonly shared=false,noTransfer=false){
    const webkit=/AppleWebKit/.test(navigator.userAgent)&&(!/Chrome\//.test(navigator.userAgent)||/iPhone|iPad|iPod/.test(navigator.userAgent));
    this.transferred=!direct&&!shared&&!noTransfer&&!webkit&&typeof OffscreenCanvas!=='undefined'&&!!canvas.getContext('bitmaprenderer');
    this.canvas=this.transferred?new OffscreenCanvas(canvas.width,canvas.height):canvas;
    const gl=this.canvas.getContext('webgl2',{alpha:true,antialias:false,premultipliedAlpha:false,preserveDrawingBuffer:!presentationOnly}) as WebGL2RenderingContext|null;
    if(!gl)throw new Error('無縫拼圖 GPU 無法啟動');this.gl=gl;
    // srgbOutput：這張畫布會被 drawImage 畫進 2D 畫布。WebKit 在那裡把 WebGL 畫布當成 sRGB，
    // 所以要輸出 sRGB（上傳時做色彩管理），不能輸出 Display-P3 的值，不然會被讀成褪色
    this.color=srgbOutput?{colorSpace:'srgb',directUpload:false}:configureWebglWide(gl);
    this.maxTextureUnits=gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
    this.canvas.addEventListener('webglcontextlost',e=>{this.invalid=true;e.preventDefault();if(this.transferred)canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true}));},{once:true});
    if(this.transferred)this.canvas.addEventListener('webglcontextrestored',()=>canvas.dispatchEvent(new Event('webglcontextrestored')),{once:true});
    this.blank.width=this.blank.height=1;const empty=this.blank.getContext('2d')!;empty.fillStyle='#121212';empty.fillRect(0,0,1,1);
    this.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  }
  dispose(){const gl=this.gl;for(const t of this.textures.values())gl.deleteTexture(t);for(const p of this.programs.values())gl.deleteProgram(p);gl.deleteBuffer(this.buffer);this.textures.clear();this.textureBytes.clear();this.revisions.clear();this.programs.clear();this.uniforms.clear();this.lastPresentation=null;if(!gl.isContextLost())gl.getExtension('WEBGL_lose_context')?.loseContext();}
  get lost(){return this.invalid||this.gl.isContextLost();}
  get surface(){return this.canvas as HTMLCanvasElement;}
  /** 目標沒了：它的貼圖變成沒在用（可以淘汰） */
  forget(target:HTMLCanvasElement){
    const set=this.targetSets.get(target);if(!set)return;this.targetSets.delete(target);
    const still=new Set<CanvasImageSource>();for(const other of this.targetSets.values())for(const image of other)still.add(image);
    for(const image of set){if(still.has(image)||!(image instanceof HTMLCanvasElement))continue;const tex=this.textures.get(image);if(tex)this.gl.deleteTexture(tex);this.textures.delete(image);this.textureBytes.delete(image);this.revisions.delete(image);}
  }
  copyPixels(ctx:CanvasRenderingContext2D,x:number,y:number,presentation?:HTMLCanvasElement){
    // Chromium 會把畫好的點陣轉進顯示的畫布，並清空 OffscreenCanvas 的畫面暫存。讀顯示的點陣，
    // 不讀已經空了的暫存；WebKit 和分塊存檔照樣讀原始的 GL
    if(this.transferred&&presentation){ctx.drawImage(presentation,x,y);return;}
    // 顯示中的 WebGL 畫布不需要多留一份畫面暫存。像素檢查和存檔在同一個工作裡明確重畫再讀
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
    const uniforms=Array.from({length:count},(_,i)=>`uniform sampler2D photo${i};uniform vec4 box${i};uniform vec4 limits${i};uniform vec4 edges${i};uniform vec4 crop${i};uniform vec4 source${i};uniform float opacity${i};uniform float radius${i};uniform float dim${i};uniform bool srgb${i};`).join('\n');
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
        // 長按互換時被懸停的那一格：在這一格自己的權重上變暗 —— 暗掉的範圍就是這張照片
        // 實際畫到的範圍（含無縫的融合帶、圓角、邊緣抗鋸齒），跟另外疊一層黑框不一樣。
        encoded*=dim${i};
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
    this.incomplete=false;
    this.targetSets.set(target,new Set(sources.map(s=>s?.image||this.blank)));
    const active=new Set<CanvasImageSource>();for(const set of this.targetSets.values())for(const image of set)active.add(image);
    const incoming=sources.reduce((n,s)=>n+(s&&!this.textures.has(s.image)?s.width*s.height*4*4/3:0),0);
    let resident=Array.from(this.textureBytes.values()).reduce((a,b)=>a+b,0);
    // 編輯過的畫布是暫時的結果，不是可以重用的照片原圖。一被別的結果取代就放掉，
    // 不要在反覆編輯、換照片時一直多留一份原圖大小的複本
    for(const [image,tex] of this.textures){
      if(active.has(image))continue;
      if(!(image instanceof HTMLCanvasElement)&&resident+incoming<=32*1024*1024&&this.textures.size<=12)continue;
      resident-=this.textureBytes.get(image)||0;gl.deleteTexture(tex);this.textures.delete(image);this.textureBytes.delete(image);this.revisions.delete(image);
    }
    if(count>this.maxTextureUnits)throw new Error('佈局相片數超過 GPU 上限');
    // 共用畫布只會變大：不同大小的版面畫在它的左下角，不必每次繪製都重新配置畫面暫存
    if(this.shared){if(this.canvas.width<target.width)this.canvas.width=target.width;if(this.canvas.height<target.height)this.canvas.height=target.height;}
    else{if(this.canvas.width!==target.width)this.canvas.width=target.width;if(this.canvas.height!==target.height)this.canvas.height=target.height;}
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
      // 編輯好的固定照片跟原圖一樣，在上傳貼圖時做一次色彩管理。只有即時、會變的特效畫布需要在著色器裡轉換，
      // 預覽縮放時才不會一直重複算 gamma 次方
      const srgbCanvas=image instanceof HTMLCanvasElement&&!!revision&&image.dataset.regionImmutable!=='1';
      /* 記憶體：一張 1200 萬像素的原生貼圖加上 mipmap 約 64MB。預覽是用螢幕密度取樣，
         所以貼圖上限設成手機螢幕看得到的程度（照片越多，每張越小）。同時常駐好幾張全尺寸原圖時 iOS 會關掉網頁。
         存檔（直接畫）維持原解析度；UV 是正規化的，幾何不變 */
      const limit=this.direct?Infinity:count<=2?4096:count<=4?3072:2048;
      const sw=source?.width||1,sh=source?.height||1,shrink=Math.min(1,limit/Math.max(sw,sh));
      const uploadW=Math.max(1,Math.round(sw*shrink)),uploadH=Math.max(1,Math.round(sh*shrink));
      if(!tex||this.revisions.get(image)!==revision){tex||=gl.createTexture()!;gl.bindTexture(gl.TEXTURE_2D,tex);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
        if(srgbCanvas){
          // 照片特效明確是 sRGB。直接匯入它常駐的畫布、在著色器裡轉換原色，
          // Safari 上每次特效輸入才不必同步 GPU → CPU → GPU 讀回
          gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image as TexImageSource);
          gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.BROWSER_DEFAULT_WEBGL);
        }else if(this.color.directUpload&&!(limit<Math.max(source?.width||1,source?.height||1))){
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image as TexImageSource);
        }else if(this.color.directUpload){
          // 預覽貼圖上限是顯示需要的大小（見 limit），透過有色彩管理的畫布在輸出色域裡畫一次
          const small=document.createElement('canvas');small.width=uploadW;small.height=uploadH;
          const g2=small.getContext('2d',{colorSpace:this.color.colorSpace})!;g2.imageSmoothingQuality='high';g2.drawImage(image,0,0,uploadW,uploadH);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,small);
          small.width=small.height=1;
        }else if(this.shared&&!this.direct&&uploadW*uploadH>1_200_000&&!(image instanceof HTMLCanvasElement)&&typeof createImageBitmap==='function'){
          /* 大張原圖：主執行緒上完全不解碼、不縮放。先放一格空格子的底色，
             背景解碼（createImageBitmap）好了先換上最長邊 1024 的，再分條準備完整解析度，各換一次並通知重畫。 */
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([18,18,18,255]));
          this.placeholder.add(image);this.incomplete=true;
          const job=`${revision}|${uploadW}x${uploadH}`;
          this.pendingFull.set(image,job);
          const alive=()=>!this.lost&&this.pendingFull.get(image)===job&&this.textures.get(image)===tex;
          const put=(w:number,h:number,data:ArrayBufferView)=>{
            gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
            gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,data);gl.generateMipmap(gl.TEXTURE_2D);
            seamTextureEpochValue++;window.dispatchEvent(new Event('abai-seam-texture'));
          };
          const space=this.color.colorSpace;
          void (async()=>{
            await yieldTask();if(!alive())return;
            let bmp=await createImageBitmap(image as ImageBitmapSource,{imageOrientation:'from-image'}).catch(()=>null);
            // 尺寸跟原圖對不上（例如沒照 EXIF 轉向）就不用它，照舊直接畫原圖，方向與色彩不變
            if(bmp&&(bmp.width!==sw||bmp.height!==sh)){bmp.close();bmp=null;}
            try{
              const src:CanvasImageSource=bmp||image;
              if(!alive())return;
              const k=1024/Math.max(uploadW,uploadH),pw=Math.max(1,Math.round(uploadW*k)),ph=Math.max(1,Math.round(uploadH*k));
              this.placeholder.delete(image);put(pw,ph,smallPixels(src,pw,ph,space));
              await yieldTask();
              const full=await stripPixels(src,sw,sh,uploadW,uploadH,space,alive);
              if(full&&alive()){this.pendingFull.delete(image);put(uploadW,uploadH,full);}
            }finally{bmp?.close();}
          })();
        }else{
          // Safari 的 DOM 貼圖匯入可能把描述檔套兩次。自己在原解析度做一次 ICC 轉換，
          // 再用輸出色域上傳原始位元組（每個手勢都不讀回）
          const pixels=document.createElement('canvas');pixels.width=uploadW;pixels.height=uploadH;
          const ctx=pixels.getContext('2d',{colorSpace:this.color.colorSpace})!;ctx.imageSmoothingQuality='high';ctx.drawImage(image,0,0,uploadW,uploadH);
          const data=ctx.getImageData(0,0,pixels.width,pixels.height);
          // 型別陣列上傳不會做 UNPACK_PREMULTIPLY_ALPHA_WEBGL
          for(let k=0;k<data.data.length;k+=4){const a=data.data[k+3]/255;if(a!==1){data.data[k]*=a;data.data[k+1]*=a;data.data[k+2]*=a;}}
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,pixels.width,pixels.height,0,gl.RGBA,gl.UNSIGNED_BYTE,data.data);
          pixels.width=pixels.height=1;
        }
        // 每張原圖一份固定的反鋸齒金字塔，縮小時照片的細節才不會閃爍。三線性取樣是連續的，
        // 拖動和靜止時都不切換解析度或畫質模式。這些擺放沒有透視或不等比的貼圖拉伸，
        // 一般的三線性 mipmap 已經取樣到等向的範圍；強制最大非等向過濾只會多花工夫，不會多出細節
        gl.generateMipmap(gl.TEXTURE_2D);
        this.uploads++;this.textures.set(image,tex);this.revisions.set(image,revision);this.textureBytes.set(image,(srgbCanvas?(source?.width||1)*(source?.height||1):uploadW*uploadH)*4*4/3);
      }else {gl.bindTexture(gl.TEXTURE_2D,tex);this.textures.delete(image);this.textures.set(image,tex);if(this.placeholder.has(image))this.incomplete=true;}
      gl.uniform1i(uniform(`photo${i}`),i);
      gl.uniform1i(uniform(`srgb${i}`),srgbCanvas&&this.color.colorSpace==='display-p3'?1:0);
      gl.uniform4f(uniform(`box${i}`),g.ex,g.ey,g.ew,g.eh);
      gl.uniform4f(uniform(`limits${i}`),g.ex,g.ey,g.ex+g.ew,g.ey+g.eh);
      gl.uniform4f(uniform(`edges${i}`),g.left,g.top,g.right,g.bottom);
      gl.uniform4f(uniform(`crop${i}`),t.tx,t.ty,t.scale,0);
      gl.uniform4f(uniform(`source${i}`),source?.width||1,source?.height||1,Math.cos(t.angle),Math.sin(t.angle));
      gl.uniform1f(uniform(`opacity${i}`),(c.opacity??100)/100);
      gl.uniform1f(uniform(`radius${i}`),view.radii?.[i]||0);
      gl.uniform1f(uniform(`dim${i}`),view.dims?.[i]??1);
    }
    if(view.viewport){gl.disable(gl.SCISSOR_TEST);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.enable(gl.SCISSOR_TEST);gl.scissor(view.viewport[0],view.viewport[1],view.viewport[2],view.viewport[3]);}
    else if(view.clip&&!view.other){
      /* 有裁切範圍時，範圍外著色器本來就輸出全透明：只讓 GPU 算範圍（含濾波護邊）裡的像素，
         外面直接清成透明 —— 結果逐像素相同。創意拼圖的畫布含捏合預留空間，
         不讓整張（將近兩倍可見面積）每一格都跑完整個著色器。 */
      const W=target.width,H=target.height,c=view.clip,g=view.clipGuard||[0,0];
      const x0=Math.max(0,Math.floor((c[0]-g[0])*W)-1),x1=Math.min(W,Math.ceil((c[2]+g[0])*W)+1);
      const top=Math.max(0,Math.floor((c[1]-g[1])*H)-1),bottom=Math.min(H,Math.ceil((c[3]+g[1])*H)+1);
      gl.disable(gl.SCISSOR_TEST);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.SCISSOR_TEST);gl.scissor(x0,H-bottom,Math.max(0,x1-x0),Math.max(0,bottom-top));
    }
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
/** noTransfer：畫在 target 自己的 WebGL context 上（不經 OffscreenCanvas 轉交）。
 *  要直接當 DOM 圖層顯示、而且保留 Display-P3 標記時用。 */
export function drawSeamPreview(target:HTMLCanvasElement,cells:SeamPhoto[],rects:SeamRect[],sources:SeamTexture[],amount:number,view:SeamView,presentationOnly=false,srgbOutput=false,noTransfer=false){
  let gpu=renderers.get(target);
  // 畫布的色彩模式由第一個繪製決定；不一致的話會默默維持錯的輸出（WebKit 上會褪色），所以直接報錯
  if(gpu&&!gpu.lost&&gpu.srgbOutput!==srgbOutput)throw new Error('Seam surface colour mode mismatch');
  if(!gpu||gpu.lost){gpu=new SeamGpu(target,false,presentationOnly,srgbOutput,false,noTransfer);renderers.set(target,gpu);}gpu.draw(target,cells,rects,sources,amount,view);
}
export function disposeSeamPreview(target:HTMLCanvasElement){renderers.get(target)?.dispose();renderers.delete(target);}

/* 跨頁拼圖：整個編輯器只用一個 WebGL 繪製。每個版面各有一個 context 的話，
   頁數一多 iOS 就會收掉最舊的（照片變灰），每個版面也各自編譯著色器、各留一份複本。
   所以每個版面都畫在一般的 2D 畫布上，接收自己那一格的複本：畫面外的頁面是不需要 GPU context 的靜態點陣，
   context 掉了也不會讓任何東西變空白（2D 像素還在，下次繪製時重建繪製就好）。繪製輸出 sRGB，
   WebKit 用 drawImage 讀 WebGL 畫布時就是這樣解讀（見 srgbOutput） */
let sharedGpu:SeamGpu|null=null;
/** 回傳 false＝這次沒畫成（GPU 掉了、畫布記憶體不夠拿不到 2D）：目標畫布保留原本的像素，
 *  呼叫的一方要讓上一張繼續顯示。在 GPU 掉了的那一格不能照樣用 copy 把（全透明的）結果蓋上去，
 *  整個佈局就一下子消失。 */
export function drawSeamShared(target:HTMLCanvasElement,cells:SeamPhoto[],rects:SeamRect[],sources:SeamTexture[],amount:number,view:SeamView):boolean{
  if(sharedGpu?.lost){sharedGpu.dispose();sharedGpu=null;}
  try{sharedGpu??=new SeamGpu(document.createElement('canvas'),false,false,true,true);}catch{return false;}
  try{sharedGpu.draw(target,cells,rects,sources,amount,view);}catch{return false;}
  if(sharedGpu.lost)return false;
  /* 還有照片只是一格底色（背景解碼中）：目標畫布上已經有有效的畫面就不蓋上去，保留上一張，好了會再通知重畫。
     但畫布是剛配置、剛換尺寸的（裡面是空的）就照樣蓋上去：還沒好的那一格先是空格子的深色，
     其他格子照常 —— 不然整塊佈局透明，底下的頁面白底就露出來（第一次把照片換進佈局時那一下變白）。
     呼叫的一方換尺寸時要刪掉 data-seam-painted。 */
  if(sharedGpu.incomplete&&target.dataset.seamPainted==='1')return false;
  const g=get2dWide(target),src=sharedGpu.surface,w=target.width,h=target.height;
  if(!g)return false;
  g.save();g.setTransform(1,0,0,1,0,0);g.globalAlpha=1;g.globalCompositeOperation='copy';g.imageSmoothingEnabled=false;
  // WebGL 的原點在左下：viewport 的列是「最後」h 列
  g.drawImage(src,0,src.height-h,w,h,0,0,w,h);g.restore();
  target.dataset.seamPainted='1';
  return true;
}
export function releaseSeamShared(target:HTMLCanvasElement){sharedGpu?.forget(target);}
/**
 * 2D 拼圖合成沒辦法直接顯示 WebGL 圖層。WebKit 上用帶標記的原始像素，避開它在 DOM 的第二次色彩轉換
 */
export function copySeamPreviewPixels(target:HTMLCanvasElement,ctx:CanvasRenderingContext2D,x=0,y=0){
  const gpu=renderers.get(target);if(!gpu)throw new Error('Missing seam renderer');gpu.copyPixels(ctx,x,y,target);
}

/**
 * 存檔用的就是預覽的原圖貼圖和互補權重。限制圖塊大小，避免配置原解析度的 GPU 畫面暫存；
 * 帶標記的原始像素避開 WebKit 的 drawImage(WebGL) 色域轉換
 */
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
