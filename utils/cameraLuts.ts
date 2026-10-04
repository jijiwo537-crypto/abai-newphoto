import {needsLutAtlasRepair,repairedLutCanvas} from './lutAtlasRepair.js';
const decoded = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement>>();

export const readyCameraLut = (url: string) => decoded.get(url);
export function loadCameraLut(url: string): Promise<HTMLImageElement> {
  const ready = decoded.get(url);
  if (ready) return Promise.resolve(ready);
  const existing = pending.get(url);
  if (existing) return existing;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if(needsLutAtlasRepair(url)){
        try{const fixed=new Image();fixed.onload=()=>{decoded.set(url,fixed);pending.delete(url);resolve(fixed);};fixed.onerror=()=>{pending.delete(url);reject(new Error('Cannot decode repaired LUT'));};fixed.src=repairedLutCanvas(image).toDataURL('image/png');}catch(error){pending.delete(url);reject(error);}
      }else{decoded.set(url, image); pending.delete(url); resolve(image);}
    };
    image.onerror = () => { pending.delete(url); reject(new Error(`Cannot load camera LUT: ${url}`)); };
    image.src = url;
  });
  pending.set(url, promise);
  return promise;
}

export async function warmCameraLuts(urls: string[]) {
  const queue = [...new Set(urls.filter(Boolean))];
  await Promise.all(Array.from({length: 3}, async () => {
    while (queue.length) {
      try { await loadCameraLut(queue.shift()!); } catch { /* selected LUT retries */ }
    }
  }));
}
