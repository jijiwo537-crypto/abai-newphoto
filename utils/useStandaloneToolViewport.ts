import {useLayoutEffect,useRef} from 'react';
import {isHomeScreenWebApp} from './native';

/**
 * 跟 ArtStudio 一樣，在 iOS 主畫面 App 用實體邊緣定位。WebKit 可能已經從 dvh 扣掉狀態列，
 * 再扣一次會在工具列下面多一條黑邊；一般的 Safari 不受影響
 */
export function useStandaloneToolViewport(){
 const ref=useRef<HTMLDivElement>(null);
 const standalone=isHomeScreenWebApp();
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
