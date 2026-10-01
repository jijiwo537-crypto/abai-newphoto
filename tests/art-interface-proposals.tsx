// Lab-only entry. All effects, controls, history and exports are the actual app
// component; switching proposals changes only layout, never its mounted state.
import React,{useState,useLayoutEffect,useEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {ArtStudio} from '../components/ArtStudio';
import {installSliderTouch} from '../utils/sliderTouch';
import '../styles.css';
import './art-interface-proposals.css';
installSliderTouch();
const plans=[{id:'a',name:'A｜編輯式',detail:'下方分類固定，工具與參數分層排列。'},{id:'b',name:'B｜拼圖式',detail:'先選分類，再向下調整；操作區完整靠近手指。'},{id:'c',name:'C｜側欄式',detail:'左側固定分類，右側集中參數，減少來回找工具。'}];
function Lab(){
 const [plan,setPlan]=useState(new URLSearchParams(location.search).get('plan')||'a'),[scale,setScale]=useState(1),[notice,setNotice]=useState('');
 const holder=useRef<HTMLDivElement>(null),file=useRef<HTMLInputElement>(null),iframe=useRef<HTMLIFrameElement>(null),photo=useRef('');
 const frameSrc=useRef(`?embedded&plan=${plan}`);
 useEffect(()=>{iframe.current?.contentWindow?.postMessage({type:'proposal-plan',plan},location.origin);},[plan]);
 useEffect(()=>()=>{if(photo.current)URL.revokeObjectURL(photo.current);},[]);
 useLayoutEffect(()=>{const fit=()=>{if(document.activeElement?.matches('input:not([type=range]),textarea'))return;setScale(Math.min(1,(innerWidth-24)/390,(innerHeight-138)/844));};fit();addEventListener('resize',fit);return()=>removeEventListener('resize',fit);},[]);
 const current=plans.find(p=>p.id===plan)||plans[0];
 const copy=async()=>{const text=`ABAI 藝術效果介面｜我要採用 ${current.name}\n${current.detail}\n保留 ASCII 與視覺追蹤的全部現有功能。`;try{await navigator.clipboard.writeText(text);setNotice('已複製方案');}catch{setNotice(text);}};
 return <main className="proposal-lab"><header className="proposal-switch"><a href="../index.html" aria-label="返回效果實驗室">‹</a><nav aria-label="介面方案">{plans.map(p=><button key={p.id} aria-pressed={plan===p.id} onClick={()=>{setPlan(p.id);history.replaceState(null,'',`?plan=${p.id}`);}}>{p.name}</button>)}</nav><button className="proposal-copy" onClick={copy}>保留</button></header>
 <div className="proposal-caption"><span>{current.detail}</span><button onClick={()=>file.current?.click()}>換照片</button></div>
 <div className="proposal-holder" ref={holder} style={{width:390*scale,height:844*scale}}><iframe title="手機尺寸藝術效果介面" ref={iframe} className="proposal-iframe" src={frameSrc.current} style={{transform:`scale(${scale})`}} onLoad={()=>iframe.current?.contentWindow?.postMessage({type:'proposal-plan',plan},location.origin)}/></div>
 <footer className="proposal-foot">三方案共用正式版的全部工具；切換方案不會重設參數。</footer>
 <input hidden ref={file} type="file" accept="image/*" onChange={e=>{const f=e.target.files?.[0];if(f){if(photo.current)URL.revokeObjectURL(photo.current);photo.current=URL.createObjectURL(f);iframe.current?.contentWindow?.postMessage({type:'proposal-photo',photo:photo.current},location.origin);}e.target.value='';}}/>
 {notice&&<button className="proposal-notice" onClick={()=>setNotice('')}>{notice}</button>}
 </main>;
}
function Phone(){
 const [plan,setPlan]=useState(new URLSearchParams(location.search).get('plan')||'a'),[photo,setPhoto]=useState('');
 useEffect(()=>{const receive=(event:MessageEvent)=>{if(event.origin!==location.origin||event.source!==parent)return;if(event.data.type==='proposal-plan'&&plans.some(p=>p.id===event.data.plan))setPlan(event.data.plan);if(event.data.type==='proposal-photo')setPhoto(event.data.photo);};addEventListener('message',receive);return()=>removeEventListener('message',receive);},[]);
 return <div className={`proposal-phone proposal-${plan}`}>
  <div className="proposal-status"><span>9:41</span><div><span>▮▮▮</span><svg width="17" height="14" viewBox="0 0 20 16" fill="none"><path d="M2 5Q10 -2 18 5M5 8Q10 3 15 8M8 11Q10 9 12 11" stroke="white" strokeWidth="1.8" strokeLinecap="round"/><circle cx="10" cy="14" r="1" fill="white"/></svg><span className="proposal-battery">100</span></div></div>
  <ArtStudio key={photo||'empty'} initialSrc={photo} onClose={()=>{parent.location.href='../index.html';}}/>
  <div className="proposal-home-indicator"/>
 </div>;
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('embedded')?<Phone/>:<Lab/>);
