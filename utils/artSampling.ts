// Density, not cell size: increasing right adds complete cells. Fit integer
// rows/columns to each mask so terminal cells are never partially clipped.
export function mosaicGrid(width,height,pixels,scale=1){
 const x=Math.max(1,Math.round(Number(pixels)||1));
 const y=Math.max(1,Math.round(x*height/Math.max(.01,width)));
 return {pitch:width/x,cellHeight:height/y,x,y};
}

// Image-relative confidence avoids an absolute cutoff that rejects every
// edge in a low-contrast photograph. Equal scores retain equal confidence.
export function rankCandidates(points){
 const sorted=[...points].sort((a,b)=>a.score-b.score);
 for(let first=0;first<sorted.length;){
  let end=first+1;while(end<sorted.length&&sorted[end].score===sorted[first].score)end++;
  const confidence=(first+end)/(2*sorted.length);
  for(let i=first;i<end;i++)sorted[i].confidence=confidence;
  first=end;
 }
 return points;
}
export function scopedCandidates(points,threshold){
 const cutoff=Math.max(0,Math.min(1,threshold/100));
 // Deterministic weighted sampling, not always the same first N strongest
 // points. Changing scope changes eligible regions AND their distribution.
 return points.filter(n=>n.confidence>=cutoff).map(n=>({...n,
  priority:Math.log(Math.max(1e-9,n.sample))/(.025+n.confidence-cutoff)
 })).sort((a,b)=>b.priority-a.priority);
}
