// 數值範圍比滑桿寬度還大時，密集的控制也要精準。抓住時從它目前的值開始，不是從手指接觸面的邊緣
export function fineSliderValue(start,delta,min,max,step,travel,continuous=false){
 const unit=Number.isFinite(step)&&step>0?step:1;
 const sensitivity=Math.min(continuous?1:unit,(max-min)/Math.max(1,travel));
 const raw=start+delta*sensitivity;
 const value=min+Math.round((raw-min)/unit)*unit;
 return Math.min(max,Math.max(min,+value.toFixed(8)));
}
