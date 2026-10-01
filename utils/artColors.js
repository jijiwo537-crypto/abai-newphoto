// Preserve the original three chromatic presets within a restrained rainbow.
export const ART_SWATCHES=[
 ['#ffffff','白色'],['#ff7899','玫瑰'],['#ffd178','琥珀'],['#f5ee9e','柔黃'],
 ['#a8ffdc','薄荷'],['#9de7ff','冰青'],['#a6bcff','霧藍'],['#d0adff','霞紫'],
];
export function artHexToHsv(hex){
 const v=parseInt(hex.replace('#',''),16),r=(v>>16)/255,g=((v>>8)&255)/255,b=(v&255)/255;
 const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
 const h=!d?0:max===r?((g-b)/d+6)%6:max===g?(b-r)/d+2:(r-g)/d+4;
 return {h:h*60,s:max?d/max*100:0,v:max*100};
}
export function artHsvToHex({h,s,v}){
 const hue=((h%360)+360)%360,sv=Math.max(0,Math.min(100,s))/100,value=Math.max(0,Math.min(100,v))/100;
 const f=n=>{const k=(n+hue/60)%6;return Math.round((value-value*sv*Math.max(0,Math.min(k,4-k,1)))*255).toString(16).padStart(2,'0');};
 return '#'+f(5)+f(3)+f(1);
}
