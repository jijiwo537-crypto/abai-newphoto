const badge=document.createElement('pre');
badge.style.cssText='position:fixed;top:70px;left:12px;z-index:99999;background:#111;color:#fff;font:11px monospace;pointer-events:none;padding:8px;max-width:90vw';
document.body.append(badge);
let start:HTMLInputElement|null=null,scroll=0,moves=0,updates=0,last='ready';
let panel:HTMLElement|null=null;
const show=()=>{badge.textContent=`${last}\nmoves:${moves} updates:${updates} value:${start?.value}\npanel scroll:${panel?.scrollTop??0} delta:${(panel?.scrollTop??0)-scroll}`;};
document.addEventListener('pointerdown',e=>{
 const wrap=(e.target as HTMLElement).closest('.slider-wrap');if(!wrap)return;
 start=wrap.querySelector('input');if(!start)return;
 panel=wrap.parentElement;while(panel&&panel.scrollHeight<=panel.clientHeight)panel=panel.parentElement;
 scroll=panel?.scrollTop??0;moves=updates=0;last=`start ${e.pointerType} ${e.clientX.toFixed(0)},${e.clientY.toFixed(0)}`;show();
},true);
document.addEventListener('pointermove',()=>{if(start){moves++;show();}},true);
document.addEventListener('input',e=>{if(e.target===start){updates++;show();}},true);
document.addEventListener('pointerup',()=>{if(start){last='released';show();}},true);
document.addEventListener('pointercancel',()=>{if(start){last='cancelled';show();}},true);
show();
