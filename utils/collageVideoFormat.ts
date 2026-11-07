export type CollageVideoFormat='auto'|'mp4'|'mov';
/** 編碼器真的做得出那種容器，那個格式才算可用 */
export function collageVideoMime(format:CollageVideoFormat,supported:(mime:string)=>boolean= mime=>typeof MediaRecorder!=='undefined'&&MediaRecorder.isTypeSupported(mime)){
 const types=format==='mov'?['video/quicktime;codecs=avc1','video/quicktime']
  :format==='mp4'?['video/mp4;codecs=avc1','video/mp4']
  :['video/mp4;codecs=avc1','video/mp4','video/webm;codecs=vp9','video/webm'];
 return types.find(supported)||'';
}
