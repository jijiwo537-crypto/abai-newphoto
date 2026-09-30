// Original ABAI region treatments. Blur is computed explicitly: Canvas filter
// is not implemented consistently in iOS WebKit.
export const MATERIALS=[['mosaic','像素'],['glass','霧玻璃'],['negative','負片'],['prism','稜鏡'],['glitch','錯頻'],['duotone','雙色印刷'],['scan','掃描'],['dream','虹光']];
export function blurRGBA(data,w,h,radius){
 let a=new Uint8ClampedArray(data),b=new Uint8ClampedArray(a.length);
 const r=Math.max(1,Math.round(radius)),diam=2*r+1;
 for(let pass=0;pass<3;pass++)for(let axis=0;axis<2;axis++){
  const major=axis?h:w,minor=axis?w:h,stride=axis?w:1;
  for(let line=0;line<minor;line++)for(let ch=0;ch<4;ch++){
   const base=axis?line:line*w;let sum=0;
   for(let i=-r;i<=r;i++)sum+=a[(base+Math.max(0,Math.min(major-1,i))*stride)*4+ch];
   for(let i=0;i<major;i++){b[(base+i*stride)*4+ch]=sum/diam;sum+=a[(base+Math.min(major-1,i+r+1)*stride)*4+ch]-a[(base+Math.max(0,i-r)*stride)*4+ch];}
  }[a,b]=[b,a];
 }return a;
}
export function blurredSource(source,radius){
 // Only the deliberately blurred material is band-limited. The photograph and
 // analytic overlay retain their original/vector resolution at every zoom.
 const scale=Math.min(1,1200/Math.max(source.width,source.height),6/Math.max(1,radius));
 const c=document.createElement('canvas');c.width=Math.max(1,Math.round(source.width*scale));c.height=Math.max(1,Math.round(source.height*scale));
 const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(source,0,0,c.width,c.height);
 if(radius>0){const im=g.getImageData(0,0,c.width,c.height);im.data.set(blurRGBA(im.data,c.width,c.height,radius*scale*.58));g.putImageData(im,0,0);}return c;
}
export function makeLinks(nodes,mode,maxDistance){
 if(mode==='none'||nodes.length<2)return [];
 if(mode==='radial'){const center=nodes.reduce((a,b)=>a.score>b.score?a:b);return nodes.filter(n=>n!==center).map(n=>[center,n]);}
 if(mode==='tree'){
  const connected=new Set([0]),edges=[];
  while(connected.size<nodes.length){let best=null,d=Infinity;for(const i of connected)for(let j=0;j<nodes.length;j++)if(!connected.has(j)){const q=Math.hypot(nodes[i].x-nodes[j].x,nodes[i].y-nodes[j].y);if(q<d){d=q;best=[i,j];}}
   if(!best)break;connected.add(best[1]);edges.push(best.map(i=>nodes[i]));
  }return edges;
 }
 const edges=[];for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++)if(Math.hypot(nodes[i].x-nodes[j].x,nodes[i].y-nodes[j].y)<=maxDistance)edges.push([nodes[i],nodes[j]]);return edges;
}
