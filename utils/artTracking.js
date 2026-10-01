// ABAI original image-analysis renderer. No third-party code or visual assets.
// Derived from our own effects-lab implementation, with an independent app composition.
import {blurredSource,makeLinks} from './artMaterials.js';
export const trackingDefaults={mode:'mosaic',detection:'combined',threshold:30,count:0,size:100,pixels:16,blur:20,circles:55,minDistance:55,block:16,minRadius:4,maxRadius:24,stroke:1,labelSize:8,opacity:1,imageOpacity:1,links:125,lineWeight:.8,chain:false,chainCount:7,angle:30,baseRadius:170,ratio:.83,intersections:true,markerSize:5,frame:false,frameSize:68,dash:8,frameStroke:1,starSize:40,starPoints:4,textSize:12,topLeft:'ABAI / VISION',topRight:'IMAGE ANALYSIS',bottomLeft:'SIGNAL / 001',bottomRight:'OBSERVATION',labels:false,palette:'#ffffff',background:'#111111',shape:'circle',format:'1200x1600',noise:false,textureOpacity:.5,texture:null,zones:[],zoneStroke:true,seed:42};
let cache=null;
trackingDefaults.linkMode='tree';trackingDefaults.materialStrength=100;trackingDefaults.shapes=['circle'];trackingDefaults.materials=['mosaic'];
Object.assign(trackingDefaults,{nodeSeed:42,variation:80,sizeVariation:0,golden:false,goldenSize:76,thirds:false,thirdsSize:76});
export function invalidateTracking(){cache=null;}
function canvas(w,h=w){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
function random(seed){let s=seed>>>0;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
export function trackingRadius(o,rand,k=1){const variation=Math.max(0,Math.min(1,o.variation/100));return o.maxRadius*(1-variation+variation*rand)*k;}
export function trackingZones(o){
 const rng=random(o.seed),zones=[...(o.zones||[])];
 for(let i=0;i<o.count;i++)zones.push({x:.1+rng()*.8,y:.1+rng()*.8});
 return zones.map(point=>({...point,scale:1-Math.max(0,Math.min(1,o.sizeVariation/100))*rng()*.8}));
}
export function redistributeRegions(o){const seed=o.seed+1,rng=random(seed^0x9e3779b9);return{...o,seed,zones:(o.zones||[]).map(()=>({x:.1+rng()*.8,y:.1+rng()*.8}))};}
function prepare(source){
 if(cache?.source===source)return cache;
 const sample=canvas(Math.max(1,Math.round(source.width/4)),Math.max(1,Math.round(source.height/4))),g=sample.getContext('2d',{willReadFrequently:true});g.drawImage(source,0,0,sample.width,sample.height);const data=g.getImageData(0,0,sample.width,sample.height).data,lum=new Float32Array(sample.width*sample.height);
 for(let i=0;i<lum.length;i++)lum[i]=(data[i*4]*.2126+data[i*4+1]*.7152+data[i*4+2]*.0722)/255;
 return cache={source,lum,sw:sample.width,sh:sample.height,tile:canvas(64),candidateKey:'',candidates:[],nodeKey:'',nodes:[],blur:null,blurRadius:-1,noise:null};
}
function detect(p,o,w,h,k){
 const key=[o.detection,o.threshold,o.circles,o.minDistance,o.block,o.nodeSeed,w,h].join(':');if(p.nodeKey===key)return p.nodes;
 const candidateKey=[o.detection,o.block,o.nodeSeed,w,h].join(':');
 if(p.candidateKey!==candidateKey){const rng=random(o.nodeSeed),points=[],step=Math.max(2,Math.round(o.block*k/4)),ox=o.nodeSeed===42?0:Math.floor(rng()*step),oy=o.nodeSeed===42?0:Math.floor(rng()*step);
 for(let y=step+oy;y<p.sh-step;y+=step)for(let x=step+ox;x<p.sw-step;x+=step){
 const i=y*p.sw+x,l=p.lum[i],contrast=(Math.abs(p.lum[i-step]-p.lum[i+step])+Math.abs(p.lum[i-step*p.sw]-p.lum[i+step*p.sw]))*.5;
 const score=o.detection==='dark'?1-l:o.detection==='bright'?l:o.detection==='contrast'?contrast*3:contrast*2+Math.abs(l-.5)*.5;
 points.push({x:x/p.sw*w,y:y/p.sh*h,score,rank:score+rng()*.08,radiusRand:rng()});
 }
 points.sort((a,b)=>b.rank-a.rank);p.candidates=points;p.candidateKey=candidateKey;}
 const nodes=[],grid=new Map(),distance=Math.max(.01,o.minDistance*k),squared=distance*distance;
 for(const n of p.candidates){if(nodes.length>=o.circles)break;if(n.score*100<o.threshold)continue;const gx=Math.floor(n.x/distance),gy=Math.floor(n.y/distance);let near=false;
  for(let dx=-1;dx<=1&&!near;dx++)for(let dy=-1;dy<=1&&!near;dy++)for(const q of grid.get(`${gx+dx}:${gy+dy}`)||[]){if((q.x-n.x)**2+(q.y-n.y)**2<squared){near=true;break;}}
  if(!near){nodes.push(n);const cell=`${gx}:${gy}`;if(!grid.has(cell))grid.set(cell,[]);grid.get(cell).push(n);}
 }
 p.nodeKey=key;p.nodes=nodes;return nodes;
}
export function circleIntersections(a,b){
 const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);
 if(d<=0||d>a.radius+b.radius||d<Math.abs(a.radius-b.radius))return [];
 const along=(a.radius*a.radius-b.radius*b.radius+d*d)/(2*d),height=Math.sqrt(Math.max(0,a.radius*a.radius-along*along));
 const x=a.x+dx*along/d,y=a.y+dy*along/d;
 return [{x:x-dy*height/d,y:y+dx*height/d},{x:x+dy*height/d,y:y-dx*height/d}];
}
export function renderTracking(c,source,strength=.6,options={}){
 const o={...trackingDefaults,...options},w=source.width,h=source.height,k=Math.min(w,h)/1200,p=prepare(source),nodes=detect(p,o,w,h,k).map(n=>({...n,radius:trackingRadius(o,n.radiusRand,k)})),alpha=Math.min(1,strength/.6)*o.opacity;
 c.save();if(!o.vectorOnly){c.fillStyle=o.background;c.fillRect(0,0,w,h);c.globalAlpha=o.imageOpacity;c.drawImage(source,0,0);}c.globalAlpha=1;
 if(strength<=0){c.drawImage(source,0,0);c.restore();return;}
 const chain=[];
 if(o.chain){let left={x:w/2,y:h/2,radius:o.baseRadius*k},right={...left};chain.push(left);const a=o.angle*Math.PI/180,dx=Math.sin(a),dy=-Math.cos(a);
 for(let i=1;i<=Math.ceil((o.chainCount-1)/2);i++){const r=o.baseRadius*k*Math.pow(o.ratio,i),dist=(left.radius+r)*.68;left={x:left.x-dx*dist,y:left.y-dy*dist,radius:r};right={x:right.x+dx*dist,y:right.y+dy*dist,radius:r};chain.unshift(left);if(chain.length<o.chainCount)chain.push(right);}chain.splice(o.chainCount);}
 const zones=trackingZones(o);
 for(let i=0;i<zones.length;i++){
 const materials=o.materials||[o.mode];if(!materials.length)continue;const mode=materials[i%materials.length];
 const rw=Math.min(w,o.size*k*2*zones[i].scale),rh=Math.min(h,o.size*k*2*zones[i].scale),x=Math.max(0,Math.min(w-rw,zones[i].x*w-rw/2)),y=Math.max(0,Math.min(h-rh,zones[i].y*h-rh/2)),glass=mode==='glass';
 if(!o.vectorOnly){c.save();c.beginPath();c.rect(x,y,rw,rh);c.clip();
 // Filtering is confined to rectangular zones; circle interiors remain photographic.
 for(let j=0;j<nodes.length;j++){if(o.shapes[j%o.shapes.length]!=='circle')continue;const n=nodes[j];c.beginPath();c.rect(0,0,w,h);c.moveTo(n.x+n.radius,n.y);c.arc(n.x,n.y,n.radius,0,Math.PI*2,true);c.clip();}
 const amount=1;
 if(glass){
  if(p.blurRadius!==o.blur){p.blur=blurredSource(source,o.blur*k);p.blurRadius=o.blur;}
  c.globalAlpha=amount;c.drawImage(p.blur,0,0,w,h);c.globalAlpha=1;
  const wash=c.createLinearGradient(x,y,x+rw,y+rh);wash.addColorStop(0,'#ffffff22');wash.addColorStop(.5,'#ffffff00');wash.addColorStop(1,'#ffffff11');c.globalAlpha=amount;c.fillStyle=wash;c.fillRect(x,y,rw,rh);
 }else if(mode==='negative'){c.globalCompositeOperation='difference';c.globalAlpha=amount;c.fillStyle='white';c.fillRect(x,y,rw,rh);}
 else{const tw=Math.max(1,Math.round(rw/(o.pixels*k))),th=Math.max(1,Math.round(rh/(o.pixels*k)));p.tile.width=tw;p.tile.height=th;p.tile.getContext('2d').drawImage(source,x,y,rw,rh,0,0,tw,th);c.globalAlpha=amount;c.imageSmoothingEnabled=false;c.drawImage(p.tile,x,y,rw,rh);}
 c.restore();}if(o.zoneStroke&&!o.rasterOnly){c.strokeStyle=o.palette;c.lineWidth=k;c.globalAlpha=alpha;c.strokeRect(x,y,rw,rh);c.globalAlpha=1;}
 }
 if(o.rasterOnly){c.restore();return;}
 c.strokeStyle=c.fillStyle=o.palette;c.globalAlpha=alpha;c.lineWidth=o.lineWeight*k;
 if(o.linkMode!=='none'){c.beginPath();for(const [a,b] of makeLinks(nodes,o.linkMode,o.links*k)){c.moveTo(a.x,a.y);if(o.linkMode==='circuit'){c.lineTo((a.x+b.x)/2,a.y);c.lineTo((a.x+b.x)/2,b.y);}c.lineTo(b.x,b.y);}c.stroke();}
 c.lineWidth=o.stroke*k;
 for(const n of chain){c.beginPath();c.arc(n.x,n.y,n.radius,0,Math.PI*2);c.stroke();}
 if(o.intersections)for(let i=1;i<chain.length;i++)for(const p of circleIntersections(chain[i-1],chain[i])){c.beginPath();c.arc(p.x,p.y,o.markerSize*k/2,0,Math.PI*2);c.fill();}
 c.font=o.labelSize*k+'px monospace';
 nodes.forEach((n,index)=>{c.beginPath();const r=n.radius,shape=o.shapes[index%o.shapes.length];if(!shape)return;
 if(shape==='square')c.rect(n.x-r,n.y-r,r*2,r*2);
 else if(shape==='spark'||shape==='star'){const tips=shape==='star'?5:4;for(let i=0;i<=tips*2;i++){const a=i*Math.PI/tips-Math.PI/2,d=i%2?r*(shape==='star'?.42:.2):r;const x=n.x+Math.cos(a)*d,y=n.y+Math.sin(a)*d;if(!i)c.moveTo(x,y);else c.lineTo(x,y);}}
 else if(shape==='bracket'){for(const sx of [-1,1])for(const sy of [-1,1]){c.moveTo(n.x+sx*r*.5,n.y+sy*r);c.lineTo(n.x+sx*r,n.y+sy*r);c.lineTo(n.x+sx*r,n.y+sy*r*.5);}}
 else c.arc(n.x,n.y,r,0,Math.PI*2);c.stroke();if(o.labelSize>0){const text=Math.round(n.x)+','+Math.round(n.y),width=c.measureText(text).width;c.fillText(text,Math.min(w-width-4*k,n.x+n.radius+3*k),Math.max(o.labelSize*k,n.y-3*k));}});
 if(o.frame){const size=Math.min(w,h)*o.frameSize/100,x=(w-size)/2,y=(h-size)/2;c.lineWidth=o.frameStroke*k;c.setLineDash([o.dash*k,o.dash*k]);c.strokeRect(x,y,size,size);c.beginPath();c.moveTo(w/2,y);c.lineTo(w/2,y+size);c.moveTo(x,h/2);c.lineTo(x+size,h/2);c.stroke();c.setLineDash([]);c.beginPath();for(let i=0;i<o.starPoints;i++){const a=i*Math.PI/o.starPoints,dx=Math.cos(a)*o.starSize*k/2,dy=Math.sin(a)*o.starSize*k/2;c.moveTo(w/2-dx,h/2-dy);c.lineTo(w/2+dx,h/2+dy);}c.stroke();}
 if(o.thirds){const size=Math.min(w,h)*o.thirdsSize/100,x=(w-size)/2,y=(h-size)/2;c.lineWidth=o.stroke*k;c.strokeRect(x,y,size,size);c.beginPath();for(const f of [1/3,2/3]){c.moveTo(x+size*f,y);c.lineTo(x+size*f,y+size);c.moveTo(x,y+size*f);c.lineTo(x+size,y+size*f);}c.stroke();}
 if(o.golden){
  // Nested golden rectangles with true quarter-circle arcs, expressed as
  // analytic SVG paths in the preview and the same geometry at export.
  const phi=(1+Math.sqrt(5))/2,size=Math.min(w,h)*o.goldenSize/100;
  let rw=size,rh=size/phi,x=(w-rw)/2,y=(h-rh)/2;c.lineWidth=o.stroke*k;c.strokeRect(x,y,rw,rh);
  for(let i=0;i<9;i++){const side=Math.min(rw,rh),dir=i%4;let sx=x,sy=y,cx,cy,a;
   if(dir===0){cx=x+side;cy=y+side;a=Math.PI;}else if(dir===1){sx=x+rw-side;cx=sx;cy=y+side;a=-Math.PI/2;}else if(dir===2){sx=x+rw-side;sy=y+rh-side;cx=sx;cy=sy;a=0;}else{sy=y+rh-side;cx=x+side;cy=sy;a=Math.PI/2;}
   c.strokeRect(sx,sy,side,side);c.beginPath();c.arc(cx,cy,side,a,a+Math.PI/2);c.stroke();
   if(dir===0){x+=side;rw-=side;}else if(dir===1){y+=side;rh-=side;}else if(dir===2)rw-=side;else rh-=side;
  }
 }
 if(o.labels){c.font=o.textSize*k+'px monospace';const pad=24*k;c.textBaseline='top';c.textAlign='left';c.fillText(o.topLeft,pad,pad);c.textAlign='right';c.fillText(o.topRight,w-pad,pad);c.textBaseline='bottom';c.fillText(o.bottomRight,w-pad,h-pad);c.textAlign='left';c.fillText(o.bottomLeft,pad,h-pad);}
 if(o.noise&&!o.texture){if(!p.noise){p.noise=canvas(w,h);const ng=p.noise.getContext('2d'),im=ng.createImageData(w,h),rand=random(917);for(let i=0;i<im.data.length;i+=4){const v=rand()>.88?Math.round(rand()*75):0;im.data[i]=im.data[i+1]=im.data[i+2]=v;im.data[i+3]=255;}ng.putImageData(im,0,0);}c.globalAlpha=o.textureOpacity;c.globalCompositeOperation='screen';c.drawImage(p.noise,0,0);}
 if(o.texture){c.globalAlpha=o.textureOpacity;c.globalCompositeOperation='screen';c.drawImage(o.texture,0,0,w,h);}
 c.restore();
}
