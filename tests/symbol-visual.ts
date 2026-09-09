import { SYMBOLS } from '../utils/symbols';
import { DEFAULT_FONT, ensureFont, fontStack } from '../utils/fonts';
import { clearSymbolInkCache, measureSymbolAdvance, measureSymbolUnitLayout, symbolBreatheScale } from '../utils/symbolGeometry';

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
  /* 全部回到 1 倍时与生产代码一样交回原生静止字素；只有仍在变化的
     小单元才走拆分动画渲染。 */
  const animated=!!unitScales&&unitScales.some(scale=>Math.abs(scale-1)>1e-6);
  const units=animated?layout.units:layout.staticUnits;
  const centers=animated?layout.centers:layout.staticCenters;
  const inks=animated?layout.unitInks:layout.staticUnitInks;
  units.forEach((unit,i)=>{
    ctx.save();
    const ink=inks[i];
    const seventh=text==="\u22b9 \u08ea \u02d6\u0359\u0358\u0361\u2605";
    const ox=animated?(layout.drawOffsetsX[i]||0):(seventh&&unit.includes("\u08ea")?-size*.08:0);
    const px=ink.cx*size,py=ink.cy*size;
    ctx.translate(cx+centers[i]+ox+px,cy+dy+py);
    const k=unitScales?.[i]??1;ctx.scale(k,k);
    ctx.fillText(unit,-px,-py);ctx.restore();
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
    /* 12px 的冷門 combining mark 在 Chromium alpha hinting 下可能多 1 個
       device pixel 空白；iPhone WebKit 不需要這個容差。只對最小字級放寬 0.5 CSS px。 */
    const hintingTolerance=size<=12?4:3;
    const tight=!!actual&&(actual.l-pl)<=gap+hintingTolerance&&(pr-actual.r)<=gap+hintingTolerance&&(actual.t-pt)<=gap+hintingTolerance&&(pb-actual.b)<=gap+hintingTolerance;

    /* 實際靜止排版由完整 grapheme 決定；動畫拆出的 combining mark
       可能刻意共用同一位置，不能拿它的獨立 alpha box 誤判成排版重疊。 */
    let overlap=false;
    for(let i=1;i<layout.staticUnits.length;i++){
      const a=layout.staticUnitInks[i-1],b=layout.staticUnitInks[i];
      const ar=layout.staticCenters[i-1]+a.cx*size+a.w*size/2;
      const bl=layout.staticCenters[i]+b.cx*size-b.w*size/2;
      if(bl<ar-.05){overlap=true;break;}
    }
    /* 同一基準尺寸必須命中幾何快取：縮放手勢只做數值變換，
       不得在每一幀重新掃描符號 alpha。 */
    const stableCacheHit=measureSymbolUnitLayout(text,DEFAULT_FONT,size)===layout;

    /* 縮放 II：第一幀必須完全不跳，之後每一顆 unit 必須有自己的倍率。 */
    const scaleStart=layout.units.map((_u,i)=>symbolBreatheScale(i,0,60,1.2));
    const scaleA=layout.units.map((_u,i)=>symbolBreatheScale(i,.43,60,1.2));
    const scaleB=layout.units.map((_u,i)=>symbolBreatheScale(i,.91,60,1.2));
    const scale2StartsFlat=scaleStart.every(v=>Math.abs(v-1)<1e-9);
    const trajectories=scaleA.map((v,i)=>`${v.toFixed(6)}|${scaleB[i].toFixed(6)}`);
    const scale2Independent=layout.units.length<=1||new Set(trajectories).size===layout.units.length;

    // 動畫最後一幀必須逐像素回到「原生 grapheme 靜止排版」。
    const reference=ctx.getImageData(0,0,w,h).data;
    const c2=document.createElement('canvas');c2.width=w;c2.height=h;
    const g2=c2.getContext('2d',{willReadFrequently:true})!;g2.scale(dpr,dpr);
    drawCanonical(g2,text,size,cssW/2,cssH/2,new Array(layout.units.length).fill(1));
    const animated=g2.getImageData(0,0,w,h).data;
    let diff=0;for(let i=3;i<reference.length;i+=4) if(reference[i]!==animated[i]){diff++;if(diff>2)break;}
    /* 第七顆只允許 U+08EA 那顆點向左微調；其他 unit 不可被一起移動。 */
    const specialDotAdjusted=index!==6||(
      layout.units.some((unit,i)=>unit.includes("\u08ea")&&layout.drawOffsetsX[i]<0)
      && layout.drawOffsetsX.every((offset,i)=>layout.units[i].includes("\u08ea")||offset===0)
    );
    /* 第七顆原本被 Intl.Segmenter 合併成四組；肉眼可見的附加點與弧線
       現在必須各自成為動畫單元。 */
    const visibleUnitsSeparated=index!==6||layout.units.length>=7;
    const pass=inside&&centered&&tight&&!overlap&&stableCacheHit&&scale2StartsFlat&&scale2Independent&&specialDotAdjusted&&visibleUnitsSeparated&&diff<=2;
    if(!pass)failed.push({index,inside,centered,tight,overlap,stableCacheHit,scale2StartsFlat,scale2Independent,specialDotAdjusted,visibleUnitsSeparated,diff,size,units:layout.units.length,actual,predicted:{pl,pr,pt,pb}});

    // 畫出實際驗證圖：綠框就是 App 的選取框，肉眼可逐顆檢查。
    ctx.strokeStyle=pass?'#64e6a5':'#ff4d4d';ctx.lineWidth=2;
    ctx.strokeRect(pl,pt,pr-pl,pb-pt);
    const card=document.createElement('div');card.className='card'+(pass?'':' bad');
    const label=document.createElement('div');label.className='label';
    label.textContent=`#${index+1} · ${layout.units.length} unit · 靜止／縮放II · ${pass?'PASS':'FAIL'}`;
    const scaleCanvas=document.createElement('canvas');scaleCanvas.width=w;scaleCanvas.height=h;
    const scaleCtx=scaleCanvas.getContext('2d',{willReadFrequently:true})!;
    scaleCtx.scale(dpr,dpr);
    drawCanonical(scaleCtx,text,size,cssW/2,cssH/2,scaleB);
    scaleCtx.setTransform(1,0,0,1,0,0);
    scaleCtx.strokeStyle=pass?'#64e6a5':'#ff4d4d';scaleCtx.lineWidth=2;
    scaleCtx.strokeRect(pl,pt,pr-pl,pb-pt);
    card.append(label,canvas,scaleCanvas);grid.append(card);
    if(index%12===0) await new Promise(requestAnimationFrame);
  }
  const summary=document.querySelector('#summary')!;
  summary.textContent=`${SYMBOLS.length-failed.length}/${SYMBOLS.length} 通過；失敗 ${failed.length}`;
  summary.style.color=failed.length?'#ff7777':'#64e6a5';
  window.__symbolReport={done:true,total:SYMBOLS.length,failed};
})();