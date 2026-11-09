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
export type SelectedFrame = { id:string; p:number; t:number; amount:number; speed:number; phase:number };
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const smooth=(v:number)=>{v=clamp(v);return v*v*(3-2*v);};
export function selectedFrame(cfg:{in:string;idle:string;delay:number;dur:number;amp:number;speed:number}, time:number, phase=0): SelectedFrame | undefined {
 const end=cfg.in==='none'?0:cfg.delay+Math.max(.01,cfg.dur);
 if(time<end) return catalog.has(cfg.in)?{id:cfg.in,p:clamp((time-cfg.delay)/Math.max(.01,cfg.dur)),t:0,amount:1,speed:1,phase}:undefined;
 return catalog.has(cfg.idle)?{id:cfg.idle,p:1,t:Math.max(0,time-end),amount:clamp(cfg.amp/100),speed:Math.max(.05,cfg.speed),phase}:undefined;
}
/** Draw in the existing object's local coordinates. No fixed-resolution frame cache. */
export function paintSelectedAnimation(ctx:CanvasRenderingContext2D, frame:SelectedFrame|undefined, width:number,height:number, paint:(g:CanvasRenderingContext2D)=>void,index=0,count=1) {
 if(!frame){paint(ctx);return;}
 const spec=catalog.get(frame.id); if(!spec){paint(ctx);return;}
 const w=Math.max(.01,width),h=Math.max(.01,height),r=Math.max(w,h)/2;
 const code=spec.code,kind=Number(code.slice(3))-1,entry=spec.phase==='entry';
 const p=clamp(frame.p*(1+.13*Math.max(0,count-1))-.13*index),q=1-(1-p)**3;
 if(entry&&p<=0)return;
 if(entry&&p>=1){paint(ctx);return;}
 const tfm=ctx.getTransform(),density=Math.max(.01,Math.hypot(tfm.a,tfm.b),Math.hypot(tfm.c || 0,tfm.d || 0));
 const a=frame.amount,en=smooth(frame.t/1.2),ph=index*2.39996+frame.phase;
 const v=frame.t*frame.speed*1.5+ph,wave=(Math.sin(v)-Math.sin(ph))*en;
 ctx.save();
 try {
  if(entry){
   if(kind===0){ctx.translate(0,(1-q)*h*.325);ctx.globalAlpha*=smooth(p);ctx.beginPath();ctx.rect(-w/2,-h/2,w,h*q);ctx.clip();}
   if(kind===2){ctx.globalAlpha*=smooth(p);ctx.filter=`blur(${(1-q)*r*.045*density}px)`;}
   if(kind===3){if(p<=0)return;}
   if(kind===6){const k=1-Math.exp(-p*7)*Math.cos(p*8);ctx.scale(k,k);}
   if(kind===9){ctx.rotate((1-q)*-.9);ctx.scale(q,q);}
   paint(ctx);
  } else if(kind===10||kind===14){
   // Repaint the same vector path under local clips; avoid low-resolution tiles.
   const amplitude=r*.045*a*en;
   if(amplitude<1e-7){paint(ctx);return;}
   paintSelectedWarp(ctx,w,h,r,amplitude,v,kind===14,paint);
  } else {
   // 閃爍是一整個字串的規律亮滅，不受「幅度」影響；所有字共用節奏。
   if(code==='T-L04')ctx.globalAlpha*=.5+.5*Math.cos(frame.t*frame.speed*3.2);
   if(kind===0)ctx.globalAlpha*=1-a*(1-Math.cos(v))*en/2;
   if(kind===1)ctx.translate(0,wave*h*.0625*a);
   if(kind===2)ctx.rotate(wave*.15*a);
   if(kind===3&&code!=='T-L04'){const tf=ctx.getTransform();const blur=(1+Math.sin(v))*r*.0625*a*en*Math.hypot(tf.a,tf.b);ctx.filter=`drop-shadow(0px 0px ${blur}px #e4ffd9)`;}
   if(kind===5){ctx.translate(wave*w*.04*a,0);ctx.scale(1+wave*.08*a,1-wave*.04*a);}
   if(kind===6)ctx.scale(1-(1-Math.abs(Math.cos(v)))*.8*a*en,1);
   if(kind===17){const theta=Math.sin(v*.6)*.12*a*en;ctx.translate(Math.sin(theta)*r*.7,(1-Math.cos(theta))*r*.7);ctx.rotate(theta);}
   if(kind===19){
    // 小字和小圖案原先只有不到 1px 的模糊，幾乎看不到。用實際畫面像素
    // 設下限，開始播放後立即進入失焦／清晰循環，四種目標共用同一算法。
    const blur=(1-Math.cos(v))*a*smooth(frame.t/.3)*Math.min(18,Math.max(3,r*.16))*density;
    ctx.filter=`blur(${blur}px)`;
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
 if(frame.id==='lab-P-L20')ctx.filter=`blur(${(1-Math.cos(v))*frame.amount*smooth(frame.t/.3)*Math.min(18,Math.max(3,size*.16))*Math.hypot(ctx.getTransform().a,ctx.getTransform().b)}px)`;
}
export function selectedPatternGlow(frame:SelectedFrame|undefined) {
 if(frame?.id!=='lab-P-L04')return 0;
 return (1+Math.sin(frame.t*frame.speed*1.5+frame.phase))*.5*frame.amount*smooth(frame.t/1.2);
}
