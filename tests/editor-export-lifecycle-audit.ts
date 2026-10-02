void(async()=>{
 const frame=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));
 const save=()=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.trim()==='儲存');
 while(!save()||document.querySelector('[data-editor-initial-loading]'))await frame();
 let flashes=0,successFrames=0,spinnerTransitions=0,lastSpinner=false;
 const observe=()=>{const success=!!document.querySelector('[data-export-screen]');const spinner=!!document.querySelector('[data-editor-initial-loading]')||!!document.querySelector('.animate-spin');if(spinner&&!lastSpinner)spinnerTransitions++;lastSpinner=spinner;if(success){successFrames++;if(spinner)flashes++;}};
 // Double clicks in the same event loop must create only one export job.
 save()!.click();save()!.click();
 for(let i=0;i<600&&!document.querySelector('[data-export-screen]');i++){await frame();observe();}
 if(!document.querySelector('[data-export-screen]'))throw new Error('Export did not complete');
 // Resize the underlying preview after success (same trigger as tool/header
 // changes). The editor's initial loading layer must never cover this result.
 const main=document.querySelector<HTMLElement>('[data-editor-preview-box]')!;
 if(!main)throw new Error('Missing preview ResizeObserver target');
 for(let i=0;i<180;i++){if(main)main.style.paddingBottom=i%2?'1px':'0px';await frame();observe();}
 const report={kind:'editor-export-lifecycle',ua:navigator.userAgent,pass:flashes===0&&spinnerTransitions===1&&successFrames>=180,flashes,spinnerTransitions,successFrames};
 const out=document.createElement('pre');out.id='export-lifecycle-result';out.style.cssText='position:fixed;top:60px;left:8px;z-index:999999;background:#111e;color:white;font-size:10px';out.textContent=JSON.stringify(report,null,2);document.body.append(out);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
})();
