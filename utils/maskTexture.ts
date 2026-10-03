import { patternGlyph } from './pattern';

/** Compress individual glyphs, never their centres or the texture spacing. */
export function maskTextureScale(value = 50) {
  const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 50));
  return { x: v > 50 ? 1 - (v - 50) * .018 : 1,
    y: v < 50 ? .1 + v * .018 : 1 };
}

type Point = [number, number];
const outlines = new Map<string, Point[]>();
function outline(type:string):Point[]{
  const ready=outlines.get(type);if(ready)return ready;
  const p:Point[]=[];
  if(type==='star')for(let k=0;k<10;k++){const r=k%2?1.38*.45:1.38,a=-Math.PI/2+k*Math.PI/5;p.push([Math.cos(a)*r,Math.sin(a)*r]);}
  else if(type==='heart'){
    const s=1.22;
    const bez=(a:Point,b:Point,c:Point,d:Point)=>{for(let i=0;i<48;i++){const t=i/48,u=1-t;p.push([s*(u*u*u*a[0]+3*u*u*t*b[0]+3*u*t*t*c[0]+t*t*t*d[0]),s*(u*u*u*a[1]+3*u*u*t*b[1]+3*u*t*t*c[1]+t*t*t*d[1])]);}};
    bez([0,.85],[-1.5,-.2],[-.55,-1.15],[0,-.4]);
    bez([0,-.4],[.55,-1.15],[1.5,-.2],[0,.85]);
  }else for(let i=0;i<128;i++){const a=i*Math.PI/64;p.push([Math.cos(a),Math.sin(a)]);}
  outlines.set(type,p);return p;
}
const area=(p:Point[])=>Math.abs(p.reduce((s,v,i)=>{const n=p[(i+1)%p.length];return s+v[0]*n[1]-n[0]*v[1];},0))/2;

/** Visible glyph area after the real rectangular mask clip, including squash. */
export function maskTextureVisibility(type:string,px:number,py:number,rx:number,ry:number,width:number,height:number){
  if(px>=rx*2&&px+rx*2<=width&&py>=ry*2&&py+ry*2<=height)return 1;
  const unit=outline(type);
  let poly=unit.map(([x,y])=>[px+x*rx,py+y*ry] as Point);
  if(poly.every(([x,y])=>x>=0&&x<=width&&y>=0&&y<=height))return 1;
  const total=area(unit)*rx*ry;
  for(const [axis,limit,sign] of [[0,0,1],[0,width,-1],[1,0,1],[1,height,-1]] as const){
    const next:Point[]=[];
    for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length];
      const ai=(a[axis]-limit)*sign>=0,bi=(b[axis]-limit)*sign>=0;
      if(ai)next.push(a);
      if(ai!==bi){const t=(limit-a[axis])/(b[axis]-a[axis]);next.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}
    }
    poly=next;if(!poly.length)return 0;
  }
  return Math.max(0,Math.min(1,area(poly)/total));
}
export const maskTextureSizeFromUi=(value:number)=>Math.max(0,Math.min(100,value))*1.3;
export const maskTextureSizeToUi=(value:number)=>Math.max(0,Math.min(100,value/1.3));

/** Keep mostly visible glyphs, hiding half-glyph boundary ties as requested. */
export function paintMaskTexture(ctx: CanvasRenderingContext2D, type: string,
  width: number, height: number, radius: number, gap: number, squash = 50) {
  if (!(width > 0 && height > 0 && radius > 0 && gap > 0)) return;
  const {x, y} = maskTextureScale(squash);
  const dy = gap * Math.sqrt(3) / 2;
  // Stars/hearts extend beyond the nominal circle radius; use a conservative
  // intersection bound so a partially visible tip can never be culled.
  const rx = radius * x * 2, ry = radius * y * 2;
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
  const rows = Math.ceil(height / dy) + 2;
  const cols = Math.ceil(width / gap) + 2;
  for (let j = -rows; j <= rows; j++) {
    const py = height / 2 + j * dy;
    if (py + ry < 0 || py - ry > height) continue;
    const shift = Math.abs(j) % 2 ? gap / 2 : 0;
    for (let i = -cols; i <= cols; i++) {
      const px = width / 2 + i * gap + shift;
      if (px + rx < 0 || px - rx > width) continue;
      if(maskTextureVisibility(type,px,py,radius*x,radius*y,width,height)<=.500001)continue;
      ctx.save(); ctx.translate(px, py); ctx.scale(x, y);
      patternGlyph(ctx, type, 0, 0, radius);
      ctx.restore();
    }
  }
  ctx.restore();
}
