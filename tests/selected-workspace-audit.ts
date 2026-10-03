// Mounted regression exercises React's real capture/bubble handlers, rather
// than calling editor functions directly. It also runs in iPhone Safari.
void(async()=>{
 const wait=async(n=8)=>{for(let i=0;i<n;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));};
 const query=new URLSearchParams(location.search),expectedPhotos=query.has('single')?1:query.has('nine')?9:2;
 const report:any={kind:'creative-selected-gestures',photos:expectedPhotos,ua:navigator.userAgent,checks:[]};
 const check=(name:string,pass:boolean,detail?:any)=>report.checks.push({name,pass,detail});
 type Pt={id:number;x:number;y:number;target:Element};
 const pointer=(type:string,p:Pt)=>p.target.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:p.id,pointerType:'touch',isPrimary:p.id===1,clientX:p.x,clientY:p.y,buttons:type==='pointerup'?0:1}));
 const tap=async(target:Element,x:number,y:number)=>{const p={id:1,x,y,target};pointer('pointerdown',p);pointer('pointerup',p);await wait();};
 const drag=async(target:Element,x:number,y:number,dx:number,dy:number)=>{const p={id:1,x,y,target};pointer('pointerdown',p);await wait(2);for(let i=1;i<=6;i++){const m={...p,x:x+dx*i/6,y:y+dy*i/6};pointer('pointermove',m);await wait(1);}pointer('pointerup',{...p,x:x+dx,y:y+dy});await wait();};
 const pinch=async(target:Element,x:number,y:number)=>{
  const a={id:1,x:x-22,y,target},b={id:2,x:x+22,y,target};pointer('pointerdown',a);pointer('pointerdown',b);await wait(2);
  for(let i=1;i<=6;i++){const p={...a,x:a.x-i*4},r={...b,x:b.x+i*4};pointer('pointermove',p);pointer('pointermove',r);await wait(1);}
  pointer('pointerup',{...a,x:a.x-24});pointer('pointerup',{...b,x:b.x+24});await wait();
 };
 try{
  let stage:HTMLElement|null=null;for(let i=0;i<500;i++){stage=document.querySelector<HTMLElement>('[data-creative-stage]');if(stage&&(stage.dataset.photoCount===String(expectedPhotos)&&stage.querySelector('canvas')?.width))break;await wait(1);}if(!stage)throw Error('editor not ready');await wait(30);
  {
   const geom=()=>JSON.parse(stage!.dataset.sceneGeometry!);
   const obj=(id:string)=>JSON.parse(stage!.dataset.sceneObjects!).find((o:any)=>o.id===id);
   const textureWidth=()=>{const c=stage!.querySelector<HTMLCanvasElement>('canvas')!,g=geom(),o=obj('test-shape');const x=Math.round((o.x+o.w/2)*c.width/g.cw),y=Math.round((o.y+o.h/2)*c.height/g.ch),row=c.getContext('2d')!.getImageData(x-20,y,41,1).data;let n=0;for(let i=20;i<41;i++){if(row[i*4]>180&&row[i*4+1]<80&&row[i*4+2]>180)n++;else break;}for(let i=19;i>=0;i--){if(row[i*4]>180&&row[i*4+1]<80&&row[i*4+2]>180)n++;else break;}return n;};
   const coord=(x:number,y:number)=>{const r=stage!.querySelector('canvas')!.getBoundingClientRect(),g=geom();return{x:r.left+x*r.width/g.cw,y:r.top+y*r.height/g.ch};};
   // Select each vector object, then operate over another photo, not over it.
   for(const id of ['test-shape','test-text','test-symbol','test-photo']){
    const o=obj(id),c=coord(o.x+o.w/2,o.y+o.h/2);await tap(stage,c.x,c.y);check(id+' selects',stage.dataset.selectedObject===id,stage.dataset.selectedObject);
    const g=geom(),away=coord(g.ix+g.iw*.8,g.iy+g.ih*.85),before=obj(id);await drag(stage,away.x,away.y,19,16);const moved=obj(id);
    check(id+' moves from another photo',Math.hypot(moved.x-before.x,moved.y-before.y)>5&&stage.dataset.selectedObject===id,{before,moved});
    const pre=obj(id),dotBefore=id==='test-shape'?textureWidth():0;await pinch(stage,away.x,away.y);const post=obj(id);check(id+' pinches from another photo',post.w>pre.w*1.2&&stage.dataset.selectedObject===id,{pre,post});
    if(id==='test-shape'){const dotAfter=textureWidth();check('shape texture enlarges with the shape (rendered pixels)',dotBefore>0&&dotAfter>dotBefore*1.4,{before:dotBefore,after:dotAfter});}
    if(id==='test-shape'){
     const before=obj(id),g=geom(),rr=stage.querySelector('canvas')!.getBoundingClientRect();
     const a={id:1,x:away.x-22,y:away.y,target:stage},m={...a,x:a.x+13,y:a.y+7},b={id:2,x:m.x+44,y:m.y,target:stage};
     pointer('pointerdown',a);pointer('pointermove',m);pointer('pointerdown',b);await wait(2);
     pointer('pointermove',{...m,x:m.x-12});pointer('pointermove',{...b,x:b.x+12});await wait(3);
     pointer('pointerup',{...m,x:m.x-12});pointer('pointerup',{...b,x:b.x+12});await wait();
     const after=obj(id),expected={x:before.x+before.w/2+13*g.cw/rr.width,y:before.y+before.h/2+7*g.ch/rr.height};
     check('same-frame drag to pinch preserves the new center',Math.hypot(after.x+after.w/2-expected.x,after.y+after.h/2-expected.y)<1,{expected,actual:{x:after.x+after.w/2,y:after.y+after.h/2}});
    }
    await tap(stage,stage.getBoundingClientRect().left+6,stage.getBoundingClientRect().top+6);
   }
   // A selected region photo remains the owner when starting outside its cell.
   if(expectedPhotos>1){
   const g=geom(),p=coord(g.ix+g.iw*.25,g.iy+g.ih*.7);await tap(stage,p.x,p.y);check('region photo selects',stage.dataset.selectedRegionPhoto!=='',stage.dataset.selectedRegionPhoto);
   const idx=Number(stage.dataset.selectedRegionPhoto),poses=()=>JSON.parse(stage!.dataset.photoTransforms!);
   const margin={x:stage.getBoundingClientRect().left+18,y:stage.getBoundingClientRect().top+20};
   const before=poses();await pinch(stage,margin.x+50,margin.y);const after=poses();check('selected photo zooms from black margin',after[idx].zoom>before[idx].zoom+.2&&stage.dataset.selectedRegionPhoto===String(idx),{before,after});
   const a=poses();await drag(stage,margin.x,margin.y,15,18);const b=poses();check('selected photo pans from black margin',Math.hypot(a[idx].x-b[idx].x,a[idx].y-b[idx].y)>.001&&stage.dataset.selectedRegionPhoto===String(idx),{a,b});
   await tap(stage,margin.x,margin.y);check('stationary blank tap still deselects',stage.dataset.selectedRegionPhoto==='');
   // A second finger cancels pending photo swapping, but does not suppress pinch.
   const free=coord(g.ix+g.iw*.9,g.iy+g.ih*.1),finger={id:1,...free,target:stage},second={id:2,x:free.x-35,y:free.y,target:stage};
   pointer('pointerdown',finger);await wait(5);pointer('pointerdown',second);await new Promise(r=>setTimeout(r,400));
   check('second finger cancels the long-press thumbnail',!document.querySelector('[data-creative-swap-thumbnail]'));
   pointer('pointerup',finger);pointer('pointerup',second);await wait();
   const photoObjects=()=>JSON.parse(stage!.dataset.photoObjects!),photoBefore=photoObjects().find((p:any)=>p.id==='test-photo');
   pointer('pointerdown',finger);await new Promise(r=>setTimeout(r,400));await wait(2);
   const thumb=document.querySelector('[data-creative-swap-thumbnail]')?.getBoundingClientRect();
   check('photo long press still starts and centers the thumbnail',!!thumb&&Math.hypot(thumb.x+thumb.width/2-free.x,thumb.y+thumb.height/2-free.y)<1);
   const targetPhoto=obj('test-photo'),drop=coord(targetPhoto.x+targetPhoto.w/2,targetPhoto.y+targetPhoto.h/2);
   pointer('pointermove',{...finger,...drop});pointer('pointerup',{...finger,...drop});await wait();
   check('region and added photo can still swap',photoObjects().find((p:any)=>p.id==='test-photo').src!==photoBefore.src);
   check('swap thumbnail clears on release',!document.querySelector('[data-creative-swap-thumbnail]'));
   }
   const margin={x:stage.getBoundingClientRect().left+18,y:stage.getBoundingClientRect().top+20};
   const w0=stage.querySelector('canvas')!.parentElement!.getBoundingClientRect().width;await pinch(stage,margin.x+50,margin.y);const w1=stage.querySelector('canvas')!.parentElement!.getBoundingClientRect().width;check('no selection still pinches the entire preview',w1>w0*1.2,{before:w0,after:w1,object:stage.dataset.selectedObject,photo:stage.dataset.selectedRegionPhoto});
  }
  report.pass=report.checks.every((c:any)=>c.pass);
 }catch(e){report.pass=false;report.error=String(e);}
 const pre=document.createElement('pre');pre.id='selected-gesture-result';pre.dataset.report=JSON.stringify(report);pre.style.cssText='position:fixed;top:60px;left:8px;max-width:96vw;max-height:220px;overflow:auto;background:#111e;color:white;font-size:10px;z-index:999999';pre.textContent=`${report.kind} (${report.photos} photos)\nPASS: ${report.pass} (${report.checks.filter((c:any)=>c.pass).length}/${report.checks.length})\n${report.error||''}\n`+report.checks.map((c:any)=>`${c.pass?'✓':'✕'} ${c.name}`).join('\n');document.body.append(pre);
})();
