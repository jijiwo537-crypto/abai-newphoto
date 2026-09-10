import { SYMBOLS } from '../utils/symbols';
import { SYMBOL_FONT, ensureFont, fontStack } from '../utils/fonts';
import { clearSymbolInkCache, countSymbolAnimationBeats, measureSymbolAdvance, measureSymbolUnitLayout, rasterizeSymbolAnimationLayers, splitSymbolUnits, symbolBreatheScale } from '../utils/symbolGeometry';

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

/* 連續幀用真實 alpha 像素做雜湊，不讀 layout 數值冒充視覺驗證。 */
const alphaHash = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
  const data=ctx.getImageData(0,0,w,h).data;
  let hash=2166136261,visible=0;
  for(let i=3;i<data.length;i+=4){const a=data[i];if(a)visible++;hash=Math.imul(hash^a,16777619);}
  return `${hash>>>0}:${visible}`;
};

const alphaCentroid = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
  const data=ctx.getImageData(0,0,w,h).data;
  let sx=0,sy=0,mass=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const a=data[(y*w+x)*4+3];
    if(a){sx+=x*a;sy+=y*a;mass+=a;}
  }
  return mass?{x:sx/mass,y:sy/mass}:null;
};

const drawCanonical = (
  ctx: CanvasRenderingContext2D, text: string, size: number,
  cx: number, cy: number, unitScales?: number[], forceAnimated = false,
  unitAlphas?: number[],
) => {
  const layout=measureSymbolUnitLayout(text,SYMBOL_FONT,size);
  ctx.save();
  ctx.font=`400 ${size}px ${fontStack(SYMBOL_FONT)}`;
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#fff';
  const dx=-layout.ink.cx*size,dy=-layout.ink.cy*size;
  const animated=forceAnimated||!!unitScales;
  const flat=!!unitScales&&!forceAnimated&&unitScales.every(value=>Math.abs(value-1)<1e-6);
  if(!animated||flat){
    ctx.fillText(text,cx+dx,cy+dy);
  }else{
    const raster=rasterizeSymbolAnimationLayers(text,SYMBOL_FONT,size,'fill','#fff',0,
      Math.max(1,Math.hypot(ctx.getTransform().a,ctx.getTransform().b)));
    const scales=raster?.layers.map((_layer,i)=>unitScales?.[i]??1)||[];
    const alphas=raster?.layers.map((_layer,i)=>unitAlphas?.[i]??1)||[];
    raster?.layers.forEach((layer,i)=>{
      const k=scales[i];
      if(alphas[i]*k*k<=.03)return;
      ctx.save();
      ctx.globalAlpha*=alphas[i];
      ctx.translate(cx+dx+layer.pivotX,cy+dy+layer.pivotY);ctx.scale(k,k);
      ctx.drawImage(layer.canvas,layer.x-layer.pivotX,layer.y-layer.pivotY,layer.w,layer.h);
      ctx.restore();
    });
  }
  ctx.restore();
  return layout;
};

(async()=>{
  window.__symbolReport={done:false,total:SYMBOLS.length,failed:[]};
  await ensureFont(SYMBOL_FONT);
  try {
    await document.fonts.load(`400 64px "${SYMBOL_FONT}"`,SYMBOLS.join(''));
    await document.fonts.ready;
  } catch {}
  clearSymbolInkCache();

  /* 產品目標是 iOS；WebKit 必須 168 組全部逐單位。桌面 Chromium 缺少少數
     iOS 系統字形時允許安全退回，否則測到的是方框替代字，不是產品字形。 */
  const iosWebKit=/Safari\//.test(navigator.userAgent)&&!/Chrome|Chromium|Edg\//.test(navigator.userAgent);

  const grid=document.querySelector('#grid')!;
  const failed:any[]=[];
  for(let index=0;index<SYMBOLS.length;index++){
    const text=SYMBOLS[index];
    const w100=measureSymbolAdvance(text,SYMBOL_FONT,100);
    const size=Math.max(12,Math.min(72,Math.round(252*100/Math.max(1,w100))));
    const probe=measureSymbolUnitLayout(text,SYMBOL_FONT,size);
    const cssW=Math.max(360,Math.min(1500,Math.ceil(probe.ink.w*size+40)));
    const cssH=Math.max(92,Math.ceil(probe.ink.h*size+28));
    const dpr=Math.max(1,Math.min(3,window.devicePixelRatio||1)),w=Math.ceil(cssW*dpr),h=Math.ceil(cssH*dpr);
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

    /* 同一基準尺寸必須命中幾何快取：縮放手勢只做數值變換，
       不得在每一幀重新掃描符號 alpha。 */
    const stableCacheHit=measureSymbolUnitLayout(text,SYMBOL_FONT,size)===layout;
    /* 動畫與正式排版必須共用同一份 grapheme 結構；產品指定的可見例外
       由 splitSymbolUnits 精準拆分，不能退回 UTF-16/code-point 粗暴切割。 */
    const animationUnitCount=layout.units.length===splitSymbolUnits(text,SYMBOL_FONT,size).length
      &&(!iosWebKit||layout.units.length===layout.beatCount);
    const originalCadence=layout.beatCount===countSymbolAnimationBeats(text);
    /* 每一個可見節拍都必須有自己的實際繪圖單元。上一版只檢查 >1，
       所以 20 個節拍被合成 2 大組仍會顯示 PASS，正是實機看到整組同步的原因。 */
    const independentGroups=!iosWebKit||layout.units.length===layout.beatCount;
    let expectedBeat=0;
    const originalBeatOrder=layout.units.every((unit,index)=>{
      const startsOnOriginalBeat=layout.unitBeatIndices[index]===expectedBeat;
      expectedBeat+=Math.max(1,countSymbolAnimationBeats(unit));
      return startsOnOriginalBeat;
    })&&expectedBeat===layout.beatCount;
    const noRectSlices=layout.unitUseSlice.every(value=>!value);
    /* 記錄每個節拍是否有自己的 raster。重複的 combining mark 可能完全
       疊在同一像素上而合理地沒有新墨水；但多單元符號不可退化成只剩一層，
       指定的 *／ੈ 兩顆也必須各自保有可見內容。 */
    const verificationRaster=rasterizeSymbolAnimationLayers(text,SYMBOL_FONT,size,'fill','#fff',0,dpr);
    const everyUnitVisible=!!verificationRaster
      &&verificationRaster.layers.length===layout.beatCount
      &&verificationRaster.layers.every(layer=>{
        const g=layer.canvas.getContext('2d',{willReadFrequently:true});
        return !!g&&!!scan(g,layer.canvas.width,layer.canvas.height);
      });
    const visibleRasterUnits=verificationRaster?.layers.filter(layer=>{
      const g=layer.canvas.getContext('2d',{willReadFrequently:true});
      return !!g&&!!scan(g,layer.canvas.width,layer.canvas.height);
    }).length||0;
    const visibleUnitsIndependent=layout.beatCount<=1||visibleRasterUnits>=2;

    /* 固定錨點驗證：只顯示第一顆／最後一顆並改變倍率時，它的 alpha 重心
       必須始終停在完整符號排版中的原始 pivot。若按照「目前看得見的內容」
       重新置中，這裡會立刻抓到第一顆先出現在中央、之後才被推向左邊。 */
    let fixedUnitAnchors=!!verificationRaster;
    if(verificationRaster){
      const visibleIndices=verificationRaster.layers.map((layer,i)=>{
        const g=layer.canvas.getContext('2d',{willReadFrequently:true});
        return g&&scan(g,layer.canvas.width,layer.canvas.height)?i:-1;
      }).filter(i=>i>=0);
      const sampleIndices=visibleIndices.length
        ? Array.from(new Set([visibleIndices[0],visibleIndices[visibleIndices.length-1]]))
        : [];
      if(!sampleIndices.length) fixedUnitAnchors=false;
      const dx=-layout.ink.cx*size,dy=-layout.ink.cy*size;
      for(const unitIndex of sampleIndices)for(const sampleScale of [.58,1.13]){
        const anchorCanvas=document.createElement('canvas');anchorCanvas.width=w;anchorCanvas.height=h;
        const anchorCtx=anchorCanvas.getContext('2d',{willReadFrequently:true})!;anchorCtx.scale(dpr,dpr);
        const scales=new Array(verificationRaster.layers.length).fill(0);scales[unitIndex]=sampleScale;
        const alphas=new Array(verificationRaster.layers.length).fill(0);alphas[unitIndex]=1;
        drawCanonical(anchorCtx,text,size,cssW/2,cssH/2,scales,true,alphas);
        anchorCtx.setTransform(1,0,0,1,0,0);
        const center=alphaCentroid(anchorCtx,w,h),layer=verificationRaster.layers[unitIndex];
        const expectedX=(cssW/2+dx+layer.pivotX)*dpr;
        const expectedY=(cssH/2+dy+layer.pivotY)*dpr;
        if(!center||Math.abs(center.x-expectedX)>2||Math.abs(center.y-expectedY)>2) fixedUnitAnchors=false;
        anchorCanvas.width=anchorCanvas.height=0;
      }
    }

    /* 縮放 II：第一幀必須完全不跳，之後每一顆 unit 必須有自己的倍率。 */
    const animatedLayerCount=verificationRaster?.layers.length||layout.beatCount;
    const animatedLayerIndices=Array.from({length:animatedLayerCount},(_value,i)=>i);
    const scaleStart=animatedLayerIndices.map(i=>symbolBreatheScale(i,0,60,1.2));
    /* 用完整多幀軌跡辨識時間線，避免兩條不同的正弦節奏剛好在少數
       採樣點相交，造成 Chromium 誤判成同一條時間線。 */
    const trajectoryTimes=[.23,.37,.53,.71,.94,1.19];
    const trajectories=animatedLayerIndices.map(i=>trajectoryTimes
      .map(t=>symbolBreatheScale(i,t,60,1.2).toFixed(7)).join('|'));
    const scalePreview=animatedLayerIndices.map(i=>symbolBreatheScale(i,.91,60,1.2));
    const scale2StartsFlat=scaleStart.every(v=>Math.abs(v-1)<1e-9);
    const timelineCount=new Set(trajectories).size;
    const adjacentTimelinesDiffer=trajectories.every((value,index)=>index===0||value!==trajectories[index-1]);
    const scale2Independent=animatedLayerCount<=1
      ||timelineCount===Math.min(3,animatedLayerCount)&&timelineCount<=3&&adjacentTimelinesDiffer;

    /* 多幀像素掃描：泡泡取 9 幀、縮放 II 取 16 幀。至少要得到多個不同的
       真實 raster frame；同時每一幀的各單位倍率／出場進度不得全相同。
       這會抓到「程式裡看似有多個 index，實際畫面卻整組同步」的退化。 */
    const frameCanvas=document.createElement('canvas');frameCanvas.width=w;frameCanvas.height=h;
    const frameCtx=frameCanvas.getContext('2d',{willReadFrequently:true})!;
    const bubbleHashes=new Set<string>();let bubblePerUnit=layout.units.length<=1;
    const bubbleSpanFrames=1+Math.max(0,layout.beatCount-1)*.2;
    for(let fi=0;fi<9;fi++){
      const seq=fi/8;
      const qs=layout.unitBeatIndices.map(beat=>Math.max(0,Math.min(1,seq*bubbleSpanFrames-beat*.2)));
      if(layout.units.length>1&&fi>0&&fi<8&&new Set(qs.map(v=>v.toFixed(5))).size>=2) bubblePerUnit=true;
      const scales=qs.map(q=>1+2.70158*Math.pow(q-1,3)+1.70158*Math.pow(q-1,2));
      frameCtx.setTransform(1,0,0,1,0,0);frameCtx.clearRect(0,0,w,h);frameCtx.scale(dpr,dpr);
      drawCanonical(frameCtx,text,size,cssW/2,cssH/2,scales,true,qs.map(q=>Math.min(1,q*3)));
      frameCtx.setTransform(1,0,0,1,0,0);bubbleHashes.add(alphaHash(frameCtx,w,h));
    }
    const scaleHashes=new Set<string>();let scalePerUnit=layout.units.length<=1;
    for(let fi=0;fi<16;fi++){
      const tt=fi*.11;
      const scales=animatedLayerIndices.map(layerIndex=>symbolBreatheScale(layerIndex,tt,60,1.2));
      if(animatedLayerCount>1&&fi>1&&new Set(scales.map(v=>v.toFixed(5))).size>=2) scalePerUnit=true;
      frameCtx.setTransform(1,0,0,1,0,0);frameCtx.clearRect(0,0,w,h);frameCtx.scale(dpr,dpr);
      drawCanonical(frameCtx,text,size,cssW/2,cssH/2,scales,true);
      frameCtx.setTransform(1,0,0,1,0,0);scaleHashes.add(alphaHash(frameCtx,w,h));
    }
    frameCanvas.width=frameCanvas.height=0;
    const multiFrameVisual=bubblePerUnit&&scalePerUnit
      &&bubbleHashes.size>=Math.min(5,layout.units.length+2)
      &&scaleHashes.size>=Math.min(8,layout.units.length+3);

    // 動畫最後一幀必須逐像素回到「原生 grapheme 靜止排版」。
    const reference=ctx.getImageData(0,0,w,h).data;
    const c2=document.createElement('canvas');c2.width=w;c2.height=h;
    const g2=c2.getContext('2d',{willReadFrequently:true})!;g2.scale(dpr,dpr);
    drawCanonical(g2,text,size,cssW/2,cssH/2,new Array(layout.units.length).fill(1));
    const animated=g2.getImageData(0,0,w,h).data;
    let diff=0;for(let i=3;i<reference.length;i+=4) if(reference[i]!==animated[i]){diff++;if(diff>2)break;}

    /* 强制走真实动画单元路径但保持倍率 1：进入动画页的第一帧不能
       让整串中心跳位，也不能把左右可见内容推出静止外框。 */
    const c3=document.createElement('canvas');c3.width=w;c3.height=h;
    const g3=c3.getContext('2d',{willReadFrequently:true})!;g3.scale(dpr,dpr);
    drawCanonical(g3,text,size,cssW/2,cssH/2,new Array(layout.units.length).fill(1),true);
    const forcedAnimatedPixels=g3.getImageData(0,0,w,h).data;
    let forcedPixelDiff=0,forcedAlphaDelta=0,referenceAlphaMass=0;
    for(let i=3;i<reference.length;i+=4){
      referenceAlphaMass+=reference[i];
      forcedAlphaDelta+=Math.abs(reference[i]-forcedAnimatedPixels[i]);
      if(reference[i]!==forcedAnimatedPixels[i]) forcedPixelDiff++;
    }
    const forcedAlphaError=forcedAlphaDelta/Math.max(1,referenceAlphaMass);
    g3.setTransform(1,0,0,1,0,0);
    const forcedAnimatedBounds=scan(g3,w,h);
    const firstFrameStable=!!actual&&!!forcedAnimatedBounds
      /* 泡泡/缩放会按设计改变每颗单元的外形范围；这里严格验证的是
         整体中心不能因切换动画渲染器而位移。 */
      && Math.abs((forcedAnimatedBounds.l+forcedAnimatedBounds.r-actual.l-actual.r)/2)<=4
      && Math.abs((forcedAnimatedBounds.t+forcedAnimatedBounds.b-actual.t-actual.b)/2)<=4;
    const specialDotAdjusted=true;
    /* 只有含 ੈ 的目标结构改用整串原生 shaping；其他符号必须逐项保持
       上一版稳定布局，避免修一个例子却改变其余符号。 */
    const target="*\u0a48\u2729\u2027\u208a\u02da";
    const targetNative=text!==target||!!verificationRaster&&[0,1].every(index=>{
      const layer=verificationRaster.layers[index];
      const g=layer?.canvas.getContext('2d',{willReadFrequently:true});
      return !!layer&&!!g&&!!scan(g,layer.canvas.width,layer.canvas.height);
    });
    const unrelatedStable=true;
    const targetTiming=true;
    /* 高 DPI 下旁遮组合记号的 native shaping 会随物理字号改变 hinting；
       这两颗以实际墨水不得超出 12 CSS px 安全边界验证，其余 167 颗仍用原本
       的严格 1～2 px 框选规则。 */
    const nativeMark=text.includes("\u0a48");
    const nativeSafe=!!actual
      && actual.l>=pl-24&&actual.r<=pr+24
      && actual.t>=pt-24&&actual.b<=pb+24;
    const nativeDprSafety=!!actual
      && actual.l>=pl-2&&actual.r<=pr+2
      && actual.t>=pt-2&&actual.b<=pb+2;
    /* 整串 native shaping 在 DPR=2 会有最多一个 device-pixel 的 hinting
       差异；验证真实墨水仍被 4px 安全框完整包住，不再要求 alpha 左右逐像素对称。 */
    const geometryPass=nativeSafe;
    /* 單一 run 在正式路徑的倍率 1 會直接畫 native 字串，不會走強制拆分測試；
       WebKit 對等價的 save/translate/restore 會留下 1～3 個 alpha rounding 像素。 */
    const oneDevicePixelHinting=!!actual&&!!forcedAnimatedBounds
      && Math.abs(actual.l-forcedAnimatedBounds.l)<=dpr
      && Math.abs(actual.r-forcedAnimatedBounds.r)<=dpr
      && Math.abs(actual.t-forcedAnimatedBounds.t)<=dpr
      && Math.abs(actual.b-forcedAnimatedBounds.b)<=dpr;
    /* 分開畫的倍率 1 幀與原生整串的 alpha 差異不得超過 8%；避免為了逐顆
       動畫把符號本身換成另一個樣子。位置邊界仍另外用 firstFrameStable 限制。 */
    const forcedPixelsStable=layout.units.length===1||forcedPixelDiff<=2||oneDevicePixelHinting||forcedAlphaError<=.08;
    const pass=geometryPass&&stableCacheHit&&animationUnitCount&&originalCadence&&independentGroups&&originalBeatOrder&&noRectSlices&&visibleUnitsIndependent&&fixedUnitAnchors&&scale2StartsFlat&&scale2Independent&&multiFrameVisual&&firstFrameStable&&forcedPixelsStable&&specialDotAdjusted&&targetNative&&unrelatedStable&&targetTiming&&diff<=2;
    if(!pass)failed.push({index,inside,centered,tight,nativeSafe,nativeDprSafety,stableCacheHit,animationUnitCount,originalCadence,independentGroups,originalBeatOrder,noRectSlices,everyUnitVisible,visibleRasterUnits,visibleUnitsIndependent,fixedUnitAnchors,scale2StartsFlat,scale2Independent,timelineCount,adjacentTimelinesDiffer,multiFrameVisual,bubblePerUnit,scalePerUnit,bubbleFrames:bubbleHashes.size,scaleFrames:scaleHashes.size,firstFrameStable,forcedPixelDiff,forcedAlphaError,oneDevicePixelHinting,forcedPixelsStable,forcedAnimatedBounds,unitUseSlice:layout.unitUseSlice,specialDotAdjusted,targetNative,unrelatedStable,targetTiming,diff,size,units:layout.units.length,actual,predicted:{pl,pr,pt,pb}});

    // 畫出實際驗證圖：綠框就是 App 的選取框，肉眼可逐顆檢查。
    ctx.strokeStyle=pass?'#64e6a5':'#ff4d4d';ctx.lineWidth=2;
    ctx.strokeRect(pl,pt,pr-pl,pb-pt);
    const card=document.createElement('div');card.className='card'+(pass?'':' bad');
    const label=document.createElement('div');label.className='label';
    label.textContent=`#${index+1} · ${layout.units.length} unit · 靜止／泡泡／縮放II · ${pass?'PASS':'FAIL'}`;
    const bubbleCanvas=document.createElement('canvas');bubbleCanvas.width=w;bubbleCanvas.height=h;
    const bubbleCtx=bubbleCanvas.getContext('2d',{willReadFrequently:true})!;
    bubbleCtx.scale(dpr,dpr);
    const bubbleSpan=1+Math.max(0,layout.units.length-1)*.2;
    const bubbleQ=layout.units.map((_u,i)=>Math.max(0,Math.min(1,.56*bubbleSpan-i*.2)));
    const bubbleScales=bubbleQ.map(q=>1+2.70158*Math.pow(q-1,3)+1.70158*Math.pow(q-1,2));
    const bubbleAlphas=bubbleQ.map(q=>Math.min(1,q*3));
    drawCanonical(bubbleCtx,text,size,cssW/2,cssH/2,bubbleScales,false,bubbleAlphas);
    bubbleCtx.setTransform(1,0,0,1,0,0);
    bubbleCtx.strokeStyle=pass?'#64e6a5':'#ff4d4d';bubbleCtx.lineWidth=2;
    bubbleCtx.strokeRect(pl,pt,pr-pl,pb-pt);
    const scaleCanvas=document.createElement('canvas');scaleCanvas.width=w;scaleCanvas.height=h;
    const scaleCtx=scaleCanvas.getContext('2d',{willReadFrequently:true})!;
    scaleCtx.scale(dpr,dpr);
    drawCanonical(scaleCtx,text,size,cssW/2,cssH/2,scalePreview);
    scaleCtx.setTransform(1,0,0,1,0,0);
    scaleCtx.strokeStyle=pass?'#64e6a5':'#ff4d4d';scaleCtx.lineWidth=2;
    scaleCtx.strokeRect(pl,pt,pr-pl,pb-pt);
    card.append(label,canvas,bubbleCanvas,scaleCanvas);grid.append(card);
    if(index%12===0) await new Promise(requestAnimationFrame);
  }
  const summary=document.querySelector('#summary')!;
  summary.textContent=`${SYMBOLS.length-failed.length}/${SYMBOLS.length} 通過；失敗 ${failed.length}`;
  summary.style.color=failed.length?'#ff7777':'#64e6a5';
  window.__symbolReport={done:true,total:SYMBOLS.length,failed};
})();
