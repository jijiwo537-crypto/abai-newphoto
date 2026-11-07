// Keep dense controls precise when the numerical range exceeds their width.
// A grab starts from its value, not the edge of the finger contact patch.
export function fineSliderValue(start,delta,min,max,step,travel,continuous=false){
 const unit=Number.isFinite(step)&&step>0?step:1;
 const sensitivity=Math.min(continuous?1:unit,(max-min)/Math.max(1,travel));
 const raw=start+delta*sensitivity;
 const value=min+Math.round((raw-min)/unit)*unit;
 return Math.min(max,Math.max(min,+value.toFixed(8)));
}
