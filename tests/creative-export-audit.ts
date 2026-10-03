/** Real file encoding audit. Interception records arguments without changing encoding. */
void(async()=>{
 const next=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));
 const wait=async(n=3)=>{for(let i=0;i<n;i++)await next();};
 const report:any={kind:'creative-export',ua:navigator.userAgent,checks:[]};
 const check=(name:string,pass:boolean,detail?:any)=>report.checks.push({name,pass,detail});
 const click=(selector:string)=>{const b=document.querySelector<HTMLButtonElement>(selector);if(!b)throw Error('Missing '+selector);b.click();};
 const text=(name:string)=>{const b=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===name);if(!b)throw Error('Missing '+name);b.click();};
 const until=async(selector:string)=>{for(let i=0;i<3600;i++){const e=document.querySelector<HTMLMediaElement>(selector);if(e?.getAttribute('src'))return e;await next();}throw Error('Export timed out');};
 const capture=HTMLCanvasElement.prototype.captureStream,Recorder=window.MediaRecorder;
 let requestedFps=0,options:MediaRecorderOptions|undefined;
 try{
  for(let i=0;i<600;i++){if(document.querySelector('[data-creative-stage] canvas')?.getAttribute('width'))break;await next();}await wait(30);
  click('[data-creative-export-options-toggle]');await wait();text('JPG');text('30');text('標準');await wait();
  const mp4=[...document.querySelectorAll<HTMLButtonElement>('[aria-label="創意拼圖匯出設定"] button')].find(b=>b.textContent==='MP4');
  const format=mp4&&!mp4.disabled?'MP4':'WEBM';text(format);await wait();click('[data-creative-export-options-toggle]');text('儲存');text('儲存圖片');
  const img=await until('[data-export-media] img'),jpg=await(await fetch(img.getAttribute('src')!)).blob();
  const bytes=new Uint8Array(await jpg.arrayBuffer());check('JPG choice produces actual JPEG bytes',jpg.type==='image/jpeg'&&bytes[0]===255&&bytes[1]===216,{mime:jpg.type,size:jpg.size});
  text('繼續編輯');await wait();
  HTMLCanvasElement.prototype.captureStream=function(fps){requestedFps=fps||0;return capture.call(this,fps);};
  window.MediaRecorder=new Proxy(Recorder,{construct(target,args){options=args[1];return Reflect.construct(target,args);}});
  text('儲存');text('儲存影片');
  const video=await until('[data-export-media] video') as HTMLVideoElement,blob=await(await fetch(video.getAttribute('src')!)).blob();
  check('explicit format produces nonempty matching video',blob.size>100&&blob.type.startsWith(format==='MP4'?'video/mp4':'video/webm'),{mime:blob.type,size:blob.size});
  check('frame rate and quality reach the real encoder',requestedFps===30&&options?.videoBitsPerSecond===16000000,{requestedFps,options});
  for(let i=0;i<180;i++){if(video.readyState>=2)break;await next();}
  check('encoded video decodes with nonzero dimensions',video.readyState>=2&&video.videoWidth>0&&video.videoHeight>0,{width:video.videoWidth,height:video.videoHeight,duration:video.duration});
  report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.pass=false;report.error=String(e);}
 finally{HTMLCanvasElement.prototype.captureStream=capture;window.MediaRecorder=Recorder;}
 const pre=document.createElement('pre');pre.id='creative-export-result';pre.style.cssText='position:fixed;inset:70px 8px auto;z-index:999999;max-height:260px;overflow:auto;background:#111e;color:white;font-size:11px';pre.textContent=JSON.stringify(report,null,2);document.body.append(pre);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
