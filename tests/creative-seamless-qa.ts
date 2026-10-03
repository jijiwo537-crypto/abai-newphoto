import {CreativeSeamless} from '../utils/creativeSeamless';
import {get2dWide} from '../utils/colorSpace';
const report:any={kind:'creative-seam-adapter',ua:navigator.userAgent,checks:[]};
const check=(name:string,pass:boolean,detail?:any)=>report.checks.push({name,pass,detail});
const painter=new CreativeSeamless();
try{
  const colors=['color(display-p3 1 .5 .2)','#2080ee','#777'];
  for(const color of colors){
    const original=document.createElement('canvas');original.width=original.height=80;
    const g=get2dWide(original)!;g.fillStyle=color;g.fillRect(0,0,80,80);
    const image=await new Promise<HTMLImageElement>(resolve=>{const img=new Image();img.onload=()=>resolve(img);img.src=original.toDataURL();});
    const source=g.getImageData(10,10,1,1).data,decoded=new Map([['a',image],['b',image]]);
    for(const [w,h,zoom,dx,dy] of [[360,270,1,0,0],[360,270,2.35,-240.7,-151.9],[2057,1198,1,0,0]]){
      const out=document.createElement('canvas');out.width=w;out.height=h;const ctx=get2dWide(out)!;
      ctx.setTransform(zoom,0,0,zoom,dx,dy);
      const region:any={photos:[{src:'a',width:80,height:80},{src:'b',width:80,height:80}],arrangement:'horizontal',seamless:true,seamlessAmount:100};
      const done=painter.paint(ctx,region,decoded,0,0,w,h,-1,new URLSearchParams(location.search).has('preview'));const pixels=ctx.getImageData(0,0,w,h).data;
      let error=0,holes=0;
      for(let y=2;y<h-2;y+=23)for(let x=2;x<w-2;x+=23){const i=(y*w+x)*4;for(let k=0;k<3;k++)error=Math.max(error,Math.abs(pixels[i+k]-source[k]));if(pixels[i+3]!==255)holes++;}
      check('original colors, continuous zoom and export tile boundaries',done&&error<=2&&holes===0,{color,w,h,zoom,error,holes});
    }
  }
  const source=document.createElement('canvas');source.width=source.height=80;get2dWide(source)!.fillRect(0,0,80,80);
  const image=await new Promise<HTMLImageElement>(resolve=>{const i=new Image();i.onload=()=>resolve(i);i.src=source.toDataURL();});
  const out=document.createElement('canvas');out.width=220;out.height=190;const ctx=get2dWide(out)!;
  ctx.fillStyle='#e534ed';ctx.fillRect(0,0,220,190);ctx.beginPath();ctx.rect(40.4,30.8,140,100);ctx.clip();
  painter.paint(ctx,{photos:[{src:'a',width:80,height:80},{src:'a',width:80,height:80}],arrangement:'horizontal',landscape:true,seamless:true},new Map([['a',image]]),40.4,30.8,140,100);
  check('existing scene clip is retained',ctx.getImageData(10,10,1,1,{colorSpace:'srgb'}).data[0]>200&&ctx.getImageData(100,80,1,1).data[0]===0);
  if(new URLSearchParams(location.search).has('preview')){
    const {photoTemplates}=await import('../utils/creativePhotoLayout');
    const images=await Promise.all(['#ed4255','#2080ee','#34d98c','#ba52e6','#f5b133','#ee7b35','#06b6d4','#ec4899','#888'].map(color=>new Promise<HTMLImageElement>(resolve=>{
      const cv=document.createElement('canvas');cv.width=cv.height=80;const g=get2dWide(cv)!;g.fillStyle=color;g.fillRect(0,0,80,80);const i=new Image();i.onload=()=>resolve(i);i.src=cv.toDataURL();})));
    for(let count=2;count<=9;count++)for(const amount of [0,50,100]){
      const photos=images.slice(0,count).map((_,i)=>({src:String(i),width:80,height:80})),decoded=new Map(images.map((p,i)=>[String(i),p]));
      const region:any={photos,arrangement:'grid',templateIndex:0,landscape:true,seamless:true,seamlessAmount:amount};
      const a=document.createElement('canvas'),b=document.createElement('canvas');a.width=b.width=311;a.height=b.height=233;
      painter.paint(get2dWide(a)!,region,decoded,0,0,311,233,-1,true);painter.paint(get2dWide(b)!,region,decoded,0,0,311,233);
      const pa=get2dWide(a)!.getImageData(0,0,311,233).data,pb=get2dWide(b)!.getImageData(0,0,311,233).data;let max=0,holes=0;
      for(let y=2;y<231;y+=3)for(let x=2;x<309;x+=3){const index=(y*311+x)*4;for(let k=0;k<3;k++)max=Math.max(max,Math.abs(pa[index+k]-pb[index+k]));if(pa[index+3]!==255)holes++;}
      check('interactive feather matches export including T-junctions',max<=3&&holes===0,{count,amount,max,holes,template:photoTemplates(count)[0].name});
    }
  }
  report.pass=report.checks.every((c:any)=>c.pass);
}catch(error){report.pass=false;report.error=String(error);}finally{painter.dispose();}
document.getElementById('result')!.textContent=JSON.stringify(report,null,2);
await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
