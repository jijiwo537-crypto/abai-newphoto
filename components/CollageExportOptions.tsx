import React from 'react';
import {PREMIUM_GLASS} from '../utils/premiumGlass';
import {canExportHeic} from '../utils/heicExport';
import {collageVideoMime,type CollageVideoFormat} from '../utils/collageVideoFormat';
type Props={label:string;panelRef:React.Ref<HTMLDivElement>;imageFormat:'jpg'|'png'|'heic';videoFormat:CollageVideoFormat;fps:number;quality:number;
 onImage:(v:'jpg'|'png'|'heic')=>void;onVideo:(v:CollageVideoFormat)=>void;onFps:(v:number)=>void;onQuality:(v:number)=>void};
const Row=({label,value,choices,onChange,disabled}:{label:string;value:string;choices:readonly (readonly [string,string])[];onChange:(value:string)=>void;disabled?:(value:string)=>boolean})=><div className="flex flex-col gap-1.5"><span className="text-[10px] text-white/50">{label}</span><div className="flex gap-1.5">{choices.map(([v,name])=><button key={v} aria-pressed={value===v} disabled={disabled?.(v)} onClick={()=>onChange(v)} className={`flex-1 h-8 rounded-lg text-[11px] font-medium transition-colors active:scale-95 disabled:text-white/30 ${value===v?'bg-white text-black':'bg-[#303034] text-white/90'}`}>{name}</button>)}</div></div>;
/** Shared markup: both collage editors have exactly the same export panel. */
export function CollageExportOptions(p:Props){return <div ref={p.panelRef} role="dialog" aria-label={p.label} data-collage-export-options style={PREMIUM_GLASS} className="absolute left-4 right-4 top-full mt-2 z-[81] p-3 rounded-2xl border border-white/15 flex flex-col gap-3">
 <Row label="圖片格式" value={p.imageFormat} choices={[['jpg','JPG'],['png','PNG'],['heic','HEIC']]} disabled={v=>v==='heic'&&!canExportHeic()} onChange={v=>p.onImage(v as Props['imageFormat'])}/>
 <Row label="影片格式" value={p.videoFormat} choices={[['auto','自動'],['mp4','MP4'],['mov','MOV']]} disabled={v=>v!=='auto'&&!collageVideoMime(v as CollageVideoFormat)} onChange={v=>p.onVideo(v as CollageVideoFormat)}/>
 <Row label="影片幀率" value={String(p.fps)} choices={[['0','自動'],['30','30'],['50','50'],['60','60'],['120','120']]} onChange={v=>p.onFps(Number(v))}/>
 <Row label="影片畫質" value={String(p.quality)} choices={[['16000000','標準'],['28000000','高'],['40000000','最高']]} onChange={v=>p.onQuality(Number(v))}/>
 </div>;}
