// Segment composed Hangul, kana marks and supplementary characters as one cell.
const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'grapheme'}):null;
export function artCharacters(text){const chars=segmenter?[...segmenter.segment(text)].map(x=>x.segment):[...text];return chars.slice(0,48);}
export const needsCellFitting=chars=>chars.some(c=>/[^\x20-\x7e]/u.test(c));
export function fitArtGlyph(context,char,font,width,height){
 context.font=`${font}px monospace`;context.textBaseline='alphabetic';
 const bounds=()=>{const m=context.measureText(char);return{left:m.actualBoundingBoxLeft||0,right:m.actualBoundingBoxRight??m.width,ascent:m.actualBoundingBoxAscent??font*.8,descent:m.actualBoundingBoxDescent??font*.2};};
 let b=bounds();const scale=Math.min(1,width/Math.max(.01,b.left+b.right),height/Math.max(.01,b.ascent+b.descent));
 font*=scale;context.font=`${font}px monospace`;b=bounds();
 return{font,x:(b.left-b.right)/2,y:(b.ascent-b.descent)/2,width:b.left+b.right,height:b.ascent+b.descent};
}
