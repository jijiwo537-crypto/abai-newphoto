import {useLayoutEffect,useRef} from 'react';

/** Same physical-edge anchoring used by ArtStudio for iOS Home Screen apps.
 * WebKit can already subtract the status bar from dvh. Subtracting it again
 * leaves an extra black strip below the toolbar; normal Safari is unaffected.
 */
export function useStandaloneToolViewport(){
 const ref=useRef<HTMLDivElement>(null);
 const standalone=(navigator as Navigator&{standalone?:boolean}).standalone===true;
 useLayoutEffect(()=>{
  if(!standalone)return;
  const visual=window.visualViewport;
  const align=()=>{
   if(document.activeElement?.matches('input,textarea,[contenteditable=true]'))return;
   ref.current?.style.setProperty('--tool-native-offset',`${visual?.offsetTop||0}px`);
  };
  visual?.addEventListener('resize',align);visual?.addEventListener('scroll',align);
  align();const frame=requestAnimationFrame(align);
  return()=>{cancelAnimationFrame(frame);visual?.removeEventListener('resize',align);visual?.removeEventListener('scroll',align);};
 },[standalone]);
 return{ref,standalone};
}

export const standaloneToolViewportCSS=`
.standalone-tool-viewport.safe-top{
 position:absolute;inset:0;
 top:calc(env(safe-area-inset-top,0px) + var(--tool-native-offset,0px));
 bottom:calc(-1 * (env(safe-area-inset-top,0px) + var(--tool-native-offset,0px)));
 height:auto!important;max-height:none!important;margin-top:0;padding:0;transform:none;
}`;
