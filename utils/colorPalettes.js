// One palette catalog for every tool. Reordering never rewrites saved colors.
const unique=colors=>[...new Set(colors.map(c=>c.toUpperCase()))];
const hsl=(h,s,l)=>{const c=(1-Math.abs(2*l-1))*s,p=((h%360)+360)%360/60,x=c*(1-Math.abs(p%2-1)),m=l-c/2;
 const rgb=p<1?[c,x,0]:p<2?[x,c,0]:p<3?[0,c,x]:p<4?[0,x,c]:p<5?[x,0,c]:[c,0,x];
 return '#'+rgb.map(v=>Math.round((v+m)*255).toString(16).padStart(2,'0')).join('').toUpperCase();};
const values=hex=>{const v=parseInt(hex.slice(1),16),r=(v>>16)/255,g=((v>>8)&255)/255,b=(v&255)/255,max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,l=(max+min)/2;
 const h=d?((max===r?60*((g-b)/d%6):max===g?60*((b-r)/d+2):60*((r-g)/d+4))+360)%360:0;
 return {h,s:d?d/(1-Math.abs(2*l-1)):0,l,hsvS:max?d/max:0};};
const ring=(hex,sorted=false)=>{const {h,s,l}=values(hex),hs=Array.from({length:14},(_,i)=>(h+i*360/14)%360);if(sorted)hs.sort((a,b)=>a-b);return hs.map(h=>hsl(h,s,l));};
// Exactly the previous text/shape chromatic colors (HSV V=90), in original order.
const old=values('#9BD4C3'),oldS=Math.round(old.hsvS*100)/100;
const oldColor=h=>{const f=n=>{const k=(n+h/60)%6;return Math.round((.9-.9*oldS*Math.max(Math.min(k,4-k,1),0))*255).toString(16).padStart(2,'0');};return ('#'+f(5)+f(3)+f(1)).toUpperCase();};
export const LEGACY_TEXT_COLORS=Object.freeze(['#000000','#FFFFFF',...Array.from({length:14},(_,i)=>oldColor((old.h+i*360/14)%360))]);
export const MASK_DEEP_COLORS=Object.freeze(ring('#B8E3D8',true));
const light=ring('#D2E8E1',true);
const rotateNear=(colors,hex)=>{const h=values(hex).h;let best=0,d=Infinity;colors.forEach((c,i)=>{const diff=Math.abs(values(c).h-h),n=Math.min(diff,360-diff);if(n<d){best=i;d=n;}});return [...colors.slice(best),...colors.slice(0,best)];};
const tail=rotateNear(MASK_DEEP_COLORS,LEGACY_TEXT_COLORS.at(-1));
export const SHAPE_COLORS=Object.freeze(unique([...LEGACY_TEXT_COLORS.slice(1),...tail]));
export const TEXT_COLORS=Object.freeze(['#000000',...SHAPE_COLORS]);
export const DEFAULT_COLORS=Object.freeze(unique(['#FFFFFF','#000000',...SHAPE_COLORS]));
// Reverse both original mask rings; keep the deeper E3BFB8..E3B8C3
// family first and insert the old text ring between the two mask rings.
const reversedDeep=[...MASK_DEEP_COLORS].reverse();
export const CREATIVE_MASK_COLORS=Object.freeze(unique(['#FFFFFF',...reversedDeep,
 ...rotateNear(LEGACY_TEXT_COLORS.slice(2),reversedDeep.at(-1)),...light.reverse(),'#000000']));
