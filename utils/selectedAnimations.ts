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
   節奏照「呼吸」：一條連續的餘弦，在清楚與模糊之間不停來回，兩端都不特別停留。
   多個目標分成 2 組（兩個目標）或 3 組（三個以上），曲線相同、只錯開 1/組數 週期。 */
const DEFOCUS_SEQ3=[0,2,1,2,0,1,0,1,2,1,0,2]; // 每 3 個一組都是完整排列，相鄰兩個不會同組
export function defocusGroup(index:number,count:number){
 const n=Math.max(1,Math.floor(count)),i=Math.max(0,Math.floor(index));
 if(n<2)return {group:0,groups:1};
 if(n===2)return {group:i%2,groups:2};
 return {group:DEFOCUS_SEQ3[i%DEFOCUS_SEQ3.length],groups:3};
}
/** 一輪的秒數（模糊一半、清楚一半）。 */
export const defocusPeriod=(speed:number)=>Math.max(.5,Math.PI*2/1.5/Math.max(.05,speed));
/** 0＝完全清楚、1＝最模糊。 */
export function defocusLevel(clock:number,speed:number,group:number,groups:number){
 /* 跟「呼吸」同一條曲線：(1−cos)/2，同樣的週期（速度 1 時約 4.2 秒，呼吸是 2π/1.5）。
    一直在清楚與模糊之間來回，不會特別停在任何一端；t=0 時第一組是清楚的。
    各組同一條曲線、錯開 1/組數 週期。 */
 const u=clock/defocusPeriod(speed)-group/Math.max(1,groups);
 return (1-Math.cos(u*Math.PI*2))/2;
}
const defocusOf=(frame:SelectedFrame,index:number,count:number)=>{
 const {group,groups}=defocusGroup(index,count);
 // 模糊半徑直接跟曲線成正比（不再加任何次方），節奏與呼吸的明暗完全一樣
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
/** 方框（中間權重 1、兩端各 fa）達到指定變異數時的整數半徑 r0 與端點權重 fa */
function boxForVariance(v:number):[number,number]{
 let r0=0;
 // 半徑 r0 的整數方框變異數 = r0(r0+1)/3；找到最大的 r0 讓它不超過 v
 while((r0+1)*(r0+2)/3<=v)r0++;
 const S=r0*(r0+1)*(2*r0+1)/3,den=2*(r0+1)*(r0+1)-2*v;
 const fa=den>1e-9?Math.max(0,Math.min(1,(v*(2*r0+1)-S)/den)):0;
 return [r0,fa];
}
/** 一個方向的方框模糊：step 是同一行相鄰像素的間距、lineStep 是換行的間距（皆以 float 計）。
    範圍外視為透明。四個通道一起做。 */
function boxBlur(src:Float32Array,dst:Float32Array,r0:number,fa:number,step:number,lineStep:number,l0:number,l1:number,p0:number,p1:number){
 const inv=1/(2*r0+1+2*fa);
 for(let line=l0;line<=l1;line++){
  const base=line*lineStep;
  let s0=0,s1=0,s2=0,s3=0;
  for(let j=p0;j<=p0+r0&&j<=p1;j++){const q=base+j*step;s0+=src[q];s1+=src[q+1];s2+=src[q+2];s3+=src[q+3];}
  for(let x=p0;x<=p1;x++){
   let e0=0,e1=0,e2=0,e3=0;
   const lo=x-r0-1,hi=x+r0+1;
   if(fa>0){
    if(lo>=p0){const q=base+lo*step;e0+=src[q];e1+=src[q+1];e2+=src[q+2];e3+=src[q+3];}
    if(hi<=p1){const q=base+hi*step;e0+=src[q];e1+=src[q+1];e2+=src[q+2];e3+=src[q+3];}
   }
   const o=base+x*step;
   dst[o]=(s0+fa*e0)*inv;dst[o+1]=(s1+fa*e1)*inv;dst[o+2]=(s2+fa*e2)*inv;dst[o+3]=(s3+fa*e3)*inv;
   if(hi<=p1){const q=base+hi*step;s0+=src[q];s1+=src[q+1];s2+=src[q+2];s3+=src[q+3];}
   const out=x-r0;if(out>=p0){const q=base+out*step;s0-=src[q];s1-=src[q+1];s2-=src[q+2];s3-=src[q+3];}
  }
 }
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
 const kSigma=k;   // 只看模糊量決定的倍率（還沒因為緩衝太大而加倍）
 while(2*Math.ceil(reach/k)>256)k*=2;
 const mt=ctx.getTransform();
 /* 模糊很小（k=1）時：緩衝直接用「螢幕的像素格子」—— 用跟畫面完全相同的變換把內容畫進去，
    再一個像素對一個像素貼回去，不經過任何縮放取樣。模糊趨近 0 時就跟直接畫完全一樣，
    快要變清楚的那一刻不會再「啪」地跳一下（舊版緩衝會多經過兩次取樣，本身就有一點糊，
    一切換回直接畫就突然變清楚）。 */
 let exact=false,ix0=0,iy0=0,NE=0;
 /* 注意：要看 kSigma，不能看 k。字形外框一大，上面那行就會為了限制緩衝大小把 k 加倍，
    連極小的模糊都變成半解析度 —— 那正是快清楚時的「斷層」。這條路自己限制大小。
    只在模糊小於 1.5 像素時走這條：再大的模糊已經蓋過半解析度的那一點糊，不必付全解析度的成本。 */
 if(kSigma===1&&sigma<1.5){
  const Rl=extent+sigma*3.2/density,xs:number[]=[],ys:number[]=[];
  for(const [lx,ly] of [[cx-Rl,cy-Rl],[cx+Rl,cy-Rl],[cx-Rl,cy+Rl],[cx+Rl,cy+Rl]]){xs.push(mt.a*lx+mt.c*ly+mt.e);ys.push(mt.b*lx+mt.d*ly+mt.f);}
  ix0=Math.floor(Math.min(...xs));iy0=Math.floor(Math.min(...ys));
  NE=Math.max(2,Math.ceil(Math.max(...xs))-ix0,Math.ceil(Math.max(...ys))-iy0);
  exact=NE<=1024;
 }
 if(exact)k=1;
 /* 縮小 k 倍再放大回來本身就帶一點糊（變異數約 C×(k²−1) 螢幕像素²）。從要求的模糊扣掉這部分，
    整體模糊量才會跟全解析度一樣，在不同 k 之間、以及跟全解析度路徑交接時都不會跳。 */
 const C=.19;
 const half=Math.max(1,Math.ceil(reach/k)),N=exact?NE:half*2,scale=density/k,R=half/scale,sb=Math.sqrt(Math.max(0,sigma*sigma-C*(k*k-1)))/k,M=N*k;
 if(!blurCanvas){blurCanvas=document.createElement('canvas');blurCtx=blurCanvas.getContext('2d',{willReadFrequently:true}) as CanvasRenderingContext2D|null;}
 const g=blurCtx;if(!g){paint(ctx);return;}
 if(blurCanvas.width!==N||blurCanvas.height!==N){blurCanvas.width=N;blurCanvas.height=N;}
 g.setTransform(1,0,0,1,0,0);g.globalAlpha=1;g.globalCompositeOperation='source-over';g.clearRect(0,0,N,N);
 /* 沒有旋轉時，把格子對齊到整數螢幕像素：內容反向位移同樣的量，位置不變。 */
 let ox=0,oy=0;
 if(Math.abs(mt.b)<1e-9&&Math.abs(mt.c)<1e-9&&mt.a>0&&mt.d>0){
  const dx0=mt.a*(cx-R)+mt.e,dy0=mt.d*(cy-R)+mt.f;
  ox=(Math.round(dx0)-dx0)/mt.a;oy=(Math.round(dy0)-dy0)/mt.d;
 }
 const prep=(q:CanvasRenderingContext2D,sc:number,size:number)=>{
  q.setTransform(sc,0,0,sc,size/2-(cx+ox)*sc,size/2-(cy+oy)*sc);q.imageSmoothingEnabled=true;q.imageSmoothingQuality='high';q.globalAlpha=1;q.globalCompositeOperation='source-over';
  // 圖案的填色（花紋 pattern／漸層）、描邊設定由呼叫端事先設在 ctx 上，帶進緩衝一起畫
  q.fillStyle=ctx.fillStyle;q.strokeStyle=ctx.strokeStyle;q.lineWidth=ctx.lineWidth;q.lineJoin=ctx.lineJoin;q.lineCap=ctx.lineCap;
 };
 if(exact){
  g.setTransform(mt.a,mt.b,mt.c,mt.d,mt.e-ix0,mt.f-iy0);g.imageSmoothingEnabled=ctx.imageSmoothingEnabled;g.imageSmoothingQuality=ctx.imageSmoothingQuality;
  g.globalAlpha=1;g.globalCompositeOperation='source-over';
  g.fillStyle=ctx.fillStyle;g.strokeStyle=ctx.strokeStyle;g.lineWidth=ctx.lineWidth;g.lineJoin=ctx.lineJoin;g.lineCap=ctx.lineCap;
  paint(g);
 }
 else if(k===1||M>2048){prep(g,scale,N);paint(g);}
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
 /* 只處理「有墨水的範圍＋模糊擴散得到的距離」：緩衝是照最壞情況（旋轉後外接框＋邊界）
    開的，實際字形通常只佔一小塊，外面全是透明，不必跑。結果與整張計算完全相同。 */
 let minX=N,minY=N,maxX=-1,maxY=-1;
 for(let y=0;y<N;y++){const row=y*N*4;for(let x=0;x<N;x++){if(d[row+x*4+3]){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}}}
 if(maxX<0)return;
 /* 小模糊（全解析度路徑）一次方框就夠：模糊量相同，形狀差異看不出來，成本只有三分之一。 */
 const passes=exact?1:3;
 const [r0,fa]=boxForVariance(sb*sb/passes),m=passes*(r0+1)+1;
 const x0=Math.max(0,minX-m),x1=Math.min(N-1,maxX+m),y0=Math.max(0,minY-m),y1=Math.min(N-1,maxY+m);
 for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const i=(y*N+x)*4,al=d[i+3]/255;F[i]=d[i]*al;F[i+1]=d[i+1]*al;F[i+2]=d[i+2]*al;F[i+3]=d[i+3];}
 /* 高斯＝三次方框模糊（瀏覽器的 CSS blur 也是這樣做）。以滑動總和實作，
    每個像素的成本跟模糊半徑無關；舊版直接卷積每像素要乘加最多 19×2 次，
    幾個字同時失焦就吃掉一整格的時間，拖速度滑桿時最明顯。
    方框兩端給小數權重，模糊量隨 σ 連續變化，不會一格一格跳。 */
 for(let pass=0;pass<passes;pass++){
  boxBlur(F,T,r0,fa,4,N*4,y0,y1,x0,x1);   // 水平：每一列
  boxBlur(T,F,r0,fa,N*4,4,x0,x1,y0,y1);   // 垂直：每一欄
 }
 for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
  const o=(y*N+x)*4,a=F[o+3];
  if(a>.02){const inv=255/a;d[o]=F[o]*inv;d[o+1]=F[o+1]*inv;d[o+2]=F[o+2]*inv;d[o+3]=a;}else{d[o]=d[o+1]=d[o+2]=d[o+3]=0;}
 }
 g.putImageData(img,0,0);
 if(exact){ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(blurCanvas,ix0,iy0);ctx.restore();return;}
 ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
 ctx.drawImage(blurCanvas,cx+ox-R,cy+oy-R,2*R,2*R);
}

/** Draw in the existing object's local coordinates. No fixed-resolution frame cache. */
/** box：paint 實際畫的範圍（本地座標，可省略）。給了的話模糊緩衝會剛好包住它，不必照最壞情況開大。 */
export function paintSelectedAnimation(ctx:CanvasRenderingContext2D, frame:SelectedFrame|undefined, width:number,height:number, paint:(g:CanvasRenderingContext2D)=>void,index=0,count=1,box?:{x:number;y:number;w:number;h:number}) {
 if(!frame){paint(ctx);return;}
 const spec=catalog.get(frame.id); if(!spec){paint(ctx);return;}
 const w=Math.max(.01,width),h=Math.max(.01,height),r=Math.max(w,h)/2;
 const code=spec.code,entry=spec.phase==='entry';
 /* 足跡：一顆一顆照節拍踩出來。節拍平均分在整段進場時間裡，第一顆要等一拍才出現，
    所以起始 0 的第一格畫面上什麼都沒有（舊版第一顆在第 0 格就已經亮著）。 */
 if(code==='S-E04'&&entry){
  if(frame.p<(index+1)/(Math.max(1,count)+1))return;
  paint(ctx);return;
 }
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
    const sg=level*Math.max(3,r*.28)*density;
    if(box)paintBlurred(ctx,sg,Math.hypot(box.w,box.h)/2,paint,box.x+box.w/2,box.y+box.h/2);
    else paintBlurred(ctx,sg,Math.hypot(w,h)*.8,paint);
    return;
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
