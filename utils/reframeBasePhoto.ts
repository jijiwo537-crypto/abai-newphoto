type Frame = {iw:number;ih:number;layout:string};
type Pose = {x:number;y:number;w:number;h:number};
/** Same immutable starting pose for live occupancy and its final commit. */
export function reframeBasePhoto(t:Pose,prev:Frame,next:Frame,bw:number,bh:number,multi:boolean,around:string):Pose {
  const oldK=prev.layout===around?Math.max(prev.iw/Math.max(1,bw),prev.ih/Math.max(1,bh)):1;
  const newK=next.layout===around?Math.max(next.iw/Math.max(1,bw),next.ih/Math.max(1,bh)):1;
  if(multi)return {x:t.x*oldK/prev.iw*next.iw/newK,y:t.y*oldK/prev.ih*next.ih/newK,w:t.w*oldK/prev.iw*next.iw/newK,h:t.h*oldK/prev.ih*next.ih/newK};
  const fx=(prev.iw/2-t.x*oldK)/Math.max(1,t.w*oldK),fy=(prev.ih/2-t.y*oldK)/Math.max(1,t.h*oldK);
  const cover=Math.max(1,next.iw/Math.max(1,t.w*newK),next.ih/Math.max(1,t.h*newK));
  const w=t.w*cover,h=t.h*cover;
  return {x:Math.min(0,Math.max(next.iw-w*newK,next.iw/2-fx*w*newK))/newK,y:Math.min(0,Math.max(next.ih-h*newK,next.ih/2-fy*h*newK))/newK,w,h};
}
