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

const primers=new Map<string,Set<()=>void>>();
export function subscribeCellPrime(id:string,listener:()=>void){
  let set=primers.get(id);if(!set)primers.set(id,set=new Set());set.add(listener);
  return()=>{set!.delete(listener);if(!set!.size)primers.delete(id);};
}
/** The photo was opened for editing: prepare its live preview pipeline while
 * idle, so the first slider frame does not pay for decode/upload/compile. */
export function primeCellPhoto(id:string){primers.get(id)?.forEach(fn=>fn());}
