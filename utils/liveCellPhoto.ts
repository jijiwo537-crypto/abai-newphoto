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

/* 正在編輯（調整面板開著）的那一格。編輯中先用 1800px 的預覽顯示（比螢幕需要的還細），
   不在每次點特效、閒下來時就算原圖尺寸的成品 —— 那一步每次都要開一個新的 GPU 管線、
   算完又馬上收掉，連續切換特效時就是一直開、一直關（iPhone 上很貴，也會頓一下）。
   關掉編輯（換選別格、離開調整）時才算一次。 */
let editingCell:string|null=null;
const editingListeners=new Set<()=>void>();
export function setEditingCell(id:string|null){if(editingCell===id)return;editingCell=id;editingListeners.forEach(fn=>fn());}
export function isEditingCell(id:string){return editingCell===id;}
export function subscribeEditingCell(fn:()=>void){editingListeners.add(fn);return()=>{editingListeners.delete(fn);};}
