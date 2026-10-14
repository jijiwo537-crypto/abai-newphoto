import React from 'react';
import {PREMIUM_GLASS} from '../utils/premiumGlass';
import {canExportHeic} from '../utils/heicExport';
import {collageVideoMime,type CollageVideoFormat} from '../utils/collageVideoFormat';
type Props={label:string;panelRef:React.Ref<HTMLDivElement>;imageFormat:'jpg'|'png'|'heic';videoFormat:CollageVideoFormat;fps:number;quality:number;
 onImage:(v:'jpg'|'png'|'heic')=>void;onVideo:(v:CollageVideoFormat)=>void;onFps:(v:number)=>void;onQuality:(v:number)=>void};
/* 切換按鈕時會閃一下（電腦上特別明顯）：面板原本是毛玻璃（backdrop-filter），
   裡面的按鈕一按就有縮放動畫，Chrome 會因此把整片毛玻璃重新取樣、閃一格；
   再加上每按一次整個編輯器都要重新 render，亮起來的那顆會慢半拍。
   所以這個面板改成不透明的底、按鈕不做縮放與漸變，選中的那顆先在面板裡立刻亮起，
   真正的設定再交給編輯器（不急的更新，不擋住這一格畫面）。 */
const Row=({label,value,choices,onChange,disabled}:{label:string;value:string;choices:readonly (readonly [string,string])[];onChange:(value:string)=>void;disabled?:(value:string)=>boolean})=>{
 const [shown,setShown]=React.useState(value);
 React.useEffect(()=>setShown(value),[value]);
 return <div className="flex flex-col gap-1.5"><span className="text-[10px] text-white/50">{label}</span><div className="flex gap-1.5">{choices.map(([v,name])=><button key={v} aria-pressed={shown===v} disabled={disabled?.(v)} onClick={()=>{if(v===shown)return;setShown(v);React.startTransition(()=>onChange(v));}} className={`flex-1 h-8 rounded-lg text-[11px] font-medium disabled:text-white/30 ${shown===v?'bg-white text-black':'bg-[#303034] text-white/90'}`}>{name}</button>)}</div></div>;};
const PANEL={background:'rgb(16,16,19)',boxShadow:PREMIUM_GLASS.boxShadow} as const;
/** Shared markup: both collage editors have exactly the same export panel. */
export function CollageExportOptions(p:Props){return <div ref={p.panelRef} role="dialog" aria-label={p.label} data-collage-export-options style={PANEL} className="absolute left-4 right-4 top-full mt-2 z-[81] p-3 rounded-2xl border border-white/15 flex flex-col gap-3">
 <Row label="圖片格式" value={p.imageFormat} choices={[['jpg','JPG'],['png','PNG'],['heic','HEIC']]} disabled={v=>v==='heic'&&!canExportHeic()} onChange={v=>p.onImage(v as Props['imageFormat'])}/>
 <Row label="影片格式" value={p.videoFormat} choices={[['auto','自動'],['mp4','MP4'],['mov','MOV']]} disabled={v=>v!=='auto'&&!collageVideoMime(v as CollageVideoFormat)} onChange={v=>p.onVideo(v as CollageVideoFormat)}/>
 <Row label="影片幀率" value={String(p.fps)} choices={[['0','自動'],['30','30'],['50','50'],['60','60'],['120','120']]} onChange={v=>p.onFps(Number(v))}/>
 <Row label="影片畫質" value={String(p.quality)} choices={[['16000000','標準'],['28000000','高'],['40000000','最高']]} onChange={v=>p.onQuality(Number(v))}/>
 </div>;}
