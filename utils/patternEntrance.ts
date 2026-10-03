export type PatternDirection='left-right'|'right-left'|'top-bottom'|'bottom-top'|'random';
function seed(id:string){let n=2166136261;for(const ch of id)n=Math.imul(n^ch.charCodeAt(0),16777619);return n>>>0;}
/** Stable spatial ordering shared by preview and export. Mirrored instances
 * of one generated pattern retain the same start time. */
export function patternEntranceRanks(holes:{id:string;x:number;y:number}[],direction:PatternDirection='left-right'){
 const sorted=holes.map((h,i)=>({h,i})).sort((a,b)=>{
  const delta=direction==='random'?seed(a.h.id)-seed(b.h.id)
   :direction==='right-left'?b.h.x-a.h.x:direction==='top-bottom'?a.h.y-b.h.y
   :direction==='bottom-top'?b.h.y-a.h.y:a.h.x-b.h.x;
  return delta||a.i-b.i;
 });
 const ranks=new Map<string,number>();sorted.forEach(({h},rank)=>ranks.set(h.id,rank));return ranks;
}
