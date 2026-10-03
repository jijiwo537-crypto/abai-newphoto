import React, { useId } from 'react';
import { PatternOpts, stripeBand, STRIPE_A, STRIPE_B } from '../utils/pattern';
import { spacedTextureRadius } from '../utils/textureSpacing';

/** Logical vector geometry stays unchanged throughout a pinch. The browser
 * samples paths at the current display scale, never a capped preview bitmap. */
export const PatternLayer: React.FC<{w:number;h:number;opts:PatternOpts}> = React.memo(({w,h,opts:o}) => {
  const id = `texture-${useId().replace(/:/g,'')}`;
  if(o.type==='none'||w<=0||h<=0)return null;
  const horizontal=o.stripeDir==='h';
  const {band,n}=stripeBand(horizontal?h:w,o.stripeN);
  const baseRadius=(5+(o.size??50)*.15)*w/2000;
  const dx=(40+(o.gap??20))*w/1000,dy=dx*Math.sqrt(3)/2;
  const r=spacedTextureRadius(baseRadius,dx,w/1000,w,h,o.type);
  const squash=Math.max(20,Math.min(80,o.squash??50));
  const sx=squash>50?1-(squash-50)*.018:1,sy=squash<50?.1+squash*.018:1;
  const R=r*1.38,s=r*1.22;
  const star=Array.from({length:10},(_,i)=>{const a=-Math.PI/2+i*Math.PI/5,rad=i%2?R*.45:R;return `${Math.cos(a)*rad},${Math.sin(a)*rad}`;}).join(' ');
  const glyph=(x:number,y:number)=><g transform={`translate(${x} ${y}) scale(${sx} ${sy})`}>
    {o.type==='star'?<polygon points={star}/>:o.type==='heart'?<path d={`M0 ${s*.85} C${-s*1.5} ${-s*.2} ${-s*.55} ${-s*1.15} 0 ${-s*.4} C${s*.55} ${-s*1.15} ${s*1.5} ${-s*.2} 0 ${s*.85} Z`}/>:<circle r={r}/>}
  </g>;
  return <svg data-pattern-vector="1" className="absolute inset-0 pointer-events-none" width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{maxWidth:'none',overflow:'hidden'}}>
    {o.type==='stripe'?<><rect width={w} height={h} fill={o.stripeA||STRIPE_A}/>{Array.from({length:n},(_,i)=>i%2?<rect key={i} x={horizontal?0:i*band} y={horizontal?i*band:0} width={horizontal?w:band} height={horizontal?band:h} fill={o.stripeB||STRIPE_B}/>:null)}</>:<>
      <defs><pattern id={id} patternUnits="userSpaceOnUse" x={w/2} y={h/2} width={dx} height={dy*2}>
        <g fill={o.color||'#FFFFFF'}>{glyph(0,0)}{glyph(dx,0)}{glyph(dx/2,dy)}{glyph(0,dy*2)}{glyph(dx,dy*2)}</g>
      </pattern></defs><rect width={w} height={h} fill={`url(#${id})`}/>
    </>}
  </svg>;
});
