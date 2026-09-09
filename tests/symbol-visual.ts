import { SYMBOLS } from '../utils/symbols';
import { DEFAULT_FONT, ensureFont, fontStack } from '../utils/fonts';
import { clearSymbolInkCache, measureSymbolAdvance, measureSymbolUnitLayout } from '../utils/symbolGeometry';

declare global {
  interface Window { __symbolReport?: { done: boolean; total: number; failed: any[] } }
}

const scan = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
  const data = ctx.getImageData(0, 0, w, h).data;
  let l=w,r=-1,t=h,b=-1;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    if(data[(y*w+x)*4+3]>0){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);}
  }
  return r>=l?{l,r:r+1,t,b:b+1}:null;
};

const drawCanonical = (
  ctx: CanvasRenderingContext2D, text: string, size: number,
  cx: number, cy: number, unitScales?: number[],
) => {
  const layout=measureSymbolUnitLayout(text,DEFAULT_FONT,size);
  ctx.save();
  ctx.font=`400 ${size}px ${fontStack(DEFAULT_FONT)}`;
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#fff';
  const dy=-layout.ink.cy*size;
  layout.units.forEach((unit,i)=>{
    ctx.save();
    ctx.translate(cx+layout.centers[i],cy+dy);
    const k=unitScales?.[i]??1;ctx.scale(k,k);
    ctx.fillText(unit,0,0);ctx.restore();
  });
  ctx.restore();
  return layout;
};

(async()=>{
  window.__symbolReport={done:false,total:SYMBOLS.length,failed:[]};
  await ensureFont(DEFAULT_FONT);
  try {
    await document.fonts.load(`400 64px "${DEFAULT_FONT}"`,SYMBOLS.join(''));
    await document.fonts.ready;
  } catch {}
  clearSymbolInkCache();

  const grid=document.querySelector('#grid')!;
  const failed:any[]=[];
  for(let index=0;index<SYMBOLS.length;index++){
    const text=SYMBOLS[index];
    const w100=measureSymbolAdvance(text,DEFAULT_FONT,100);
    const size=Math.max(12,Math.min(72,Math.round(252*100/Math.max(1,w100))));
    const probe=measureSymbolUnitLayout(text,DEFAULT_FONT,size);
    const cssW=Math.max(360,Math.min(1500,Math.ceil(probe.ink.w*size+40)));
    const cssH=Math.max(92,Math.ceil(probe.ink.h*size+28));
    const dpr=2,w=Math.ceil(cssW*dpr),h=Math.ceil(cssH*dpr);
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
    ctx.scale(dpr,dpr);
    const layout=drawCanonical(ctx,text,size,cssW/2,cssH/2);
    ctx.setTransform(1,0,0,1,0,0);
    const actual=scan(ctx,w,h);
    const gap=4*dpr;
    const fw=layout.ink.w*size*dpr,fh=layout.ink.h*size*dpr;
    const pl=w/2-fw/2-gap,pr=w/2+fw/2+gap;
    const pt=h/2-fh/2-gap,pb=h/2+fh/2+gap;
    const inside=!!actual&&actual.l>=pl-1&&actual.r<=pr+1&&actual.t>=pt-1&&actual.b<=pb+1;
    /* DPR=2 下允許最多 1.5 CSS px 的 hinting 取整誤差；選取框本身仍由真實 alpha 邊界產生。 */
    const centered=!!actual&&Math.abs((actual.l+actual.r)/2-w/2)<=3&&Math.abs((actual.t+actual.b)/2-h/2)<=3;
    const tight=!!actual&&(actual.l-pl)<=gap+3&&(pr-actual.r)<=gap+3&&(actual.t-pt)<=gap+3&&(pb-actual.b)<=gap+3;

    // 動畫最後一幀必須逐像素回到靜止版面。
    const reference=ctx.getImageData(0,0,w,h).data;
    const c2=document.createElement('canvas');c2.width=w;c2.height=h;
    const g2=c2.getContext('2d',{willReadFrequently:true})!;g2.scale(dpr,dpr);
    drawCanonical(g2,text,size,cssW/2,cssH/2,new Array(layout.units.length).fill(1));
    const animated=g2.getImageData(0,0,w,h).data;
    let diff=0;for(let i=3;i<reference.length;i+=4) if(reference[i]!==animated[i]){diff++;if(diff>2)break;}
    const pass=inside&&centered&&tight&&diff<=2;
    if(!pass)failed.push({index,inside,centered,tight,diff,size,units:layout.units.length,actual,predicted:{pl,pr,pt,pb}});

    // 畫出實際驗證圖：綠框就是 App 的選取框，肉眼可逐顆檢查。
    ctx.strokeStyle=pass?'#64e6a5':'#ff4d4d';ctx.lineWidth=2;
    ctx.strokeRect(pl,pt,pr-pl,pb-pt);
    const card=document.createElement('div');card.className='card'+(pass?'':' bad');
    const label=document.createElement('div');label.className='label';
    label.textContent=`#${index+1} · ${layout.units.length} unit · ${pass?'PASS':'FAIL'}`;
    card.append(label,canvas);grid.append(card);
    if(index%12===0) await new Promise(requestAnimationFrame);
  }
  const summary=document.querySelector('#summary')!;
  summary.textContent=`${SYMBOLS.length-failed.length}/${SYMBOLS.length} 通過；失敗 ${failed.length}`;
  summary.style.color=failed.length?'#ff7777':'#64e6a5';
  window.__symbolReport={done:true,total:SYMBOLS.length,failed};
})();