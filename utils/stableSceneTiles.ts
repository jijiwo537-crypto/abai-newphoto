export type SceneWindow={x:number;y:number;w:number;h:number};
/** x/y/w/h: the rendered window. show: the part that is displayed — the
 *  core plus the filtering guard. A tile is rendered `reach` wider than
 *  that on every side because some layers (backdrop masks: mosaic tiles,
 *  glass-brick refraction, frosted blur) sample the scene AROUND each pixel;
 *  without the margin they read a clamped tile edge and differ from the
 *  live render near every seam. */
type Tile=SceneWindow&{canvas:HTMLCanvasElement;show:SceneWindow};
/** Margins above this cost more than drawing the scene live. */
export const SCENE_TILE_MAX_REACH=384;
/** A single immutable raster coordinate system. Tiles include a filter guard;
 * they are storage partitions, never independently transformed scene objects. */
export class StableSceneTiles {
  key='';scale=1;width=0;height=0;status='empty';
  private tiles:Tile[]=[];private generation=0;
  /* Tiles already rendered for a scene whose preparation was interrupted
     (any touch cancels it). The same scene resumes from them instead of
     re-rendering everything, so a scene with slow layers (backdrop masks)
     still becomes ready between gestures. Dropped as soon as the scene,
     size or density changes. */
  private partial:{key:string;width:number;height:number;scale:number;tiles:Map<string,Tile>}|null=null;
  private dropPartial(){if(!this.partial)return;for(const t of this.partial.tiles.values())t.canvas.width=t.canvas.height=1;this.partial=null;}
  dispose(){this.generation++;for(const t of this.tiles)t.canvas.width=t.canvas.height=1;this.tiles=[];this.key='';this.dropPartial();}
  async prepare(key:string,width:number,height:number,scale:number,paint:(c:HTMLCanvasElement,v:SceneWindow)=>void,valid:()=>boolean,reach=0){
    this.generation++;for(const t of this.tiles)t.canvas.width=t.canvas.height=1;this.tiles=[];this.key='';
    const generation=this.generation;this.status='preparing';
    if(this.partial&&(this.partial.key!==key||this.partial.width!==width||this.partial.height!==height||this.partial.scale!==scale))this.dropPartial();
    const extra=Math.ceil(Math.max(0,reach));
    if(!(extra<=SCENE_TILE_MAX_REACH)){this.dropPartial();this.status='sampling reach';return false;}
    // Independent of browser/app memory: refuse an oversized scene instead of
    // lowering its density or allocating an unbounded background cache.
    const budget=256*1024*1024;
    if(!Number.isFinite(width*height)||width<=0||height<=0||width*height*4>budget){this.dropPartial();this.status='size budget';return false;}
    const partial=this.partial??={key,width,height,scale,tiles:new Map()};
    const done=partial.tiles,ordered:Tile[]=[];
    let bytes=0;const guard=16;
    try{
      for(let y=0;y<height;y+=768)for(let x=0;x<width;x+=768){
        const id=x+','+y,existing=done.get(id);
        if(existing){ordered.push(existing);bytes+=existing.w*existing.h*4;continue;}
        await new Promise<void>(r=>requestAnimationFrame(()=>r()));
        // Interrupted: keep finished tiles for the next attempt at this scene.
        if(generation!==this.generation||!valid()){if(generation===this.generation)this.status='cancelled';return false;}
        const sl=x-guard,st=y-guard,sr=Math.min(width,x+768)+guard,sb=Math.min(height,y+768)+guard;
        const left=sl-extra,top=st-extra,right=sr+extra,bottom=sb+extra;
        const tile={x:left,y:top,w:right-left,h:bottom-top,canvas:document.createElement('canvas'),show:{x:sl,y:st,w:sr-sl,h:sb-st}};
        bytes+=tile.w*tile.h*4;if(bytes>budget){tile.canvas.width=tile.canvas.height=1;this.dropPartial();this.status='tile budget';return false;}
        paint(tile.canvas,tile);
        if(tile.canvas.width!==tile.w||tile.canvas.height!==tile.h){tile.canvas.width=tile.canvas.height=1;throw Error('scene tile mapping mismatch');}
        // The page boundary is a crop, not a transparent texture boundary.
        // Extend its last sample into the filtering guard: bilinear/bicubic
        // reduction must not mix the page with transparent pixels outside it.
        const g=tile.canvas.getContext('2d');
        if(g){g.save();g.setTransform(1,0,0,1,0,0);g.globalAlpha=1;g.globalCompositeOperation='source-over';g.imageSmoothingEnabled=false;
          const pl=-left,pt=-top,pr=width-left,pb=height-top;
          if(x===0)g.drawImage(tile.canvas,pl,0,1,tile.h,0,0,pl,tile.h);
          if(y===0)g.drawImage(tile.canvas,0,pt,tile.w,1,0,0,tile.w,pt);
          if(right>width)g.drawImage(tile.canvas,pr-1,0,1,tile.h,pr,0,tile.w-pr,tile.h);
          if(bottom>height)g.drawImage(tile.canvas,0,pb-1,tile.w,1,0,pb,tile.w,tile.h-pb);
          g.restore();
        }
        done.set(id,tile);ordered.push(tile);
      }
      if(generation!==this.generation||!valid()){if(generation===this.generation)this.status='cancelled';return false;}
      this.partial=null;this.tiles=ordered;this.key=key;this.width=width;this.height=height;this.scale=scale;this.status='ready';return true;
    }catch(e){this.dropPartial();this.status=String(e);return false;}
  }
  paint(ctx:CanvasRenderingContext2D,key:string,width:number,height:number){
    if(this.key!==key||!this.tiles.length)return false;
    const kx=width/this.width,ky=height/this.height,m=ctx.getTransform();ctx.save();ctx.scale(kx,ky);
    // All tiles have the same parent matrix and guarded original samples.
    // The scene is opaque inside the page; overlaps therefore do not add alpha.
    const inverse=m.inverse();const a=new DOMPoint(0,0).matrixTransform(inverse),b=new DOMPoint(ctx.canvas.width,ctx.canvas.height).matrixTransform(inverse);
    for(const t of this.tiles){const v=t.show;if(v.x*kx<b.x&&v.y*ky<b.y&&(v.x+v.w)*kx>a.x&&(v.y+v.h)*ky>a.y)ctx.drawImage(t.canvas,v.x-t.x,v.y-t.y,v.w,v.h,v.x,v.y,v.w,v.h);}
    ctx.restore();return true;
  }
}
