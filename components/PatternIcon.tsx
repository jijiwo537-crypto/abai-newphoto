import React from 'react';
import { Circle, Star, Square, Type } from 'lucide-react';
import { CrossStarIcon, VortexIcon, ShapeLineIcon, RadialIcon, PATTERN_LINE_ICON_KINDS, ShapeGlyph, shapePatternIconItem, CenteredGlyphIcon, PATH_PATTERN_ICONS, PathPatternIcon } from './GridLayoutTool';
import { SHAPE_IMAGES } from '../utils/shapeImages';
import { GLYPH_HOLES, GLYPH_BTN, holeImgRatio } from '../utils/holeShapes';

// Keep embedded icon bytes intact, but never reparse a huge base64 CSS mask
// on each first panel layout. These tiny immutable asset URLs live with module.
const patternIconUrls=new Map<string,string>();
export const patternIconUrl=(source:string)=>{
  if(!source.startsWith('data:'))return source;
  let url=patternIconUrls.get(source);if(url)return url;
  const split=source.indexOf(','),header=source.slice(0,split),bytes=atob(source.slice(split+1));
  url=URL.createObjectURL(new Blob([Uint8Array.from(bytes,c=>c.charCodeAt(0))],{type:header.slice(5).split(';')[0]}));
  patternIconUrls.set(source,url);return url;
};

/** 創意拼圖「圖案」按鈕上的小圖示。圖案選單與 order.html（排順序的小工具）共用。 */
export const PatternIcon = ({ s }: { s: string }) => (
  <>
    {/* 從圖形借來的圖案：用那個圖形自己的小圖；音樂符號用置中的那一套 */}
    {/* 用路徑畫的圖案：按鈕直接用畫圖案的那一支畫，跟畫面上一模一樣 */}
    {PATH_PATTERN_ICONS.has(s) ? <PathPatternIcon s={s} /> : s !== 'star-rounded' && shapePatternIconItem(s) ? <ShapeGlyph item={shapePatternIconItem(s)!} /> : s.startsWith('music-') && GLYPH_HOLES[s] ? <CenteredGlyphIcon s={s} /> : s === 'circle' ? <Circle size={18} /> : s === 'square' ? <Square size={18} /> : s === 'cross-star' ? <CrossStarIcon size={18} /> : PATTERN_LINE_ICON_KINDS.has(s) ? <ShapeLineIcon kind={s} /> : (s === 'burst-dash' || s === 'spinner') ? <RadialIcon kind={s} /> : s === 'star' ? <Star size={18} /> : s === 'love' ? <span className="text-xs font-black font-mono tracking-tighter leading-none">&lt;3</span> : s === 'love3' ? <span className="text-[10px] font-black font-mono tracking-tighter leading-none">&lt;333</span> : s === 'vortex' ? <VortexIcon size={18} /> : s === 'random-num' ? <span className="text-sm font-bold font-sans leading-none tracking-tight">(9)</span> : SHAPE_IMAGES[s] ? (
      /* 去背的圖：拿它當遮罩、底色用 currentColor，
         顏色就跟旁邊那些圖示走同一條規則 ——
         沒選中時是暗的（#555），選中才變白。
         （原本是用 filter 硬染成白色，所以永遠亮著。） */
      <span
        aria-hidden
        style={{
          display: 'block',
          width: 26,
          height: 26 / holeImgRatio(s),
          maxWidth: 26,
          maxHeight: 26,
          backgroundColor: 'currentColor',
          WebkitMaskImage: `url(${patternIconUrl(SHAPE_IMAGES[s])})`,
          maskImage: `url(${patternIconUrl(SHAPE_IMAGES[s])})`,
          WebkitMaskSize: 'contain',
          maskSize: 'contain',
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
          maskPosition: 'center',
        }}
      />
    ) : GLYPH_HOLES[s] ? (
      <span
        className="font-bold font-sans leading-none inline-block whitespace-nowrap"
        style={{
          fontSize: `${GLYPH_BTN[s]?.size ?? 18}px`,
          ...(s === "question" ? { fontFamily: "-apple-system, \"SF Pro Text\", \"Helvetica Neue\", sans-serif", fontWeight: 500 } : {}),
          transform: (GLYPH_BTN[s]?.dx || GLYPH_BTN[s]?.dy)
            ? `translate(${GLYPH_BTN[s]?.dx ?? 0}px, ${GLYPH_BTN[s]?.dy ?? 0}px)`
            : undefined,
        }}
      >
        {GLYPH_HOLES[s]}
      </span>
    ) : <Type size={18} />}
  </>
);
