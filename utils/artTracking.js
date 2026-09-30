// ABAI original image-analysis renderer. No third-party code or visual assets.
// Derived from our own effects-lab implementation, with an independent app composition.
export const trackingDefaults={mode:'mosaic',detection:'combined',threshold:30,count:0,size:100,pixels:16,blur:20,circles:55,minDistance:55,block:16,minRadius:4,maxRadius:24,stroke:1,labelSize:8,opacity:1,imageOpacity:1,links:125,lineWeight:.8,chain:false,chainCount:7,angle:30,baseRadius:170,ratio:.83,intersections:true,markerSize:5,frame:false,frameSize:68,dash:8,frameStroke:1,starSize:40,starPoints:4,textSize:12,topLeft:'ABAI / VISION',topRight:'IMAGE ANALYSIS',bottomLeft:'SIGNAL / 001',bottomRight:'OBSERVATION',labels:false,palette:'#ffffff',background:'#111111',shape:'circle',format:'1200x1600',noise:false,textureOpacity:.5,texture:null,zones:[],zoneStroke:true,seed:42};
let cache=null;
export function invalidateTracking(){cache=null;}
function canvas(w,h=w){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
function random(seed){let s=seed>>>0;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
function prepare(source){
 if(cache?.source===source)return cache;
 const sample=canvas(Math.max(1,Math.round(source.width/4)),Math.max(1,Math.round(source.height/4))),g=sample.getContext('2d',{willReadFrequently:true});g.drawImage(source,0,0,sample.width,sample.height);const data=g.getImageData(0,0,sample.width,sample.height).data,lum=new Float32Array(sample.width*sample.height);
 for(let i=0;i<lum.length;i++)lum[i]=(data[i*4]*.2126+data[i*4+1]*.7152+data[i*4+2]*.0722)/255;
 return cache={source,lum,sw:sample.width,sh:sample.height,tile:canvas(64),nodeKey:'',nodes:[],blur:null,blurRadius:-1,noise:null};
}
function detect(p,o,w,h,k){
 const key=[o.detection,o.threshold,o.circles,o.minDistance,o.block,o.minRadius,o.maxRadius,o.seed,w,h].join(':');if(p.nodeKey===key)return p.nodes;
 const rng=random(o.seed),points=[],step=Math.max(2,Math.round(o.block*k/4));
 for(let y=step;y<p.sh-step;y+=step)for(let x=step;x<p.sw-step;x+=step){
 const i=y*p.sw+x,l=p.lum[i],contrast=(Math.abs(p.lum[i-step]-p.lum[i+step])+Math.abs(p.lum[i-step*p.sw]-p.lum[i+step*p.sw]))*.5;
 const score=o.detection==='dark'?1-l:o.detection==='bright'?l:o.detection==='contrast'?contrast*3:contrast*2+Math.abs(l-.5)*.5;
 if(score*100<o.threshold)continue;
 points.push({x:x/p.sw*w,y:y/p.sh*h,score,rank:score+rng()*.08,radius:(o.minRadius+(Math.max(o.minRadius,o.maxRadius)-o.minRadius)*rng())*k});
 }
 points.sort((a,b)=>b.rank-a.rank);const nodes=[];
 for(const n of points){if(nodes.length>=o.circles)break;if(nodes.every(q=>Math.hypot(q.x-n.x,q.y-n.y)>=o.minDistance*k))nodes.push(n);}
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
 const o={...trackingDefaults,...options},w=source.width,h=source.height,k=Math.min(w,h)/1200,p=prepare(source),nodes=detect(p,o,w,h,k),rng=random(o.seed),alpha=Math.min(1,strength/.6)*o.opacity;
 c.save();c.fillStyle=o.background;c.fillRect(0,0,w,h);c.globalAlpha=o.imageOpacity;c.drawImage(source,0,0);c.globalAlpha=1;
 if(strength<=0){c.drawImage(source,0,0);c.restore();return;}
 const chain=[];
 if(o.chain){let left={x:w/2,y:h/2,radius:o.baseRadius*k},right={...left};chain.push(left);const a=o.angle*Math.PI/180,dx=Math.sin(a),dy=-Math.cos(a);
 for(let i=1;i<=Math.ceil((o.chainCount-1)/2);i++){const r=o.baseRadius*k*Math.pow(o.ratio,i),dist=(left.radius+r)*.68;left={x:left.x-dx*dist,y:left.y-dy*dist,radius:r};right={x:right.x+dx*dist,y:right.y+dy*dist,radius:r};chain.unshift(left);if(chain.length<o.chainCount)chain.push(right);}chain.splice(o.chainCount);}
 const zones=[...(o.zones||[])];
 for(let i=0;i<o.count;i++)zones.push({x:.1+rng()*.8,y:.1+rng()*.8});
 for(let i=0;i<zones.length;i++){
 const rw=Math.min(w,o.size*k*2),rh=Math.min(h,o.size*k*2),x=Math.max(0,Math.min(w-rw,zones[i].x*w-rw/2)),y=Math.max(0,Math.min(h-rh,zones[i].y*h-rh/2)),glass=o.mode==='glass'||(o.mode==='mixed'&&i%2===1);
 c.save();c.beginPath();c.rect(x,y,rw,rh);c.clip();
 // Filtering is confined to rectangular zones; circle interiors remain photographic.
 for(const n of nodes){c.beginPath();c.rect(0,0,w,h);c.moveTo(n.x+n.radius,n.y);c.arc(n.x,n.y,n.radius,0,Math.PI*2,true);c.clip();}
 if(glass){if(p.blurRadius!==o.blur){p.blur=canvas(w,h);const g=p.blur.getContext('2d');g.filter='blur('+o.blur*k+'px)';g.drawImage(source,0,0);p.blurRadius=o.blur;}c.drawImage(p.blur,0,0);}
 else{const tw=Math.max(1,Math.round(rw/(o.pixels*k))),th=Math.max(1,Math.round(rh/(o.pixels*k)));p.tile.width=tw;p.tile.height=th;p.tile.getContext('2d').drawImage(source,x,y,rw,rh,0,0,tw,th);c.imageSmoothingEnabled=false;c.drawImage(p.tile,x,y,rw,rh);}
 c.restore();if(o.zoneStroke){c.strokeStyle=o.palette;c.lineWidth=k;c.globalAlpha=alpha;c.strokeRect(x,y,rw,rh);c.globalAlpha=1;}
 }
 c.strokeStyle=c.fillStyle=o.palette;c.globalAlpha=alpha;c.lineWidth=o.lineWeight*k;
 if(o.links>0){c.beginPath();for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j],d=Math.hypot(b.x-a.x,b.y-a.y);if(d<=o.links*k){c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);}}c.stroke();}
 c.lineWidth=o.stroke*k;
 for(const n of chain){c.beginPath();c.arc(n.x,n.y,n.radius,0,Math.PI*2);c.stroke();}
 if(o.intersections)for(let i=1;i<chain.length;i++)for(const p of circleIntersections(chain[i-1],chain[i])){c.beginPath();c.arc(p.x,p.y,o.markerSize*k/2,0,Math.PI*2);c.fill();}
 c.font=o.labelSize*k+'px monospace';
 nodes.forEach(n=>{c.beginPath();if(o.shape==='square')c.rect(n.x-n.radius,n.y-n.radius,n.radius*2,n.radius*2);else c.arc(n.x,n.y,n.radius,0,Math.PI*2);c.stroke();if(o.labelSize>0){const text=Math.round(n.x)+','+Math.round(n.y),width=c.measureText(text).width;c.fillText(text,Math.min(w-width-4*k,n.x+n.radius+3*k),Math.max(o.labelSize*k,n.y-3*k));}});
 if(o.frame){const size=Math.min(w,h)*o.frameSize/100,x=(w-size)/2,y=(h-size)/2;c.lineWidth=o.frameStroke*k;c.setLineDash([o.dash*k,o.dash*k]);c.strokeRect(x,y,size,size);c.beginPath();c.moveTo(w/2,y);c.lineTo(w/2,y+size);c.moveTo(x,h/2);c.lineTo(x+size,h/2);c.stroke();c.setLineDash([]);c.beginPath();for(let i=0;i<o.starPoints;i++){const a=i*Math.PI/o.starPoints,dx=Math.cos(a)*o.starSize*k/2,dy=Math.sin(a)*o.starSize*k/2;c.moveTo(w/2-dx,h/2-dy);c.lineTo(w/2+dx,h/2+dy);}c.stroke();}
 if(o.labels){c.font=o.textSize*k+'px monospace';const pad=24*k;c.textBaseline='top';c.textAlign='left';c.fillText(o.topLeft,pad,pad);c.textAlign='right';c.fillText(o.topRight,w-pad,pad);c.textBaseline='bottom';c.fillText(o.bottomRight,w-pad,h-pad);c.textAlign='left';c.fillText(o.bottomLeft,pad,h-pad);}
 if(o.noise&&!o.texture){if(!p.noise){p.noise=canvas(w,h);const ng=p.noise.getContext('2d'),im=ng.createImageData(w,h),rand=random(917);for(let i=0;i<im.data.length;i+=4){const v=rand()>.88?Math.round(rand()*75):0;im.data[i]=im.data[i+1]=im.data[i+2]=v;im.data[i+3]=255;}ng.putImageData(im,0,0);}c.globalAlpha=o.textureOpacity;c.globalCompositeOperation='screen';c.drawImage(p.noise,0,0);}
 if(o.texture){c.globalAlpha=o.textureOpacity;c.globalCompositeOperation='screen';c.drawImage(o.texture,0,0,w,h);}
 c.restore();
}
