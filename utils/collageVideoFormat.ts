export type CollageVideoFormat='auto'|'mp4'|'mov';
/** A format is available only if the encoder can actually produce its container. */
export function collageVideoMime(format:CollageVideoFormat,supported:(mime:string)=>boolean= mime=>typeof MediaRecorder!=='undefined'&&MediaRecorder.isTypeSupported(mime)){
 const types=format==='mov'?['video/quicktime;codecs=avc1','video/quicktime']
  :format==='mp4'?['video/mp4;codecs=avc1','video/mp4']
  :['video/mp4;codecs=avc1','video/mp4','video/webm;codecs=vp9','video/webm'];
 return types.find(supported)||'';
}
