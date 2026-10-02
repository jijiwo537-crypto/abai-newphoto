type Point={x:number;y:number};
type Bounds={left:number;top:number;right:number;bottom:number};
export function resolveSeamSurface(points:Point[],worldW:number,worldH:number,layoutW:number,layoutH:number,bounds:Bounds,clip:Bounds,dpr:number){
  const [a,b,c]=points;
  const forward=new DOMMatrix([(b.x-a.x)/worldW,(b.y-a.y)/worldW,(c.x-a.x)/worldH,(c.y-a.y)/worldH,a.x,a.y]);
  const inverse=forward.inverse();
  // A screen pixel always samples the same world point, even as the visible
  // rectangle grows/shrinks by a pixel. No independently rounded photo offsets.
  const left=Math.floor(Math.max(bounds.left,clip.left)*dpr)/dpr,top=Math.floor(Math.max(bounds.top,clip.top)*dpr)/dpr;
  const right=Math.ceil(Math.min(bounds.right,clip.right)*dpr)/dpr,bottom=Math.ceil(Math.min(bounds.bottom,clip.bottom)*dpr)/dpr;
  if(right<=left||bottom<=top||!Number.isFinite(inverse.a))return null;
  const width=right-left,height=bottom-top,x0=inverse.a*left+inverse.c*top+inverse.e,y0=inverse.b*left+inverse.d*top+inverse.f;
  const sx=layoutW/worldW,sy=layoutH/worldH;
  return {
    width,height,pixelWidth:Math.round(width*dpr),pixelHeight:Math.round(height*dpr),
    transform:[inverse.a*sx,inverse.b*sy,inverse.c*sx,inverse.d*sy,x0*sx,y0*sy],
    clip:[a,b,{x:b.x+c.x-a.x,y:b.y+c.y-a.y},c].map(p=>`${p.x-left}px ${p.y-top}px`).join(','),
    rasterView:[inverse.a,inverse.b,inverse.c,inverse.d,x0,y0,width,height],
    view:{width:worldW,height:worldH,xx:inverse.a*width,xy:inverse.c*height,x0,yx:inverse.b*width,yy:inverse.d*height,y0},
  };
}
