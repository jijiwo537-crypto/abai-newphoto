/** Crossing a detent is an event; staying on it must not repeat the feedback. */
export const crossedZero = (previous:number,next:number) => Number.isFinite(previous)&&Number.isFinite(next)&&previous!==0&&(next===0||(previous<0&&next>0)||(previous>0&&next<0));
export const crossedDialMark = (previous:number,next:number,spacing=6) => Number.isFinite(previous)&&Number.isFinite(next)&&spacing>0&&Math.round(previous/spacing)!==Math.round(next/spacing);
