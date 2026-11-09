export type CollageVideoFormat='auto'|'mp4'|'mov';
/** 編碼器真的做得出那種容器，那個格式才算可用 */
export function collageVideoMime(format:CollageVideoFormat,supported:(mime:string)=>boolean= mime=>typeof MediaRecorder!=='undefined'&&MediaRecorder.isTypeSupported(mime)){
 const types=format==='mov'?['video/quicktime;codecs=avc1','video/quicktime']
  :format==='mp4'?['video/mp4;codecs=avc1','video/mp4']
  :['video/mp4;codecs=avc1','video/mp4','video/webm;codecs=vp9','video/webm'];
 return types.find(supported)||'';
}

/* ── 影片畫質＝解析度 ───────────────────────────────────────────────
   720p／1080p／2K／4K 指的是「短邊」的像素（直式 1080p＝1080×1920），任何比例都通用。
   碼率跟著像素數與幀率算（每像素每格固定的位元數），不再讓使用者猜「高」「最高」是多少。 */
export type CollageVideoRes=720|1080|1440|2160;
export const VIDEO_RES_CHOICES:readonly (readonly [string,string])[]=[['720','720p'],['1080','1080p'],['1440','2K'],['2160','4K']];
/** 長邊、總像素的上限：手機硬體編碼器（HEVC／H.264）吃得下、記憶體也安全的範圍 */
const VIDEO_MAX_LONG=4096,VIDEO_MAX_PIXELS=8_912_896;
/** 把 w×h 的版面縮放到所選解析度的倍率（短邊＝res，但不超過長邊與總像素上限） */
export function videoScaleFor(res:number,w:number,h:number){
 const W=Math.max(1,w),H=Math.max(1,h);
 return Math.min(res/Math.min(W,H),VIDEO_MAX_LONG/Math.max(W,H),Math.sqrt(VIDEO_MAX_PIXELS/(W*H)));
}
/** 碼率：約每像素每格 0.1 bit（30fps 的 1080p≈6～8Mbps 的兩倍，留足畫質），幀率越高給越多但不線性 */
export function videoBitrateFor(w:number,h:number,fps:number){
 const f=Math.max(24,Math.min(120,fps||30));
 const b=w*h*30*0.2*Math.pow(f/30,0.7);
 return Math.round(Math.max(4_000_000,Math.min(60_000_000,b)));
}
