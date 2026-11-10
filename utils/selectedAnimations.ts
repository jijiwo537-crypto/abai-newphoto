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
 return {id:cfg.idle,p:1,t:Math.max(0,time-end+shift),amount:Math.max(0,Math.min(3,cfg.amp/100)),speed,phase,clock:t};  // 幅度可超過 100（共用滑桿往上延伸）
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
/* 這台裝置的畫布濾鏡實際做得到多大的模糊：Safari 對半徑有上限，超過時整個不模糊。
   實際畫一個點，量 blur(σ) 之後在 1.5σ 處還有沒有擴散到；量得到的最大值以下才用濾鏡。 */
let filterMax:number|undefined;
export const setFilterBlurMaxForTest=(v:number|undefined)=>{filterMax=v;};
export function filterBlurMax(){
 if(filterMax!==undefined)return filterMax;
 filterMax=0;
 try{
  if(!canvasBlurSupported()||typeof document==='undefined')return filterMax;
  for(const s of [4,8,16,24,32,48,64]){
   const N=Math.ceil(s*8)+8,c=document.createElement('canvas');c.width=N;c.height=8;
   const g=c.getContext('2d',{willReadFrequently:true});if(!g)break;
   g.filter=`blur(${s}px)`;g.fillStyle='#000';g.fillRect(N/2-s/2,0,s,8);g.filter='none';
   const a=g.getImageData(Math.round(N/2+1.5*s),4,1,1).data[3],b=g.getImageData(N/2,4,1,1).data[3];
   // 真正的高斯：中心的值很小、1.5σ 處約是中心的 1/3；沒模糊時中心是 255、外面是 0
   if(!(b<200&&a>0&&a>=b*.15))break;
   filterMax=s;
  }
 }catch{}
 return filterMax;
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
export function paintBlurred(ctx:CanvasRenderingContext2D,deviceBlur:number,extent:number,paint:(g:CanvasRenderingContext2D)=>void,cx=0,cy=0,cacheKey?:object,rect?:{hw:number;hh:number},strict=false){
 if(!(deviceBlur>.3)){paint(ctx);return;}
 /* 不使用 Canvas filter：Safari／iOS 對 ctx.filter 的半徑有上限，超過就整個忽略。
    改成真正的高斯模糊（預乘透明度、浮點運算，沒有殘影或色階）。
    出錯時退回直接畫，絕不讓一格例外把整段動畫停掉。 */
 try{
  /* 有身分（同一個字／圖案／圖形）的：用「預先算好的幾檔高品質模糊」，每一格只混合兩檔（見 levelBlur） */
  if(cacheKey&&(globalThis as any).__oldBlur===undefined&&levelBlur(ctx,deviceBlur,extent,paint,cx,cy,cacheKey,rect,strict))return;
  const force=(globalThis as any).__cpuBlur;
  const useMip=force===undefined?true:!force;
  if(useMip&&mipBlur(ctx,deviceBlur,extent,paint,cx,cy,cacheKey))return;
  gaussianOffscreen(ctx,deviceBlur,extent,paint,cx,cy,cacheKey);
 }catch{paint(ctx);}
}
/* 兩種模糊各有適合的裝置：畫布在 GPU 上（iPhone）時，讀回像素的 CPU 版每次都要等 GPU，
   全 GPU 版快得多；畫布在 CPU 上算（沒有顯示卡的環境）時則相反。不猜裝置，直接量「整格」的時間：
   第一次用到模糊時，兩種各用 30 格（只算真的有畫模糊的格子），比平均每格時間，之後用快的那個；
   每 2 分鐘再比一次。單看每次呼叫的耗時不準 —— 瀏覽器會把繪圖延後到之後才真正執行。 */
const blurTrial={pick:'mip' as 'mip'|'cpu',mode:'mip' as 'mip'|'cpu',running:false,used:false,lastTrial:-1e9};
/* 每格的間隔會落在固定的刻度上（例如 16.7／33.3 毫秒），中位數常常兩邊一樣；
   用去掉最慢 10% 的平均：哪一邊比較常掉到下一個刻度，平均就會反映出來。 */
const trimmedMean=(v:number[])=>{const a=[...v].sort((x,y)=>x-y);if(!a.length)return Infinity;const k=Math.max(1,Math.floor(a.length*.9));let t=0;for(let i=0;i<k;i++)t+=a[i];return t/k;};
function chooseMip(){
 const tr=blurTrial;tr.used=true;
 const now=performance.now();
 if(!tr.running&&now-tr.lastTrial>120000&&typeof requestAnimationFrame==='function'){
  /* 先暖機 10 格（第一次做貼圖等一次性成本不算），再 A、B、A、B 交替各 15 格，
     只算真的畫了模糊的格子，比兩邊的中位數：交替讓兩邊遇到一樣的情況，中位數不怕偶發的慢格。 */
  tr.running=true;tr.lastTrial=now;
  const plan:('warm'|'mip'|'cpu')[]=['warm','mip','cpu','mip','cpu'];
  const got={mip:[] as number[],cpu:[] as number[]};
  let stage=0,count=0,last=0;
  tr.mode='mip';
  const step=(t:number)=>{
   if(last&&tr.used){
    const kind=plan[stage];
    if(kind!=='warm')got[kind].push(t-last);
    if(++count>=(kind==='warm'?10:15)){
     stage++;count=0;
     if(stage>=plan.length){tr.pick=trimmedMean(got.cpu)<trimmedMean(got.mip)*.97?'cpu':'mip';tr.running=false;(globalThis as any).__abaiBlurTrial={mip:trimmedMean(got.mip),cpu:trimmedMean(got.cpu),pick:tr.pick};return;}
     tr.mode=plan[stage]==='cpu'?'cpu':'mip';
    }
   }
   last=t;tr.used=false;
   if(performance.now()-tr.lastTrial>30000){tr.running=false;return;}   // 動畫停了：不要一直等
   requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
 }
 return (tr.running?tr.mode:tr.pick)==='mip';
}
export const blurPickForTest=()=>blurTrial.pick;
void chooseMip;

/* ── 失焦：預先算好的分檔模糊 ─────────────────────────────────────────
   失焦時字／圖案本身不變，變的只有模糊量。所以：
     ① 每一檔模糊（σ 每檔大約乘 √2）只在第一次用到時算一次真正的高斯模糊（CPU、浮點、預乘透明度），之後留著；
     ② 每一格只把相鄰兩檔依變異數混合貼上（兩次 drawImage，GPU 做），不讀回像素、不重算 ——
        跟沒有失焦幾乎一樣輕。
   畫質：每一檔存的解析度讓「存起來那張自己的模糊」至少有 4 像素，放大回螢幕時是平滑的曲面，
   不會出現舊做法（把很小的縮圖直接放大）那種格子紋。模糊很小的檔就是螢幕原解析度。
   時機、程度、速度完全沒動：σ 一樣由 defocusOf 算出來，這裡只負責「把那個 σ 畫好」。 */
/** 舊的「全部作廢」介面：保留但不再使用（快取改成看內容本身，換顏色、換字時身分自然不同） */
export const bumpBlurGeneration=()=>{};
/** 失焦快取用的身分：同一個物件在不同位置／不同外觀各一份（sub 寫進會影響外觀的東西） */
const subKeys=new WeakMap<object,Map<string,object>>();
export function blurKey(owner:object,sub:string){let m=subKeys.get(owner);if(!m){m=new Map();subKeys.set(owner,m);}let k=m.get(sub);if(!k){k={};m.set(sub,k);if(m.size>8)m.delete(m.keys().next().value!);}return k;}
const idKeys=new Map<string,object>();
/** 用字串當身分（物件被拖動時 React 會換一個新物件，但內容沒變 → 沿用同一份模糊） */
export function blurKeyOf(id:string){let k=idKeys.get(id);if(!k){k={};idKeys.set(id,k);if(idKeys.size>400)idKeys.delete(idKeys.keys().next().value!);}return k;}

/* ── 失焦：預先算好、存在「物件自己座標」裡的分檔模糊 ────────────────────
   ① 每一檔（σ 每檔 ×√2）只算一次真正的高斯模糊（浮點、預乘透明度），存起來；
   ② 存的是物件自己的座標（不是螢幕座標）：拖動、旋轉、縮放預覽都直接沿用，
      畫的時候跟著當下的變換貼上去 —— 只有放大到比存的時候細很多才重做；
   ③ 每一格只把相鄰兩檔依變異數混合貼上（GPU 的 drawImage），不讀回像素、不重算；
   ④ 還沒算好的那一檔不在這一格裡算：先用已經有、最接近的那檔頂著，
      空閒時（requestIdleCallback）才把缺的補上，播放、拖動、拉滑桿都不會被卡住。
   畫質：每檔存的解析度讓「存起來那張自己的模糊」至少 4 像素 —— 放大回螢幕是平滑曲面，沒有格子紋。 */
type Lv={c:HTMLCanvasElement;x:number;y:number;w:number;h:number;bytes:number};
type Stack={key:string;d0:number;lv:Map<number,Lv>;bytes:number;used:number;paint:(g:CanvasRenderingContext2D)=>void;style:any;hw:number;hh:number;cx:number;cy:number;pending:Set<number>;up?:Stack;out?:HTMLCanvasElement;strict?:boolean};
/* 每檔 σ ×√2，相鄰兩檔依變異數連續混合：模糊量是連續變化的，不會一檔一檔地跳；檔數少，預先算的工作也少 */
const LV_RATIO=Math.SQRT2,LV_BASE=.6;
const lvSigma=(k:number)=>k<0?0:LV_BASE*Math.pow(LV_RATIO,k);
const stacks=new Map<object,Stack>();
let stackBytes=0,stackClock=0;
export const blurCacheBytesForTest=()=>stackBytes;
/* iPhone 的 WebKit 全部畫布加起來有記憶體上限（約 200～380MB，看機型），超過時新開或放大的畫布會變成空白，
   那一格圖案就整個不見＝閃一下。所以快取只留一小部分，混合用的畫布也不留比需要大的尺寸。 */
const STACK_BUDGET=56*1024*1024;
const freeStack=(k:object)=>{const st=stacks.get(k);if(!st)return;st.lv.forEach(l=>{l.c.width=l.c.height=0;});if(st.out)st.out.width=st.out.height=0;stackBytes-=st.bytes;stacks.delete(k);};
const evictStacks=(keep:object)=>{while(stackBytes>STACK_BUDGET&&stacks.size>1){let old:object|null=null,u=Infinity;stacks.forEach((st,k)=>{if(k!==keep&&st.used<u){u=st.used;old=k;}});if(old)freeStack(old);else break;}};
const budget={at:-1e9,left:0};
/** 一次真正的高斯模糊（三次框模糊，預乘透明度、浮點）：直接在 ImageData 上做 */
function gaussInPlace(d:ImageData,sigma:number){
 if(sigma<.2)return;
 const w=d.width,h=d.height,n=w*h,px=d.data;
 const F=new Float32Array(n*4),T=new Float32Array(n*4);
 for(let i=0;i<n;i++){const a=px[i*4+3]/255;F[i*4]=px[i*4]*a;F[i*4+1]=px[i*4+1]*a;F[i*4+2]=px[i*4+2]*a;F[i*4+3]=px[i*4+3];}
 const wIdeal=Math.sqrt(12*sigma*sigma/3+1);let wl=Math.floor(wIdeal);if(wl%2===0)wl--;const wu=wl+2;
 const m=Math.round((12*sigma*sigma-3*wl*wl-4*3*wl-3*3)/(-4*wl-4));
 const radii=[0,1,2].map(i=>((i<m?wl:wu)-1)/2);
 const pass=(src:Float32Array,dst:Float32Array,r:number,horiz:boolean)=>{
  const len=horiz?w:h,lines=horiz?h:w,step=horiz?4:w*4,ls=horiz?w*4:4,inv=1/(2*r+1);
  for(let l=0;l<lines;l++){const base=l*ls;
   for(let c=0;c<4;c++){let acc=0;
    for(let j=0;j<=r&&j<len;j++)acc+=src[base+j*step+c];
    for(let i=0;i<len;i++){dst[base+i*step+c]=acc*inv;const add=i+r+1,sub=i-r;if(add<len)acc+=src[base+add*step+c];if(sub>=0)acc-=src[base+sub*step+c];}
   }
  }
 };
 let a=F,b=T;
 for(const r of radii){if(r<1)continue;pass(a,b,r,true);pass(b,a,r,false);}
 for(let i=0;i<n;i++){const al=a[i*4+3];px[i*4+3]=al;if(al>.5){const k=255/al;px[i*4]=a[i*4]*k;px[i*4+1]=a[i*4+1]*k;px[i*4+2]=a[i*4+2]*k;}else{px[i*4]=px[i*4+1]=px[i*4+2]=0;}}
}
/** 第 k 檔：在物件自己座標裡、以密度 d0（每單位幾個螢幕像素）存一張模糊好的圖 */
function buildLevel(st:Stack,k:number):Lv|null{
 const sigma=lvSigma(k),d0=st.d0;               // σ 以「d0 密度下的螢幕像素」計
 let s=1;while(sigma*s/2>=4&&s>1/64)s/=2;        // 存的解析度（2 的次方），自己的模糊至少 4 像素
 /* 圖案（strict）每一檔都用同一個解析度：iPhone 把縮小存的檔放大貼回時，位置會偏半個存檔像素，
    存得越小偏越多。各檔解析度不同的話，換檔那一格圖案就往右跳一下（每顆照自己的失焦節奏跳）。
    圖案很小，全部用原解析度也不佔多少記憶體。 */
 if(st.strict)s=1;
 const padL=(sigma*3.2+2)/d0;                    // 邊界留白（物件座標）
 const x=st.cx-st.hw-padL,y=st.cy-st.hh-padL,wL=2*(st.hw+padL),hL=2*(st.hh+padL);
 const W=Math.max(1,Math.ceil(wL*d0*s)),H=Math.max(1,Math.ceil(hL*d0*s));
 if(W*H>4e6)return null;
 /* 貼回去的大小要剛好等於畫布的像素格（W÷r），不能用取整前的寬度：
    不然每一檔被拉伸的比例都差一點點，換檔時物件就會抖一下、位移一下 */
 const c=document.createElement('canvas');c.width=W;c.height=H;
 const g=c.getContext('2d',{willReadFrequently:true});
 if(!g){c.width=c.height=0;return null;}
 const r=d0*s;g.setTransform(r,0,0,r,-x*r,-y*r);
 g.imageSmoothingEnabled=true;g.imageSmoothingQuality='high';
 Object.assign(g,st.style);
 st.paint(g);
 if(sigma>0){g.setTransform(1,0,0,1,0,0);const d=g.getImageData(0,0,W,H);gaussInPlace(d,sigma*s);g.putImageData(d,0,0);}
 return {c,x,y,w:W/r,h:H/r,bytes:W*H*4};
}
/* 空閒時補算缺的檔：一次一檔，量時間，超過就留給下一次空閒 */
const queue:{st:Stack;k:number;key:object;up?:boolean}[]=[];
let idleOn=false;
const ric:(f:()=>void)=>void=(f)=>{const w=globalThis as any;if(typeof w.requestIdleCallback==='function')w.requestIdleCallback(f,{timeout:60});else setTimeout(f,16);};
function pump(){
 idleOn=false;const t0=performance.now();
 while(queue.length&&performance.now()-t0<5){
  const {st,k,key,up}=queue.shift()!;st.pending.delete(k);
  const cur=stacks.get(key);
  if(up?(!cur||cur.up!==st):cur!==st)continue;
  if(st.lv.has(k))continue;
  const l=buildLevel(st,k);if(!l)continue;
  st.lv.set(k,l);st.bytes+=l.bytes;if(!up){stackBytes+=l.bytes;evictStacks(key);}
 }
 if(queue.length&&!idleOn){idleOn=true;ric(pump);}
}
function wantOn(st:Stack,k:number,key:object){if(k<0||st.lv.has(k)||st.pending.has(k))return;st.pending.add(k);queue.push({st,k,key,up:true});if(!idleOn){idleOn=true;ric(pump);}}
function want(st:Stack,k:number,key:object){if(k<0||st.lv.has(k)||st.pending.has(k))return;st.pending.add(k);queue.push({st,k,key});if(!idleOn){idleOn=true;ric(pump);}}
function levelBlur(ctx:CanvasRenderingContext2D,sigma:number,extent:number,paint:(g:CanvasRenderingContext2D)=>void,cx:number,cy:number,cacheKey:object,rect?:{hw:number;hh:number},strict=false):boolean{
 const hw=rect?.hw??extent,hh=rect?.hh??extent;
 if(typeof document==='undefined')return false;
 const mt=ctx.getTransform(),density=Math.max(.01,Math.hypot(mt.a,mt.b),Math.hypot(mt.c,mt.d));
 const key=`${hw.toFixed(2)},${hh.toFixed(2)},${cx.toFixed(2)},${cy.toFixed(2)}`;
 let st=stacks.get(cacheKey);
 if(!st||st.key!==key){
  if(st)freeStack(cacheKey);
  st={key,d0:density*1.15,lv:new Map(),bytes:0,used:0,paint,style:{},hw,hh,cx,cy,pending:new Set(),strict};stacks.set(cacheKey,st);
 }
 /* 預覽放大很多（存的密度不夠細）：不在這一格重做 —— 先繼續用手上這一份（放大貼上，模糊的東西放大看不出差別），
    同時在空閒時間準備一份更細的；需要的那幾檔都好了才換過去。捏合縮放時不會一直重做、不會卡 */
 /* strict（圖案）：圖案本身與遮罩上的洞是兩份快取，必須每一格用同一檔 —— 不在背景換成更細的版本（各自換的時間不同，那一格兩邊就對不上＝閃一下） */
 if(!strict&&density>st.d0*1.8){
  if(!st.up||density>st.up.d0*1.8){st.up={key,d0:density*1.15,lv:new Map(),bytes:0,used:0,paint,style:{},hw,hh,cx,cy,pending:new Set()};}
  const up=st.up;up.paint=paint;
  const s1=sigma*up.d0/density;let k1=-1;while(lvSigma(k1+1)<=s1&&k1<30)k1++;
  wantOn(up,k1,cacheKey);wantOn(up,k1+1,cacheKey);
  if((k1<0||up.lv.has(k1))&&up.lv.has(k1+1)){
   const old=st;freeStack(cacheKey);up.used=old.used;stacks.set(cacheKey,up);
   stackBytes+=up.bytes;st=up;
  }
 } else if(st.up&&density<=st.d0*1.8){st.up.lv.forEach(l=>{l.c.width=l.c.height=0;});st.up=undefined;}
 st.paint=paint;
 st.style={fillStyle:ctx.fillStyle,strokeStyle:ctx.strokeStyle,lineWidth:ctx.lineWidth,lineJoin:ctx.lineJoin,lineCap:ctx.lineCap};
 st.used=++stackClock;
 const s0=sigma*st.d0/density;                   // 換算成存的時候的密度
 let k=-1;while(lvSigma(k+1)<=s0&&k<30)k++;
 const lo=lvSigma(k),hi=lvSigma(k+1);let t=Math.max(0,Math.min(1,(s0*s0-lo*lo)/(hi*hi-lo*lo)));
 // 需要的兩檔＋往上再一檔先排進空閒時間（模糊變強時下一格就有）
 want(st,k,cacheKey);want(st,k+1,cacheKey);want(st,k+2,cacheKey);want(st,k+3,cacheKey);
 let kA=k,kB=k+1;
 const has=(i:number)=>i<0||st!.lv.has(i);
 /* 這一格要用的兩檔還沒好：在這一格裡用一小段固定的時間（全部物件合計每格約 2 毫秒）先做出來，
    不只等空閒時間 —— 播放中手機很少有空閒，等不到的話就會在「只有一檔」與「兩檔混合」之間跳（看起來像在閃、在抖） */
 for(const i of [kA,kB]){
  if(has(i))continue;
  const now=performance.now();
  if(now-budget.at>12){budget.at=now;budget.left=2;}
  // strict：缺的那檔立刻做（每檔只做一次），保證兩份快取每一格用的檔完全相同
  if(budget.left<=0&&!strict)break;
  const l=buildLevel(st,i);budget.left-=performance.now()-now;
  if(!l)break;st.lv.set(i,l);st.bytes+=l.bytes;stackBytes+=l.bytes;st.pending.delete(i);
 }
 if(!has(kB)){ // 上面那檔還沒好：只用下面那檔（或往下找最近的）
  t=0;while(kA>=0&&!st.lv.has(kA))kA--;
 } else if(!has(kA)){t=1;}
 if(kA<0&&t===0&&k>=0&&!has(kB)){
  // 完全還沒有任何一檔（第一次）：同步做最需要的那一檔，只有這一次
  const l=buildLevel(st,Math.max(0,k));if(!l){freeStack(cacheKey);return false;}
  st.lv.set(Math.max(0,k),l);st.bytes+=l.bytes;stackBytes+=l.bytes;kA=Math.max(0,k);t=0;
 }
 const drawLv=(g:CanvasRenderingContext2D,i:number,alpha:number)=>{
  if(alpha<=1e-3)return;g.globalAlpha=alpha;
  if(i<0){paint(g);return;}
  const l=st!.lv.get(i)!;g.drawImage(l.c,0,0,l.c.width,l.c.height,l.x,l.y,l.w,l.h);
 };
 ctx.save();ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='low';
 const a0=ctx.globalAlpha;
 if(t<=1e-3||t>=1-1e-3){const i=t>=1-1e-3?kB:kA;ctx.globalAlpha=a0;if(i<0){ctx.restore();ctx.save();paint(ctx);ctx.restore();return true;}drawLv(ctx,i,a0);ctx.restore();return true;}
 /* 兩檔混合：在一張螢幕對齊的小畫布上用 'lighter' 疊（＝精確的加權平均），再貼回去 */
 const L=st.lv.get(kB)!;   // 範圍以比較大的那檔為準
 /* 混合用的畫布用「存的那檔」的解析度，不是螢幕解析度：放大很多倍時螢幕上這塊可能上百萬像素，
    每個物件每一格都清一次、疊兩次、再貼一次，iPhone 就卡；存的檔本身沒有更多細節，用它的解析度混合畫質一樣。 */
 const resOf=(i:number)=>{const l=st!.lv.get(i);return l?l.c.width/l.w:density;};
 const rr=Math.max(.01,Math.min(density,kA<0?density:resOf(kA),Math.max(resOf(kB),resOf(kA))));
 const W=Math.ceil(L.w*rr),H=Math.ceil(L.h*rr);
 if(W<=0||H<=0||W*H>8e6){ctx.restore();return false;}
 /* 每個物件自己一張混合用的畫布（不共用）：同一格裡把共用畫布畫完、貼出去、清掉再給下一個用，
    iPhone 的 Safari 偶爾會貼成「已經清掉的那張」→ 圖案一閃就不見 */
 const out=st.out??=document.createElement('canvas');
 if(out.width<W||out.height<H||out.width*out.height>2*W*H+65536){out.width=W;out.height=H;}
 const goc=out.getContext('2d');if(!goc){ctx.restore();return false;}
 const go=goc;
 go.setTransform(1,0,0,1,0,0);go.globalAlpha=1;go.globalCompositeOperation='source-over';go.clearRect(0,0,W,H);
 go.setTransform(rr,0,0,rr,-L.x*rr,-L.y*rr);
 go.imageSmoothingEnabled=true;go.imageSmoothingQuality='low';go.globalCompositeOperation='lighter';
 Object.assign(go,st.style);
 drawLv(go,kA,1-t);drawLv(go,kB,t);
 go.globalAlpha=1;go.globalCompositeOperation='source-over';
 ctx.globalAlpha=a0;ctx.drawImage(out,0,0,W,H,L.x,L.y,W/rr,H/rr);
 ctx.restore();
 return true;
}

/* ── 全 GPU 的模糊（不讀回像素）──────────────────────────────────────
   iPhone 的畫布在 GPU 上，getImageData 每次都要等 GPU 畫完再整塊搬回 CPU；
   每個失焦中的字每一格都做一次，動畫播放、拖動、縮放（連暫停時重畫也一樣）就嚴重卡頓。
   這裡只用 drawImage：
     ① 用跟畫面完全相同的變換，把內容畫在「螢幕像素格子」上（L0，模糊趨近 0 時就跟直接畫一樣）；
     ② 每次剛好縮一半（2×2 平均）做出 L1、L2…；
     ③ 第 n 層每次放大一倍、一路放大回原尺寸，得到模糊量 σn 的影像；
     ④ 要求的 σ 落在 σn 與 σn+1 之間時，依變異數線性混合兩層（'lighter' 疊加＝精確的加權平均），
        所以模糊量是連續的，沒有一檔一檔的跳動。 */
const MIP_SIGMA=(n:number)=>n<=0?0:MIP_SIGMA_BASE*Math.pow(2,n);
let MIP_SIGMA_BASE=.74;          // 經實測校正（見 calib）：第 n 層的等效 σ ≈ 基準×2ⁿ 像素
export const setMipSigmaBaseForTest=(v:number)=>{MIP_SIGMA_BASE=v;};
const MAX_LEVELS=8;
/* 每個字（貼圖）一份金字塔快取：失焦時字本身不變、只有模糊量在變，
   所以每一格只要從快取取兩層放大混合，不必重畫、重縮。
   只要縮放／旋轉（變換的線性部分）沒變就沿用；移動只是平移，最後貼上時跟著位移。 */
type Pyr={key:string;levels:number;W:number;H:number;ix0:number;iy0:number;e0:number;f0:number;L:HTMLCanvasElement[];bytes:number;used:number};
const pyrCache=new Map<object,Pyr>();
let pyrBytes=0,pyrClock=0;
const PYR_BUDGET=96*1024*1024;
const freePyr=(k:object)=>{const p=pyrCache.get(k);if(!p)return;p.L.forEach(c=>{c.width=c.height=0;});pyrBytes-=p.bytes;pyrCache.delete(k);};
const evictPyr=()=>{while(pyrBytes>PYR_BUDGET&&pyrCache.size){let old:object|null=null,u=Infinity;pyrCache.forEach((p,k)=>{if(p.used<u){u=p.used;old=k;}});if(old)freePyr(old);else break;}};
let scratchPyr:HTMLCanvasElement[]=[];
let mipOut:HTMLCanvasElement|undefined;
const sizeCanvas=(c:HTMLCanvasElement,w:number,h:number)=>{if(c.width!==w||c.height!==h){c.width=w;c.height=h;}return c;};
const prep2d=(g:CanvasRenderingContext2D)=>{g.setTransform(1,0,0,1,0,0);g.globalAlpha=1;g.globalCompositeOperation='source-over';g.imageSmoothingEnabled=true;g.imageSmoothingQuality='low';};
/** 平滑的縮一半（Kawase）：四個斜角各偏一個來源像素、各取 2×2 平均再平均，結果沒有方塊感 */
function kawaseDown(src:HTMLCanvasElement,sw:number,sh:number,dst:HTMLCanvasElement){
 const w=sw>>1,h=sh>>1,g=sizeCanvas(dst,w,h).getContext('2d')!;
 prep2d(g);g.clearRect(0,0,w,h);g.globalCompositeOperation='lighter';g.globalAlpha=.25;
 for(const [ox,oy] of [[-.5,-.5],[.5,-.5],[-.5,.5],[.5,.5]])g.drawImage(src,0,0,sw,sh,ox,oy,w,h);
 g.globalAlpha=1;g.globalCompositeOperation='source-over';
}
function mipBlur(ctx:CanvasRenderingContext2D,sigma:number,extent:number,paint:(g:CanvasRenderingContext2D)=>void,cx:number,cy:number,cacheKey?:object):boolean{
 if(typeof document==='undefined')return false;
 let n=0;while(MIP_SIGMA(n+1)<=sigma&&n<MAX_LEVELS-1)n++;
 const lo=MIP_SIGMA(n),hi=MIP_SIGMA(n+1),t=Math.max(0,Math.min(1,(sigma*sigma-lo*lo)/(hi*hi-lo*lo)));
 const mt=ctx.getTransform();
 /* 快取只準備目前用得到的層數（多留一層）；模糊變更強、需要更多層時才重建一次，
    跑過一輪之後就夠用，不會為了最壞情況開一張超大的畫布。 */
 const key=`${mt.a.toFixed(4)},${mt.b.toFixed(4)},${mt.c.toFixed(4)},${mt.d.toFixed(4)},${extent.toFixed(2)},${cx.toFixed(2)},${cy.toFixed(2)}`;
 let pyr=cacheKey?pyrCache.get(cacheKey):undefined;
 const need=Math.min(MAX_LEVELS,n+(cacheKey?2:1));
 if(!pyr||pyr.key!==key||pyr.levels<n+1){
  const levels=Math.max(need,pyr&&pyr.key===key?pyr.levels:0),S=1<<levels;
  const P=Math.ceil(3*MIP_SIGMA(levels))+S;
  if(cacheKey)freePyr(cacheKey);
  const xs:number[]=[],ys:number[]=[];
  for(const [lx,ly] of [[cx-extent,cy-extent],[cx+extent,cy-extent],[cx-extent,cy+extent],[cx+extent,cy+extent]]){xs.push(mt.a*lx+mt.c*ly+mt.e);ys.push(mt.b*lx+mt.d*ly+mt.f);}
  const ix0=Math.floor((Math.min(...xs)-P)/S)*S,iy0=Math.floor((Math.min(...ys)-P)/S)*S;
  const W=Math.ceil((Math.ceil(Math.max(...xs))+P-ix0)/S)*S,H=Math.ceil((Math.ceil(Math.max(...ys))+P-iy0)/S)*S;
  if(W*H>6e6)return false;
  const L:HTMLCanvasElement[]=cacheKey?[]:scratchPyr;
  const canvasAt=(i:number)=>{while(L.length<=i)L.push(document.createElement('canvas'));return L[i];};
  const L0=sizeCanvas(canvasAt(0),W,H),g0=L0.getContext('2d')!;
  prep2d(g0);g0.clearRect(0,0,W,H);
  g0.setTransform(mt.a,mt.b,mt.c,mt.d,mt.e-ix0,mt.f-iy0);g0.imageSmoothingEnabled=ctx.imageSmoothingEnabled;g0.imageSmoothingQuality=ctx.imageSmoothingQuality;
  g0.fillStyle=ctx.fillStyle;g0.strokeStyle=ctx.strokeStyle;g0.lineWidth=ctx.lineWidth;g0.lineJoin=ctx.lineJoin;g0.lineCap=ctx.lineCap;
  paint(g0);
  for(let i=1;i<=levels;i++)kawaseDown(L[i-1],W>>(i-1),H>>(i-1),canvasAt(i));
  let bytes=0;for(let i=0;i<=levels;i++)bytes+=(W>>i)*(H>>i)*4;
  pyr={key,levels,W,H,ix0,iy0,e0:mt.e,f0:mt.f,L,bytes,used:0};
  if(cacheKey){pyrCache.set(cacheKey,pyr);pyrBytes+=bytes;evictPyr();}
 }
 pyr.used=++pyrClock;
 const {W,H,L}=pyr;
 /* 兩層各自用高品質放大到原尺寸，依變異數混合（'lighter' 疊加＝精確的加權平均） */
 mipOut??=document.createElement('canvas');
 const out=sizeCanvas(mipOut,Math.max(mipOut.width,W),Math.max(mipOut.height,H)),go=out.getContext('2d')!;
 prep2d(go);go.clearRect(0,0,W,H);go.imageSmoothingQuality='high';go.globalCompositeOperation='lighter';
 const draw=(m:number,alpha:number)=>{if(alpha<=0)return;go.globalAlpha=alpha;go.drawImage(L[m],0,0,W>>m,H>>m,0,0,W,H);};
 draw(n,1-t);draw(Math.min(n+1,L.length-1),t);
 go.globalAlpha=1;go.globalCompositeOperation='source-over';
 // 移動時沿用快取，只把結果跟著平移
 ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(out,0,0,W,H,pyr.ix0+(mt.e-pyr.e0),pyr.iy0+(mt.f-pyr.f0),W,H);ctx.restore();
 return true;
}
/* CPU 模糊的「上一張」快取：暫停時模糊量不變，拖動、重畫都直接沿用（平移貼上），不再重算。 */
const cpuLast=new WeakMap<object,{key:string;e0:number;f0:number;canvas:HTMLCanvasElement;x:number;y:number}>();
const cpuSeen=new WeakMap<object,string>();
function gaussianOffscreen(ctx:CanvasRenderingContext2D,sigma:number,extent:number,paint:(g:CanvasRenderingContext2D)=>void,cx=0,cy=0,cacheKey?:object){
 if(typeof document==='undefined'){paint(ctx);return;}
 const mt0=ctx.getTransform();
 const ckey=cacheKey?`${sigma.toFixed(3)},${mt0.a.toFixed(4)},${mt0.b.toFixed(4)},${mt0.c.toFixed(4)},${mt0.d.toFixed(4)},${extent.toFixed(2)},${cx.toFixed(2)},${cy.toFixed(2)}`:'';
 if(cacheKey){
  const hit=cpuLast.get(cacheKey);
  if(hit&&hit.key===ckey){ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(hit.canvas,hit.x+(mt0.e-hit.e0),hit.y+(mt0.f-hit.f0));ctx.restore();return;}
 }
 /* 沒命中：同一個模糊狀態連續出現第二次（＝暫停中）才建立快取；播放中每一格都不同，直接算、不多配置畫布 */
 const seen=cacheKey?cpuSeen.get(cacheKey):undefined;
 if(cacheKey)cpuSeen.set(cacheKey,ckey);
 if(cacheKey&&seen===ckey){
  const cv=document.createElement('canvas');
  const r=renderCpuBlurToDevice(ctx,sigma,extent,paint,cx,cy,cv);
  if(r){cpuLast.set(cacheKey,{key:ckey,e0:mt0.e,f0:mt0.f,canvas:cv,x:r.x,y:r.y});ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(cv,r.x,r.y);ctx.restore();return;}
 }
 gaussianCore(ctx,sigma,extent,paint,cx,cy);
}
/** 把 CPU 模糊的結果畫進一張「螢幕座標」的小畫布 cv，回傳它在螢幕上的位置 */
function renderCpuBlurToDevice(ctx:CanvasRenderingContext2D,sigma:number,extent:number,paint:(g:CanvasRenderingContext2D)=>void,cx:number,cy:number,cv:HTMLCanvasElement){
 const mt=ctx.getTransform(),pad=Math.ceil(sigma*3.2)+2;
 const xs:number[]=[],ys:number[]=[];
 for(const [lx,ly] of [[cx-extent,cy-extent],[cx+extent,cy-extent],[cx-extent,cy+extent],[cx+extent,cy+extent]]){xs.push(mt.a*lx+mt.c*ly+mt.e);ys.push(mt.b*lx+mt.d*ly+mt.f);}
 const x=Math.floor(Math.min(...xs))-pad,y=Math.floor(Math.min(...ys))-pad;
 const w=Math.ceil(Math.max(...xs))+pad-x,h=Math.ceil(Math.max(...ys))+pad-y;
 if(w*h>4e6)return null;
 cv.width=w;cv.height=h;
 const g=cv.getContext('2d')!;
 g.setTransform(mt.a,mt.b,mt.c,mt.d,mt.e-x,mt.f-y);g.imageSmoothingEnabled=ctx.imageSmoothingEnabled;g.imageSmoothingQuality=ctx.imageSmoothingQuality;
 g.fillStyle=ctx.fillStyle;g.strokeStyle=ctx.strokeStyle;g.lineWidth=ctx.lineWidth;g.lineJoin=ctx.lineJoin;g.lineCap=ctx.lineCap;
 gaussianCore(g,sigma,extent,paint,cx,cy);
 return {x,y};
}
function gaussianCore(ctx:CanvasRenderingContext2D,sigma:number,extent:number,paint:(g:CanvasRenderingContext2D)=>void,cx=0,cy=0){
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
export function paintSelectedAnimation(ctx:CanvasRenderingContext2D, frame:SelectedFrame|undefined, width:number,height:number, paint:(g:CanvasRenderingContext2D)=>void,index=0,count=1,box?:{x:number;y:number;w:number;h:number;src?:object}) {
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
    ctx.globalAlpha*=Math.max(0,1-a*(1-Math.cos(v))*en/2);
   } else if(code==='S-L03'){
    ctx.rotate(wave*.15*a);
   } else if(code==='S-L07'){
    ctx.scale(Math.max(.02,1-(1-Math.abs(Math.cos(v)))*.8*a*en),1);
   } else if(code==='T-L20'||code==='S-L20'){
    // 失焦：模糊半徑跟著物件大小與目前解析度（預覽／匯出一致），各組依 defocusGroup 錯開。
    const level=defocusOf(frame,index,count);
    const sg=level*Math.max(3,r*.28)*density;
    // 分檔模糊存成物件自己的長方形（不是以對角線為邊的正方形），寬的文字省下大半的空白像素
    if(box)paintBlurred(ctx,sg,Math.hypot(box.w,box.h)/2,paint,box.x+box.w/2,box.y+box.h/2,box.src,{hw:box.w/2,hh:box.h/2});
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
  const sx=Math.max(.02,1-(1-Math.abs(Math.cos(v)))*.8*frame.amount*en);
  ctx.translate(x,y);ctx.scale(sx,1);ctx.translate(-x,-y);
 }
 // 失焦不在這裡設 ctx.filter（iOS 不支援），改由 paintSelectedPattern 做真正的高斯模糊。
}
/** 畫一顆圖案：失焦時先畫進以這顆為中心的緩衝再高斯模糊貼回（跟文字／符號同一套），
    其他動畫照舊套外觀後直接畫。draw 只能畫在傳進來的 g 上。 */
export function paintSelectedPattern(ctx:CanvasRenderingContext2D,frame:SelectedFrame|undefined,size:number,x:number,y:number,draw:(g:CanvasRenderingContext2D)=>void,cacheKey?:object){
 if(frame?.id==='lab-P-L20'){
  const level=defocusOf(frame,frame.slot??0,frame.slots??1);
  const sg=level*Math.max(3,size*.14)*densityOf(ctx);
  /* 支援畫布濾鏡（iOS 18 起的 WebKit、各家電腦瀏覽器）就直接用 GPU 模糊畫在原位：
     不經過快取、不縮放貼回、不混合兩檔 —— iPhone 把快取的模糊圖縮放貼回時位置會偏，
     圖案就照各自的失焦節奏閃一下、往右跳。σ 以畫布像素計，不受目前的變換影響。 */
  /* 用不用濾鏡看「這顆最模糊時」的半徑決定（整段動畫固定同一種做法，中途不換、不跳）。 */
  const sgMax=frame.amount*Math.max(3,size*.14)*densityOf(ctx);
  if(sg>.3&&sgMax<=filterBlurMax()&&(globalThis as any).__patCache===undefined){
   /* 先把裁切範圍限制在這顆附近：濾鏡的暫存圖層照裁切範圍開，不然每顆都是整張畫布大小 */
   const m=size+(sg*3.2+2)/densityOf(ctx);
   ctx.save();ctx.beginPath();ctx.rect(x-m,y-m,2*m,2*m);ctx.clip();
   ctx.filter=`blur(${sg.toFixed(3)}px)`;draw(ctx);ctx.restore();return;
  }
  paintBlurred(ctx,sg,size,draw,x,y,cacheKey,undefined,true);
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
