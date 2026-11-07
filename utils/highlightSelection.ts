// 直方圖選取是相對於目前這張照片，不是固定的亮度（例如 0.55）。剛好落在邊界上的像素平分剩下的權重
export function luminanceBin(r,g,b){return Math.max(0,Math.min(255,Math.round(.299*r+.587*g+.114*b)));}
export function highlightHistogram(data){
 const bins=new Float64Array(256);
 for(let i=0;i<data.length;i+=4)bins[luminanceBin(data[i],data[i+1],data[i+2])]+=data[i+3]/255;
 return bins;
}
export function selectHighlights(bins,coverage){
 const total=bins.reduce((sum,n)=>sum+n,0),fraction=Math.max(0,Math.min(1,coverage/100));
 if(!total||!fraction)return {cutoff:255,tie:0};
 let remaining=total*fraction;
 for(let i=255;i>=0;i--){if(bins[i]>=remaining)return {cutoff:i,tie:remaining/bins[i]};remaining-=bins[i];}
 return {cutoff:0,tie:1};
}
export function highlightWeight(bin,selection){return bin>selection.cutoff?1:bin===selection.cutoff?selection.tie:0;}
