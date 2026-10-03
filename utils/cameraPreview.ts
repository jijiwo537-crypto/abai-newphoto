/** Render the centred sensor crop once, directly at native screen pixels. */
export function cameraPreviewGeometry(width:number,height:number,dpr:number,sourceWidth:number,sourceHeight:number,limit=8192){
  const scale=Math.min(Math.max(1,dpr||1),limit/Math.max(1,width,height));
  const w=Math.max(1,Math.min(limit,Math.ceil(width*scale))),h=Math.max(1,Math.min(limit,Math.ceil(height*scale)));
  const aspect=w/h,sourceAspect=sourceWidth/sourceHeight;
  return {w,h,cropX:Math.min(1,aspect/sourceAspect),cropY:Math.min(1,sourceAspect/aspect)};
}

/** Basic browser fallback may return 640px; renegotiate against actual sensor capabilities. */
export async function preferCameraResolution(track:MediaStreamTrack,limit=8192){
  if(typeof track.getCapabilities!=='function'||typeof track.applyConstraints!=='function')return;
  try{
    const c=track.getCapabilities();
    if(!c.width?.max||!c.height?.max)return;
    const advanced:MediaTrackConstraintSet[]=[];
    if((c as any).focusMode?.includes('continuous'))advanced.push({focusMode:'continuous'} as any);
    await track.applyConstraints({width:{ideal:Math.min(limit,c.width.max)},height:{ideal:Math.min(limit,c.height.max)},
      frameRate:{ideal:30,max:30},resizeMode:'none',...(advanced.length?{advanced}:{})} as MediaTrackConstraints);
  }catch{/* Keep the working stream if the device cannot renegotiate. */}
}
