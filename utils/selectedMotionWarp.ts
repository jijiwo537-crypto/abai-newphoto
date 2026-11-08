/** One reusable GPU surface for horizontal displacement. Premultiplied alpha avoids strip seams. */
let source: HTMLCanvasElement | undefined;
let state: {canvas:HTMLCanvasElement;gl:WebGLRenderingContext;tex:WebGLTexture;u:Record<string,WebGLUniformLocation|null>} | null | undefined;
function gpu() {
 if(state!==undefined)return state;
 state=null;
 const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,preserveDrawingBuffer:true,antialias:false});
 if(!gl)return null;
 const shader=(type:number,code:string)=>{const s=gl.createShader(type)!;gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error('Motion shader');return s;};
 try{
  const p=gl.createProgram()!;
  gl.attachShader(p,shader(gl.VERTEX_SHADER,'attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}'));
  gl.attachShader(p,shader(gl.FRAGMENT_SHADER,`precision highp float;varying vec2 v;uniform sampler2D tex;uniform vec2 size;uniform float radius,amp,phase,fold,top,density;
   void main(){float y=(1.-v.y)*size.y;float localY=top+y/density;float shift=sin(localY/radius*4.-phase)*amp*mix(1.,cos(localY/radius*2.),fold);float x=v.x*size.x-shift*density;
    if(x<0.||x>size.x){gl_FragColor=vec4(0.);return;}gl_FragColor=texture2D(tex,vec2(x/size.x,y/size.y));}`));
  gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))return null;gl.useProgram(p);
  const b=gl.createBuffer()!;gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  const a=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
  const tex=gl.createTexture()!;gl.bindTexture(gl.TEXTURE_2D,tex);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  const u=Object.fromEntries(['size','radius','amp','phase','fold','top','density'].map(k=>[k,gl.getUniformLocation(p,k)]));
  state={canvas,gl,tex,u};return state;
 }catch{return null;}
}
export function paintSelectedWarp(ctx:CanvasRenderingContext2D,w:number,h:number,radius:number,amp:number,phase:number,fold:boolean,paint:(g:CanvasRenderingContext2D)=>void) {
 if(typeof document==='undefined'){paint(ctx);return;}
 const tf=ctx.getTransform(),density=Math.max(.01,Math.hypot(tf.a,tf.b),Math.hypot(tf.c,tf.d));
 const pad=Math.max(w,h)*.8;
 let left=-w/2-pad,top=-h/2-pad,right=w/2+pad,bottom=h/2+pad;
 // Crop only invisible source pixels. Never reduce the visible sampling density.
 try{const inv=tf.inverse(),points=[[0,0],[ctx.canvas.width,0],[0,ctx.canvas.height],[ctx.canvas.width,ctx.canvas.height]].map(([x,y])=>inv.transformPoint({x,y}));
  left=Math.max(left,Math.min(...points.map(p=>p.x))-amp-2/density);right=Math.min(right,Math.max(...points.map(p=>p.x))+amp+2/density);
  top=Math.max(top,Math.min(...points.map(p=>p.y))-2/density);bottom=Math.min(bottom,Math.max(...points.map(p=>p.y))+2/density);
 }catch{}
 if(right<=left||bottom<=top)return;
 const width=Math.ceil((right-left)*density),height=Math.ceil((bottom-top)*density),st=gpu();
 source ||= document.createElement('canvas');
 if(source.width!==width)source.width=width;if(source.height!==height)source.height=height;
 const g=source.getContext('2d');if(!g){paint(ctx);return;}
 g.resetTransform();g.clearRect(0,0,width,height);g.setTransform(density,0,0,density,-left*density,-top*density);
 g.fillStyle=ctx.fillStyle;g.strokeStyle=ctx.strokeStyle;g.font=ctx.font;g.textAlign=ctx.textAlign;g.textBaseline=ctx.textBaseline;g.lineWidth=ctx.lineWidth;
 g.lineJoin=ctx.lineJoin;g.lineCap=ctx.lineCap;g.shadowColor=ctx.shadowColor;g.shadowBlur=ctx.shadowBlur;g.filter=ctx.filter;
 paint(g);
 ctx.save();ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.filter='none';
 if(st&&width<=st.gl.getParameter(st.gl.MAX_TEXTURE_SIZE)&&height<=st.gl.getParameter(st.gl.MAX_TEXTURE_SIZE)){
  const {gl,canvas,u,tex}=st;if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;
  gl.viewport(0,0,width,height);gl.bindTexture(gl.TEXTURE_2D,tex);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);gl.uniform2f(u.size,width,height);gl.uniform1f(u.radius,radius);gl.uniform1f(u.amp,amp);gl.uniform1f(u.phase,phase);gl.uniform1f(u.fold,fold?1:0);gl.uniform1f(u.top,top);gl.uniform1f(u.density,density);gl.drawArrays(gl.TRIANGLES,0,6);
  ctx.drawImage(canvas,left,top,width/density,height/density);
 }else{
  // One device-pixel row, no clipping edges or overlapping strips.
  for(let y=0;y<height;y++){const localY=top+(y+.5)/density,dx=Math.sin(localY/radius*4-phase)*amp*(fold?Math.cos(localY/radius*2):1);ctx.drawImage(source,0,y,width,1,left+dx,top+y/density,width/density,1/density);}
 }
 ctx.restore();
}

export function releaseSelectedMotionSurfaces() {
 if(source){source.width=source.height=1;source=undefined;}
 if(state){state.gl.deleteTexture(state.tex);state.gl.getExtension('WEBGL_lose_context')?.loseContext();state.canvas.width=state.canvas.height=1;}
 state=undefined;
}
