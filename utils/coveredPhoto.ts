import {scenePixelEdge} from './scenePixelGrid';

/**
 * 保留裁切連續的取樣變換，同時讓共用的格子邊緣剛好只歸一個點陣像素。在裁切下面延伸來源的邊緣像素，
 * drawImage 才不會產生透明的反鋸齒邊
 */
export function drawCoveredPhoto(ctx:CanvasRenderingContext2D,image:CanvasImageSource,
  sx:number,sy:number,sw:number,sh:number,x:number,y:number,w:number,h:number) {
  const m=ctx.getTransform();
  if(m.b||m.c||m.a<=0||m.d<=0||w<=0||h<=0){ctx.drawImage(image,sx,sy,sw,sh,x,y,w,h);return;}
  const source=image as any,iw=source.naturalWidth||source.videoWidth||source.width,ih=source.naturalHeight||source.videoHeight||source.height;
  const dx=m.a*x+m.e,dy=m.d*y+m.f,dw=m.a*w,dh=m.d*h;
  const left=scenePixelEdge(dx),top=scenePixelEdge(dy),right=scenePixelEdge(dx+dw),bottom=scenePixelEdge(dy+dh);
  if(right<=left||bottom<=top)return;
  const kx=dw/sw,ky=dh/sh,ix=dx-sx*kx,iy=dy-sy*ky;
  ctx.save();ctx.setTransform(1,0,0,1,0,0);
  ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
  // 在裁切下面畫整張原圖，照片內的裁切邊緣取樣到的就是鄰近像素，不是另外反鋸齒的圖片矩形
  const pad=2;
  if(Math.abs(ix-left)<pad)ctx.drawImage(image,0,0,1,ih,left-pad,iy,Math.max(0,ix-left+pad),ih*ky);
  if(Math.abs(ix+iw*kx-right)<pad)ctx.drawImage(image,iw-1,0,1,ih,ix+iw*kx,iy,Math.max(0,right+pad-ix-iw*kx),ih*ky);
  if(Math.abs(iy-top)<pad)ctx.drawImage(image,0,0,iw,1,ix,top-pad,iw*kx,Math.max(0,iy-top+pad));
  if(Math.abs(iy+ih*ky-bottom)<pad)ctx.drawImage(image,0,ih-1,iw,1,ix,iy+ih*ky,iw*kx,Math.max(0,bottom+pad-iy-ih*ky));
  // 兩條來源邊界都碰到格子轉角時需要轉角的取樣
  for(const [px,py,tx,ty,tw,th] of [
    [0,0,left-pad,top-pad,ix-left+pad,iy-top+pad],
    [iw-1,0,ix+iw*kx,top-pad,right+pad-ix-iw*kx,iy-top+pad],
    [0,ih-1,left-pad,iy+ih*ky,ix-left+pad,bottom+pad-iy-ih*ky],
    [iw-1,ih-1,ix+iw*kx,iy+ih*ky,right+pad-ix-iw*kx,bottom+pad-iy-ih*ky],
  ])if(tw>0&&th>0&&tw<=2*pad&&th<=2*pad)ctx.drawImage(image,px,py,1,1,tx,ty,tw,th);
  ctx.drawImage(image,0,0,iw,ih,ix,iy,iw*kx,ih*ky);ctx.restore();
}
