/** Crop raster work, not resolution. Coordinates remain in full-scene pixels. */
export function previewViewport(fullW:number, fullH:number, frame:{left:number;top:number;width:number;height:number}, stage:{left:number;top:number;right:number;bottom:number}, overscan=24) {
 const sx=fullW/Math.max(1,frame.width),sy=fullH/Math.max(1,frame.height);
 const x=Math.max(0,Math.min(fullW-1,Math.floor((stage.left-overscan-frame.left)*sx)));
 const y=Math.max(0,Math.min(fullH-1,Math.floor((stage.top-overscan-frame.top)*sy)));
 const right=Math.max(x+1,Math.min(fullW,Math.ceil((stage.right+overscan-frame.left)*sx)));
 const bottom=Math.max(y+1,Math.min(fullH,Math.ceil((stage.bottom+overscan-frame.top)*sy)));
 return {x,y,w:right-x,h:bottom-y};
}
