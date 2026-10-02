import {shapePathD, shapeMiterLimit, drawCompositeShapeBody} from '../components/GridLayoutTool';

// Pixel regression in the actual browser renderer (also run in iPhone WebKit).
// A very generous reference join limit exposes the missing acute-tip pixels.
const results: any[] = [];
for (const kind of ['triangle', 'diamond', 'star', 'star8', 'pentagon', 'hexagon']) {
  for (const [w, h] of [[160,160], [24,240], [240,24], [40,400], [400,40]]) {
    const paint = (limit: number) => {
      const canvas = document.createElement('canvas');
      canvas.width = w + 400; canvas.height = h + 400;
      const ctx = canvas.getContext('2d')!;
      ctx.translate(200,200); ctx.lineWidth = 6;
      ctx.lineJoin = 'miter'; ctx.miterLimit = limit;
      ctx.stroke(new Path2D(shapePathD(kind,w,h)));
      return ctx.getImageData(0,0,canvas.width,canvas.height).data;
    };
    const reference = paint(10000), current = paint(shapeMiterLimit(w,h)), old = paint(4);
    let mismatch=0, oldMismatch=0;
    for (let i=3;i<reference.length;i+=4) {
      if (reference[i]!==current[i]) mismatch++;
      if (reference[i]!==old[i]) oldMismatch++;
    }
    results.push({kind,w,h,mismatch,oldMismatch});
  }
}
// Thick outside-only ring uses a clip envelope as well as a join limit.
for (const [w,h] of [[24,240],[240,24],[160,160]]) {
  const canvas=document.createElement('canvas');canvas.width=w+400;canvas.height=h+400;
  const ctx=canvas.getContext('2d')!;ctx.translate(200,200);
  drawCompositeShapeBody(ctx,'star-double',w,h,'#fff','#fff',undefined,{outlineWidth:100});
  const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  let borderInk=0;
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++) {
    if((x===0||y===0||x===canvas.width-1||y===canvas.height-1)&&data[(y*canvas.width+x)*4+3])borderInk++;
  }
  results.push({kind:'star-double',w,h,borderInk});
}
const failed=results.filter(r=>r.mismatch>0||r.borderInk>0);
const report={kind:'shape-stretch-pixels',passed:failed.length===0,cases:results.length,
  oldClippedCases:results.filter(r=>r.oldMismatch>0).length,failed,results};
const out=document.createElement('pre');out.id='shape-stretch-report';
out.textContent=JSON.stringify({...report,results:undefined},null,2);
out.style.cssText='position:fixed;top:110px;left:12px;right:12px;z-index:99999;background:#000d;color:#fff;font-size:12px;pointer-events:none';
document.body.append(out);
fetch('http://127.0.0.1:5192/results',{method:'POST',body:JSON.stringify(report)}).catch(()=>{});
