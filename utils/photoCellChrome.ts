import type {PhotoRect} from './creativePhotoLayout';
/** One filled outline, not two semitransparent intersecting strokes. */
export const SOLID_PLUS_PATH='M7.15 1H8.85V7.15H15V8.85H8.85V15H7.15V8.85H1V7.15H7.15Z';
/** Only shared edges of two empty cells. No outer border, doubled strokes or
 * separator through an overlapping inset photo. */
export function emptyCellSeparators(rects:PhotoRect[],empty:boolean[]){
  const lines:{x1:number;y1:number;x2:number;y2:number}[]=[],epsilon=1e-7;
  for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
    if(!empty[i]||!empty[j])continue;const a=rects[i],b=rects[j];
    const y1=Math.max(a.y,b.y),y2=Math.min(a.y+a.h,b.y+b.h);
    const x1=Math.max(a.x,b.x),x2=Math.min(a.x+a.w,b.x+b.w);
    if(y2-y1>epsilon){
      if(Math.abs(a.x+a.w-b.x)<epsilon)lines.push({x1:b.x,y1,x2:b.x,y2});
      else if(Math.abs(b.x+b.w-a.x)<epsilon)lines.push({x1:a.x,y1,x2:a.x,y2});
    }
    if(x2-x1>epsilon){
      if(Math.abs(a.y+a.h-b.y)<epsilon)lines.push({x1,y1:b.y,x2,y2:b.y});
      else if(Math.abs(b.y+b.h-a.y)<epsilon)lines.push({x1,y1:a.y,x2,y2:a.y});
    }
  }
  return lines;
}
