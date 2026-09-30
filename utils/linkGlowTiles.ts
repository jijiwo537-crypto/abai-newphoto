/** Reusable narrow strips instead of blurring an entire scene for each link. */
export class LinkGlowTiles {
 private cache=new Map<string,{canvas:HTMLCanvasElement,pad:number}>();
 draw(g:CanvasRenderingContext2D,x1:number,y1:number,x2:number,y2:number,width:number,color:string,dashed:boolean){
  const dx=x2-x1,dy=y2-y1,length=Math.hypot(dx,dy);if(length<.001)return;
  const key=`${length.toFixed(4)}|${width}|${color}|${dashed}`;
  let tile=this.cache.get(key);
  if(!tile){
   const pad=Math.ceil(width*10+3),canvas=document.createElement('canvas');
   canvas.width=Math.ceil(length+pad*2);canvas.height=pad*2;
   const c=canvas.getContext('2d')!;c.strokeStyle=color;c.shadowColor=color;c.lineWidth=width;c.lineCap=dashed?'butt':'round';
   if(dashed)c.setLineDash([width*3,width*4]);
   for(const n of [1,2,3]){c.shadowBlur=width*3*n*.9;c.beginPath();c.moveTo(pad,pad);c.lineTo(pad+length,pad);c.stroke();}
   tile={canvas,pad};this.cache.set(key,tile);
   let pixels=0;for(const t of this.cache.values())pixels+=t.canvas.width*t.canvas.height;
   while(this.cache.size>1&&(this.cache.size>80||pixels>8_000_000)){
    const first=this.cache.keys().next().value!;const old=this.cache.get(first)!;pixels-=old.canvas.width*old.canvas.height;this.cache.delete(first);old.canvas.width=old.canvas.height=1;
   }
  }else{this.cache.delete(key);this.cache.set(key,tile);}
  g.save();g.translate(x1,y1);g.rotate(Math.atan2(dy,dx));g.drawImage(tile.canvas,-tile.pad,-tile.pad);g.restore();
 }
 dispose(){for(const t of this.cache.values())t.canvas.width=t.canvas.height=1;this.cache.clear();}
}
