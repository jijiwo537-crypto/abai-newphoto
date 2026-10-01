import {makeGlyphAtlases,paintColorGlyphs} from '../utils/artGlyphGpu.js';
void(async()=>{
 await document.fonts.ready;
 const symbols=['·','•','。','o','⭒','✧','✦','⭑','✶','中','あ','한'];
 const root=document.createElement('section');Object.assign(root.style,{position:'fixed',inset:'0',zIndex:'99999',background:'#080808',overflow:'auto',color:'white',padding:'16px'});
 root.innerHTML='<h1 style="font:14px sans-serif;margin-bottom:12px">特殊字符｜上排無發光／下排發光</h1>';
 const results:any[]=[];
 for(let i=0;i<symbols.length;i+=4){
  const chars=symbols.slice(i,i+4),width=Math.min(360,innerWidth-32),height=100;
  const layout={w:width,h:height,cw:width/4,ch:height,cols:4,chars,cellFit:true,lines:[{cells:chars}],data:new Uint8Array(16).fill(255)};
  for(const glow of [0,50]){
   const c=document.createElement('canvas');c.style.width=width+'px';c.style.height=height+'px';root.append(c);
   const gpu=paintColorGlyphs(c,layout,{glow,color:false},{left:0,top:0,width,height},{left:0,top:0,width,height},devicePixelRatio);
   const g=c.getContext('webgl'),pixels=new Uint8Array(c.width*c.height*4);g?.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,pixels);
   let nonzero=0,soft=0,core=0,sum=0;for(let j=3;j<pixels.length;j+=4){const a=pixels[j];sum+=a;if(a)nonzero++;if(a>0&&a<180)soft++;if(a>240)core++;}
   results.push({chars:chars.join(''),glow,gpu,nonzero,soft,core,sum});
  }
 }
 const a=makeGlyphAtlases(symbols,52,1,40,67,true),g=a.ink.getContext('2d')!,p=g.getImageData(0,0,a.ink.width,a.ink.height).data;
 let boundaryMax=0;for(let y=0;y<a.ink.height;y++)for(let x=0;x<a.ink.width;x++)if(x%a.cellW===0||x%a.cellW===a.cellW-1||y%a.cellH===0||y%a.cellH===a.cellH-1)boundaryMax=Math.max(boundaryMax,p[(y*a.ink.width+x)*4+3]);
 const passed=results.every((r,i)=>r.gpu&&r.nonzero>0&&(i%2===0||r.soft>results[i-1].soft&&r.sum>results[i-1].sum))&&boundaryMax===0;
 const out=document.createElement('pre');out.style.fontSize='11px';out.textContent=JSON.stringify({passed,boundaryMax,renderer:'isolated-glyph-gpu-gaussian',results},null,2);root.append(out);document.body.append(root);
 await fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify({kind:'ascii-glyph-glow',passed,boundaryMax,results,userAgent:navigator.userAgent})}).catch(()=>{});
})();
