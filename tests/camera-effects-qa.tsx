import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../styles.css';
import {Viewfinder,FX_ZERO,type ViewfinderFx} from '../components/Viewfinder';
import {CAMERA_FX_ITEMS} from '../utils/cameraEffects';
import {CameraInterface} from '../components/CameraInterface';
import {warmLowfiLut} from '../utils/lowfiLut';
function Audit(){
 const ref=useRef<any>(null),[fx,setFx]=useState<ViewfinderFx>(FX_ZERO),[status,setStatus]=useState('驗證中');
 const source=useRef<HTMLCanvasElement|null>(null);
 const [picture,setPicture]=useState('');
 const [feed,setFeed]=useState<HTMLVideoElement|null>(null);
 useEffect(()=>{
  const c=document.createElement('canvas');c.width=480;c.height=720;
  const g=c.getContext('2d')!;g.fillStyle='#101820';g.fillRect(0,0,480,720);
  g.fillStyle='#e33b42';g.fillRect(30,45,140,140);g.fillStyle='#32ad69';g.fillRect(300,500,140,140);
  const gr=g.createRadialGradient(260,300,0,260,300,200);gr.addColorStop(0,'#fff');gr.addColorStop(.4,'#eee');gr.addColorStop(1,'#304055');g.fillStyle=gr;g.fillRect(60,100,360,420);
  source.current=c;setPicture(c.toDataURL());
  // A deterministic TexImageSource drives the real viewfinder RAF loop;
  // simulator cameras do not expose a physical sensor.
  Object.assign(c,{readyState:2,videoWidth:480,videoHeight:720});
  setFeed(c as unknown as HTMLVideoElement);
  const wait=async(n=3)=>{for(let i=0;i<n;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};
  const copy=document.createElement('canvas');copy.width=480;copy.height=720;const ctx=copy.getContext('2d',{willReadFrequently:true})!;
  const sample=()=>{const out=ref.current.renderStill(c,480,720);if(!out)throw Error('camera GPU pipeline unavailable');ctx.clearRect(0,0,480,720);ctx.drawImage(out,0,0);ref.current.releaseStill();return ctx.getImageData(0,0,480,720).data;};
  const report:any={kind:'camera-effects',ua:navigator.userAgent,checks:[]};
  const check=(name:string,pass:boolean,detail?:any)=>report.checks.push({name,pass,detail});
  void(async()=>{
   try{
    await warmLowfiLut();await wait(12);
    const live=document.querySelector<HTMLCanvasElement>('[data-camera-viewfinder]')!,bounds=live.getBoundingClientRect();
    check('live preview renders at native screen density',live.width>=Math.floor(bounds.width*devicePixelRatio)&&live.height>=Math.floor(bounds.height*devicePixelRatio),{width:live.width,height:live.height,cssWidth:bounds.width,cssHeight:bounds.height,dpr:devicePixelRatio});
    const base=sample();
    const pixel=(d:Uint8ClampedArray,x:number,y:number)=>Array.from(d.slice((y*480+x)*4,(y*480+x)*4+3));
    check('base orientation has red top-left, green bottom-right',pixel(base,40,60)[0]>180&&pixel(base,420,630)[1]>100);
    for(const item of CAMERA_FX_ITEMS){
     setFx({...FX_ZERO,[item.id]:item.on});await wait();const d=sample();
     let diff=0;for(let i=0;i<d.length;i+=4)diff+=Math.abs(d[i]-base[i])+Math.abs(d[i+1]-base[i+1])+Math.abs(d[i+2]-base[i+2]);
     check(item.label+' immediately renders a visible effect',diff>5000,{diff});
     const repeat=sample();let mismatch=0;for(let i=0;i<d.length;i++)if(d[i]!==repeat[i])mismatch++;
     check(item.label+' preview and shutter path stay deterministic',mismatch===0,{mismatch});
     check(item.label+' does not shift or flip framing',pixel(d,40,60)[0]>pixel(d,40,60)[1]&&pixel(d,420,630)[1]>pixel(d,420,630)[0],{top:pixel(d,40,60),bottom:pixel(d,420,630)});
    }
    setFx({soft:70,blur:70,soft2:60,halo:80,lowfi:50});await wait();const all=sample();
    check('all five effects render together without black output',all.some((v,i)=>i%4!==3&&v>100));
    const large=document.createElement('canvas');large.width=1440;large.height=2160;large.getContext('2d')!.drawImage(c,0,0,1440,2160);
    const out=ref.current.renderStill(large,1440,2160);check('shutter retains full requested resolution',out.width===1440&&out.height===2160);ref.current.releaseStill();
    setFx({...FX_ZERO,soft2:60});await wait();sample();
    // A landscape sensor in a portrait viewport must remain a centred,
    // sharp crop, not stretch a low-resolution CSS-scaled intermediate.
    c.width=1920;c.height=1080;Object.assign(c,{videoWidth:1920,videoHeight:1080});
    for(let y=0;y<1080;y+=8)for(let x=0;x<1920;x+=8){g.fillStyle=((x/8+y/8)%2)?'#fff':'#000';g.fillRect(x,y,8,8);}
    setFx(FX_ZERO);await wait(8);
    const liveCopy=document.createElement('canvas');liveCopy.width=live.width;liveCopy.height=live.height;
    const lg=liveCopy.getContext('2d',{willReadFrequently:true})!;lg.drawImage(live,0,0);
    const pixels=lg.getImageData(0,0,live.width,live.height).data;
    let dark=0,bright=0;for(let i=0;i<pixels.length;i+=4){if(pixels[i]<12)dark++;if(pixels[i]>243)bright++;}
    check('landscape sensor retains sharp fine detail in portrait preview',dark/pixels.length*4>.25&&bright/pixels.length*4>.25,{darkFraction:dark/pixels.length*4,brightFraction:bright/pixels.length*4});
    g.fillStyle='#e33b42';g.fillRect(880,460,160,160);await wait(3);lg.drawImage(live,0,0);
    const centre=lg.getImageData(Math.floor(live.width/2),Math.floor(live.height/2),1,1).data;
    check('GPU crop retains the exact sensor centre',centre[0]>200&&centre[1]<80,{centre:Array.from(centre)});
    report.pass=report.checks.every((c:any)=>c.pass);setStatus(report.pass?'全部通過':'有項目未通過');
   }catch(e){report.pass=false;report.error=String(e);setStatus(String(e));}
   await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
  })();
 },[]);
 useEffect(()=>{if(source.current&&ref.current){const out=ref.current.renderStill(source.current,480,720);if(out)ref.current.releaseStill();}},[fx]);
 return <main className="max-w-sm mx-auto bg-black text-white p-4"><h1>相機即時特效</h1><p>{status}</p>
 <div className="relative w-full" style={{aspectRatio:'2/3'}}>{picture&&<img src={picture} className="absolute inset-0 w-full h-full"/>}<Viewfinder ref={ref} video={feed} lutUrl="" exposure={0} kelvin={5000} isUserFacing={false} fx={fx}/></div>
 <div className="flex flex-wrap gap-2 pt-4">{CAMERA_FX_ITEMS.map(it=><button key={it.id} aria-pressed={fx[it.id]>0} className="border rounded-full px-3 py-2" onClick={()=>setFx(p=>({...p,[it.id]:p[it.id]?0:it.on}))}>{it.label}</button>)}</div></main>;
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('ui')?<CameraInterface onHome={()=>{}} lutList={[{id:'original',name:'原始',url:''}]} />:<Audit/>);
if(new URLSearchParams(location.search).has('returnAudit'))void import('./camera-return-audit');
