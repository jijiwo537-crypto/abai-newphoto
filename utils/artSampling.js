// Continuous cell pitch shared by GPU preview and Canvas export/fallback.
export function mosaicGrid(width,height,pixels,scale=1){
 const pitch=Math.max(.01,Number(pixels)*scale);
 return {pitch,x:width/pitch,y:height/pitch};
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
