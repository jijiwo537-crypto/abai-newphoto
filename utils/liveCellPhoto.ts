import type {PhotoFx} from './photoFx';

type Listener=(fx:PhotoFx)=>void;
const listeners=new Map<string,Set<Listener>>();
export function subscribeCellPhoto(id:string,listener:Listener){
  let set=listeners.get(id);if(!set)listeners.set(id,set=new Set());set.add(listener);
  return()=>{set!.delete(listener);if(!set!.size)listeners.delete(id);};
}
/** Drag frames update only the photo surface. The document is committed once
 * at the end of the gesture, so other pages and controls are not rebuilt. */
export function updateCellPhoto(id:string,fx:PhotoFx){listeners.get(id)?.forEach(fn=>fn(fx));}
