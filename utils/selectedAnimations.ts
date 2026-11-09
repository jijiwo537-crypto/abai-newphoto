import { paintSelectedWarp } from './selectedMotionWarp';
/** ABAI Effects Lab selections. IDs persist in drafts; retired IDs are not offered. */
export type SelectedTarget = 'text' | 'symbol' | 'shape' | 'pattern';
const entries = [
 ['T-E03','淡入ll'],['T-E07','果凍ll'],
 ['T-L01','呼吸'],['T-L04','閃爍'],['T-L15','波浪ll'],['T-L20','失焦'],
 ['S-E03','淡入'],['S-E04','足跡'],['S-E10','旋轉'],
 ['S-L01','呼吸'],['S-L03','搖擺'],['S-L07','翻面'],['S-L20','失焦'],
 ['P-L02','閃爍'],['P-L04','發光'],['P-L07','翻面'],['P-L20','失焦'],
] as const;
export const SELECTED_ANIMATIONS = entries.map(([code,name]) => ({
 code, id: `lab-${code}`, name, target: ({T:'text',S:'symbol',G:'shape',P:'pattern'} as const)[code[0] as 'T'|'S'|'G'|'P'], phase: code[2] === 'E' ? 'entry' : 'idle',
}));
const catalog = new Map(SELECTED_ANIMATIONS.map(x=>[x.id,x]));
export const selectedKinds = (target: SelectedTarget, phase: 'entry'|'idle') => SELECTED_ANIMATIONS.filter(x=>x.target===target&&x.phase===phase);
/** clock：不受個別進場錯開影響的共用時間；slot/slots：圖案這類「一群目標」中的序號。 */
export type SelectedFrame = { id:string; p:number; t:number; amount:number; speed:number; phase:number; clock?:number; slot?:number; slots?:number };
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const smooth=(v:number)=>{v=clamp(v);return v*v*(3-2*v);};
/* 拖動速度滑桿時，所有常駐動畫的相位都是「時間 × 速度」：速度一變，相位整段跳到別處，
   畫面就一頓一頓的（失焦的週期長，最明顯）。這裡記住每個動畫上一次的速度，速度改變時
   把時間平移，讓「此刻的相位」不變，之後才用新速度往前走。時間倒退（重播、循環、匯出
   從頭開始）就清掉平移，回到純粹由時間決定的畫面，預覽與匯出仍然一致。 */
const speedAnchors=new Map<string,{speed:number;time:number;off:number}>();
function continuousTime(key:string,time:number,speed:number){
 const a=speedAnchors.get(key);
 if(!a||time<a.time-1e-6){speedAnchors.set(key,{speed,time,off:0});if(speedAnchors.size>256)speedAnchors.delete(speedAnchors.keys().next().value as string);return time;}
 if(Math.abs(a.speed-speed)>1e-9){a.off=(time+a.off)*a.speed/speed-time;a.speed=speed;}
 a.time=time;
 return time+a.off;
}
export function selectedFrame(cfg:{in:string;idle:string;delay:number;dur:number;amp:number;speed:number}, time:number, phase=0): SelectedFrame | undefined {
 const end=cfg.in==='none'?0:cfg.delay+Math.max(.01,cfg.dur);
 if(time<end) return catalog.has(cfg.in)?{id:cfg.in,p:clamp((time-cfg.delay)/Math.max(.01,cfg.dur)),t:0,amount:1,speed:1,phase}:undefined;
 if(!catalog.has(cfg.idle))return undefined;
 const speed=Math.max(.05,cfg.speed),t=continuousTime(`${cfg.idle}|${phase}`,time,speed),shift=t-time;
 return {id:cfg.idle,p:1,t:Math.max(0,time-end+shift),amount:clamp(cfg.amp/100),speed,phase,clock:t};
}
/* ───────────── 失焦（T-L20／S-L20／P-L20） ─────────────
   每個目標：模糊的時間＝清楚的時間（以模糊一半的那一刻為分界），進出都用很長的
   smootherstep 緩動，沒有任何突然的停頓或起步。
   多個目標分成 2 組（兩個目標）或 3 組（三個以上），曲線完全相同、只錯開 1/組數 週期，
   因此上一組開始變清楚時，下一組就已經慢慢模糊起來，彼此交疊接棒。 */
const DEFOCUS_SEQ3=[0,2,1,2,0,1,0,1,2,1,0,2]; // 每 3 個一組都是完整排列，相鄰兩個不會同組
export function defocusGroup(index:number,count:number){
 const n=Math.max(1,Math.floor(count)),i=Math.max(0,Math.floor(index));
 if(n<2)return {group:0,groups:1};
 if(n===2)return {group:i%2,groups:2};
 return {group:DEFOCUS_SEQ3[i%DEFOCUS_SEQ3.length],groups:3};
}
const smoother=(v:number)=>{v=clamp(v);return v*v*v*(v*(v*6-15)+10);};
/** 一輪的秒數（模糊一半、清楚一半）。 */
export const defocusPeriod=(speed:number)=>Math.max(.5,4.2/Math.max(.05,speed));
/** 0＝完全清楚、1＝最模糊。 */
export function defocusLevel(clock:number,speed:number,group:number,groups:number){
 const RAMP=.22; // 每段漸變占一輪的比例；半模糊點在 u=0（變模糊）與 u=.5（變清楚）
 let u=clock/defocusPeriod(speed)-group/Math.max(1,groups)+.5+RAMP/2+.06; // t=0 時第一組是清楚的
 u-=Math.floor(u);
 if(u>=1-RAMP/2)return smoother((u-(1-RAMP/2))/RAMP);
 if(u<RAMP/2)return smoother((u+RAMP/2)/RAMP);
 if(u<.5-RAMP/2)return 1;
 if(u<.5+RAMP/2)return 1-smoother((u-(.5-RAMP/2))/RAMP);
 return 0;
}
const defocusOf=(frame:SelectedFrame,index:number,count:number)=>{
 const {group,groups}=defocusGroup(index,count);
 return defocusLevel(frame.clock??frame.t,frame.speed,group,groups)*frame.amount*smooth(frame.t/.6);
};
const densityOf=(ctx:CanvasRenderingContext2D)=>{const m=ctx.getTransform();return Math.max(.01,Math.hypot(m.a,m.b),Math.hypot(m.c||0,m.d||0));};
/* iOS 的 WKWebView 不一定真的會畫 Canvas filter（屬性可能不存在，或設定了卻沒效果），
   所以實際畫一個點來確認；不支援時改用縮小＋分離式高斯取樣的備援模糊。 */
let filterOK:boolean|undefined;
/** 測試用：強制指定是否走 Canvas filter。 */
export const setCanvasBlurSupportedForTest=(v:boolean|undefined)=>{filterOK=v;};
export function canvasBlurSupported(){
 if(filterOK!==undefined)return filterOK;
 filterOK=false;
 try{
  if(typeof document==='undefined')return filterOK;
  const c=document.createElement('canvas');c.width=c.height=12;
  const g=c.getContext('2d',{willReadFrequently:true}) as CanvasRenderingContext2D|null;
  if(!g||typeof (g as any).filter!=='string')return filterOK;
  g.filter='blur(2px)';g.fillStyle='#000';g.fillRect(5,5,2,2);
  filterOK=g.getImageData(2,6,1,1).data[3]>0;
 }catch{filterOK=false;}
 return filterOK;
}
let blurCanvas:HTMLCanvasElement|undefined,blurCtx:CanvasRenderingContext2D|null=null;
const halvers:HTMLCanvasElement[]=[];
/** 逐次減半用的兩張畫布（只長不縮，只用左上角） */
function halvingCanvases(size:number){
 while(halvers.length<2)halvers.push(document.createElement('canvas'));
 for(const c of halvers)if(c.width<size||c.height<size){c.width=Math.max(c.width,size);c.height=Math.max(c.height,size);}
 return halvers;
}
let blurF:Float32Array=new Float32Array(0),blurT:Float32Array=new Float32Array(0);
/** 以「螢幕像素」的高斯 σ 畫出 paint；extent 是內容在本地座標中距原點的最大距離。 */
export function paintBlurred(ctx:CanvasRenderingContext2D,deviceBlur:number,extent:number,paint:(g:CanvasRenderingContext2D)=>void,cx=0,cy=0){
 if(!(deviceBlur>.3)){paint(ctx);return;}
 /* 不使用 Canvas filter：Safari／iOS 對 ctx.filter 的半徑有上限，超過就整個忽略。
    改成真正的高斯模糊（預乘透明度、浮點運算，沒有殘影或色階）。
    出錯時退回直接畫，絕不讓一格例外把整段動畫停掉。 */
 try{gaussianOffscreen(ctx,deviceBlur,extent,paint,cx,cy);}catch{paint(ctx);}
}
function gaussianOffscreen(ctx:CanvasRenderingContext2D,sigma:number,extent:number,paint:(g:CanvasRenderingContext2D)=>void,cx=0,cy=0){
 if(typeof document==='undefined'){paint(ctx);return;}
 /* 抖動的成因與做法：
    ① 縮小倍率 k 若連續變化，取樣格子每一格都相對內容滑動；
    ② 就算 k 取整數，一次大比例縮小時瀏覽器會用 mipmap，不同比例的 mipmap 有不同的
       次像素偏移（實測同一顆圓在幾個 k 之間來回跳 1～3 個螢幕像素）；路徑的反鋸齒
       在小緩衝裡也有垂直方向的取樣偏差。
    現在：內容一律先以「螢幕原生解析度」畫在對齊螢幕像素的格子上，再只用「剛好一半」
    的縮小一路縮到 1/k（每次都是 2×2 平均，重心完全不動），k 只取 1、2、4、8…。
    同一個 k 底下格子與內容的對應固定不變；換檔時兩邊都是無偏的平均，看不出位移。 */
 const density=densityOf(ctx),reach=extent*density+sigma*3.2;
 let k=1;while(k*2<=Math.max(1,sigma/1.5))k*=2;
 while(2*Math.ceil(reach/k)>256)k*=2;
 const half=Math.max(1,Math.ceil(reach/k)),N=half*2,scale=density/k,R=half/scale,sb=sigma/k,M=N*k;
 if(!blurCanvas){blurCanvas=document.createElement('canvas');blurCtx=blurCanvas.getContext('2d',{willReadFrequently:true}) as CanvasRenderingContext2D|null;}
 const g=blurCtx;if(!g){paint(ctx);return;}
 if(blurCanvas.width!==N||blurCanvas.height!==N){blurCanvas.width=N;blurCanvas.height=N;}
 g.setTransform(1,0,0,1,0,0);g.globalAlpha=1;g.globalCompositeOperation='source-over';g.clearRect(0,0,N,N);
 /* 沒有旋轉時，把格子對齊到整數螢幕像素：內容反向位移同樣的量，位置不變。 */
 const mt=ctx.getTransform();let ox=0,oy=0;
 if(Math.abs(mt.b)<1e-9&&Math.abs(mt.c)<1e-9&&mt.a>0&&mt.d>0){
  const dx0=mt.a*(cx-R)+mt.e,dy0=mt.d*(cy-R)+mt.f;
  ox=(Math.round(dx0)-dx0)/mt.a;oy=(Math.round(dy0)-dy0)/mt.d;
 }
 const prep=(q:CanvasRenderingContext2D,sc:number,size:number)=>{
  q.setTransform(sc,0,0,sc,size/2-(cx+ox)*sc,size/2-(cy+oy)*sc);q.imageSmoothingEnabled=true;q.imageSmoothingQuality='high';q.globalAlpha=1;q.globalCompositeOperation='source-over';
  // 圖案的填色（花紋 pattern／漸層）、描邊設定由呼叫端事先設在 ctx 上，帶進緩衝一起畫
  q.fillStyle=ctx.fillStyle;q.strokeStyle=ctx.strokeStyle;q.lineWidth=ctx.lineWidth;q.lineJoin=ctx.lineJoin;q.lineCap=ctx.lineCap;
 };
 if(k===1||M>2048){prep(g,scale,N);paint(g);}
 else{
  const lv=halvingCanvases(M);
  let src=lv[0],size=M;const c0=src.getContext('2d')!;
  c0.setTransform(1,0,0,1,0,0);c0.clearRect(0,0,size,size);prep(c0,density,M);paint(c0);
  let i=1;
  while(size>N){
   const dst=size/2===N?blurCanvas:lv[i%2],dc=dst===blurCanvas?g:dst.getContext('2d')!;
   dc.setTransform(1,0,0,1,0,0);dc.globalAlpha=1;dc.globalCompositeOperation='source-over';
   if(dst!==blurCanvas)dc.clearRect(0,0,size/2,size/2);
   // 剛好縮一半＋雙線性＝精確的 2×2 平均（不用 mipmap，不會產生偏移）
   dc.imageSmoothingEnabled=true;dc.imageSmoothingQuality='low';
   dc.drawImage(src,0,0,size,size,0,0,size/2,size/2);
   src=dst;size/=2;i++;
  }
 }
 g.setTransform(1,0,0,1,0,0);
 const img=g.getImageData(0,0,N,N),d=img.data,len=N*N*4;
 if(blurF.length<len){blurF=new Float32Array(len);blurT=new Float32Array(len);}
 const F=blurF,T=blurT;
 for(let i=0;i<len;i+=4){const al=d[i+3]/255;F[i]=d[i]*al;F[i+1]=d[i+1]*al;F[i+2]=d[i+2]*al;F[i+3]=d[i+3];}
 const rad=Math.max(1,Math.ceil(sb*3)),w=new Float32Array(rad*2+1);
 let sum=0;for(let j=-rad;j<=rad;j++){const v=Math.exp(-(j*j)/(2*sb*sb));w[j+rad]=v;sum+=v;}
 for(let j=0;j<w.length;j++)w[j]/=sum;
 // 水平：F → T
 for(let y=0;y<N;y++){const row=y*N;for(let x=0;x<N;x++){let r=0,gg=0,b=0,a=0;
  const j0=Math.max(-rad,-x),j1=Math.min(rad,N-1-x);
  for(let j=j0;j<=j1;j++){const q=(row+x+j)*4,wt=w[j+rad];r+=F[q]*wt;gg+=F[q+1]*wt;b+=F[q+2]*wt;a+=F[q+3]*wt;}
  const o=(row+x)*4;T[o]=r;T[o+1]=gg;T[o+2]=b;T[o+3]=a;}}
 // 垂直：T → 輸出（反預乘）
 for(let y=0;y<N;y++){const j0=Math.max(-rad,-y),j1=Math.min(rad,N-1-y);for(let x=0;x<N;x++){let r=0,gg=0,b=0,a=0;
  for(let j=j0;j<=j1;j++){const q=((y+j)*N+x)*4,wt=w[j+rad];r+=T[q]*wt;gg+=T[q+1]*wt;b+=T[q+2]*wt;a+=T[q+3]*wt;}
  const o=(y*N+x)*4;
  if(a>.02){const inv=255/a;d[o]=r*inv;d[o+1]=gg*inv;d[o+2]=b*inv;d[o+3]=a;}else{d[o]=d[o+1]=d[o+2]=d[o+3]=0;}}}
 g.putImageData(img,0,0);
 ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
 ctx.drawImage(blurCanvas,cx+ox-R,cy+oy-R,2*R,2*R);
}

/** Draw in the existing object's local coordinates. No fixed-resolution frame cache. */
export function paintSelectedAnimation(ctx:CanvasRenderingContext2D, frame:SelectedFrame|undefined, width:number,height:number, paint:(g:CanvasRenderingContext2D)=>void,index=0,count=1) {
 if(!frame){paint(ctx);return;}
 const spec=catalog.get(frame.id); if(!spec){paint(ctx);return;}
 const w=Math.max(.01,width),h=Math.max(.01,height),r=Math.max(w,h)/2;
 const code=spec.code,entry=spec.phase==='entry';
 const p=clamp(frame.p*(1+.13*Math.max(0,count-1))-.13*index),q=1-(1-p)**3;
 if(entry&&p<=0)return;
 if(entry&&p>=1){paint(ctx);return;}
 const tfm=ctx.getTransform(),density=Math.max(.01,Math.hypot(tfm.a,tfm.b),Math.hypot(tfm.c || 0,tfm.d || 0));
 const a=frame.amount,en=smooth(frame.t/1.2),ph=index*2.39996+frame.phase;
 const v=frame.t*frame.speed*1.5+ph,wave=(Math.sin(v)-Math.sin(ph))*en;
 ctx.save();
 try {
  if(entry){
   // 每一個保留動畫都有自己的實作，不能再因為原實驗室編號相近就共用
   // 一段泛用分支；這也讓改名後的實際效果和按鈕名稱完全一致。
   if(code==='T-E03'||code==='S-E03'){
    ctx.globalAlpha*=smooth(p);
    paintBlurred(ctx,(1-q)*Math.min(18,Math.max(2.5,r*.12))*density,Math.hypot(w,h),paint);return;
   } else if(code==='T-E07'){
    const k=1-Math.exp(-p*7)*Math.cos(p*8);
    ctx.scale(Math.max(.001,k),Math.max(.001,k));
   } else if(code==='S-E04'){
    // 足跡逐顆直接亮起，沒有透明度或大小漸變。
   } else if(code==='S-E10'){
    ctx.rotate((1-q)*-.9);
    ctx.scale(Math.max(.001,q),Math.max(.001,q));
   }
   paint(ctx);
  } else if(code==='T-L15'){
   // 波浪 ll：重畫同一份高解析向量分層，不建立低解析動畫貼圖。
   const amplitude=r*.045*a*en;
   if(amplitude<1e-7){paint(ctx);return;}
   paintSelectedWarp(ctx,w,h,r,amplitude,v,true,paint);
  } else {
   if(code==='T-L04'){
    // 閃爍是一整個字串共用的規律亮滅，只保留速度參數。
    ctx.globalAlpha*=Math.cos(frame.t*frame.speed*3.2)>=0?1:0;
   } else if(code==='T-L01'||code==='S-L01'){
    ctx.globalAlpha*=1-a*(1-Math.cos(v))*en/2;
   } else if(code==='S-L03'){
    ctx.rotate(wave*.15*a);
   } else if(code==='S-L07'){
    ctx.scale(Math.max(.02,1-(1-Math.abs(Math.cos(v)))*.8*a*en),1);
   } else if(code==='T-L20'||code==='S-L20'){
    // 失焦：模糊半徑跟著物件大小與目前解析度（預覽／匯出一致），各組依 defocusGroup 錯開。
    const level=defocusOf(frame,index,count);
    paintBlurred(ctx,level*Math.max(3,r*.28)*density,Math.hypot(w,h)*.8,paint);return;
   }
   paint(ctx);
  }
 } finally {ctx.restore();}
}

/** Pattern instances keep their existing mask/image placement and connection anchors. */
export function selectedPatternOffset(frame:SelectedFrame|undefined, size:number) {
 if(!frame)return 0;
 // P-L02 已改成全體同步閃爍，不再改動圖案位置。
 return 0;
}
export function applySelectedPatternAppearance(ctx:CanvasRenderingContext2D,frame:SelectedFrame|undefined,size:number,x:number,y:number) {
 if(!frame)return;
 const en=smooth(frame.t/1.2),v=frame.t*frame.speed*1.5+frame.phase;
 if(frame.id==='lab-P-L07'){
  const sx=1-(1-Math.abs(Math.cos(v)))*.8*frame.amount*en;
  ctx.translate(x,y);ctx.scale(sx,1);ctx.translate(-x,-y);
 }
 // 失焦不在這裡設 ctx.filter（iOS 不支援），改由 paintSelectedPattern 做真正的高斯模糊。
}
/** 畫一顆圖案：失焦時先畫進以這顆為中心的緩衝再高斯模糊貼回（跟文字／符號同一套），
    其他動畫照舊套外觀後直接畫。draw 只能畫在傳進來的 g 上。 */
export function paintSelectedPattern(ctx:CanvasRenderingContext2D,frame:SelectedFrame|undefined,size:number,x:number,y:number,draw:(g:CanvasRenderingContext2D)=>void){
 if(frame?.id==='lab-P-L20'){
  const level=defocusOf(frame,frame.slot??0,frame.slots??1);
  paintBlurred(ctx,level*Math.max(3,size*.14)*densityOf(ctx),size,draw,x,y);
  return;
 }
 applySelectedPatternAppearance(ctx,frame,size,x,y);
 draw(ctx);
}
export function selectedPatternGlow(frame:SelectedFrame|undefined) {
 if(frame?.id!=='lab-P-L04')return 0;
 // 幅度最大值為原本的兩倍（0～2），glowInto 會把超過 1 的部分再疊一層
 return (1+Math.sin(frame.t*frame.speed*1.5+frame.phase))*.5*frame.amount*2*smooth(frame.t/1.2);
}
