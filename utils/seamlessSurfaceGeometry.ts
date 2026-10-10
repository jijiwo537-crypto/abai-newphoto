type Point={x:number;y:number};
type Bounds={left:number;top:number;right:number;bottom:number};
/** grow：佈局哪幾邊要往外多蓋一點（螢幕 px）。佈局貼齊或超出頁面邊緣時用：
 *  外框的裁切線在 iOS 會做抗鋸齒，邊上那一排像素只蓋住一部分，底下頁面的白底就透出來
 *  —— 放大縮小預覽時四周一直閃白線。往外多蓋一個裝置像素，頁面底色就完全被蓋住；
 *  多出來的那一點由著色器延伸最外圈的照片像素補上（sealEdges）。只處理沒有轉角度的佈局。 */
export type SeamGrow={l:number;t:number;r:number;b:number};
export function resolveSeamSurface(points:Point[],worldW:number,worldH:number,layoutW:number,layoutH:number,bounds:Bounds,clip:Bounds,dpr:number,grow?:SeamGrow){
  const [a,b,c]=points;
  const axis=!!grow&&!!a&&!!b&&!!c&&Math.abs(b.y-a.y)<1e-3&&Math.abs(c.x-a.x)<1e-3&&b.x>a.x&&c.y>a.y;
  if(axis)bounds={left:bounds.left-grow!.l,top:bounds.top-grow!.t,right:bounds.right+grow!.r,bottom:bounds.bottom+grow!.b};
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
    clip:(axis?[{x:a.x-grow!.l,y:a.y-grow!.t},{x:b.x+grow!.r,y:b.y-grow!.t},{x:b.x+grow!.r,y:c.y+grow!.b},{x:a.x-grow!.l,y:c.y+grow!.b}]
      :[a,b,{x:b.x+c.x-a.x,y:b.y+c.y-a.y},c]).map(p=>`${p.x-left}px ${p.y-top}px`).join(','),
    rasterView:[inverse.a,inverse.b,inverse.c,inverse.d,x0,y0,width,height],
    view:{width:worldW,height:worldH,xx:inverse.a*width,xy:inverse.c*height,x0,yx:inverse.b*width,yy:inverse.d*height,y0},
  };
}
