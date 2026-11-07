// 代表密度，不是格子大小：往右會增加完整的格子。每個遮罩的行列數都取整數，最邊上的格子就不會被裁掉一半
export function mosaicGrid(width,height,pixels,scale=1){
 const x=Math.max(1,Math.round(Number(pixels)||1));
 const y=Math.max(1,Math.round(x*height/Math.max(.01,width)));
 return {pitch:width/x,cellHeight:height/y,x,y};
}

// 信心值相對於這張圖本身，不用絕對門檻，低對比照片才不會每條邊都被刷掉。分數相同的點信心值也相同
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
 // 固定亂數的加權取樣，不是永遠取最強的前 N 個點。改變範圍會同時改變可用的區域和它們的分布
 return points.filter(n=>n.confidence>=cutoff).map(n=>({...n,
  priority:Math.log(Math.max(1e-9,n.sample))/(.025+n.confidence-cutoff)
 })).sort((a,b)=>b.priority-a.priority);
}
