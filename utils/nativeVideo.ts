/* 原生影片輸出（對應 ios/App/App/VideoWriterPlugin.swift）：硬體 HEVC、切到背景也能編完。
 * 網頁版回 null，呼叫端照舊用 WebCodecs。 */
import { nativePlugin, fileSrc, blobToBase64 } from './nativeBridge';

interface VideoWriterApi {
  begin(o: { width: number; height: number; fps: number; bitrate: number; codec: 'hevc' | 'h264' }): Promise<{ id: number }>;
  append(o: { id: number; data: string; index: number }): Promise<void>;
  finish(o: { id: number }): Promise<{ path: string }>;
  cancel(o: { id: number }): Promise<void>;
}

/** 原生呼叫限時：超過就當失敗，交給網頁的編碼器重做，不會一直卡在同一個百分比 */
const within = <T,>(p: Promise<T>, ms: number, what: string) => new Promise<T>((res, rej) => {
  const t = setTimeout(() => rej(new Error(`${what} 逾時`)), ms);
  p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); });
});

/** 逐格把畫布編成影片。回傳 null＝不是 App 或原生端做不到（呼叫端改走網頁的編碼） */
export async function encodeCanvasFramesNative(o: {
  canvas: HTMLCanvasElement; fps: number; frames: number; bitrate: number;
  draw: (index: number, time: number) => Promise<void> | void;
  onProgress?: (fraction: number) => void;
  aborted?: () => boolean;
}): Promise<Blob | null> {
  const p = await nativePlugin<VideoWriterApi>('VideoWriter');
  if (!p) return null;
  const fps = Math.max(1, Math.min(120, o.fps));
  let id: number;
  try { id = (await within(p.begin({ width: o.canvas.width, height: o.canvas.height, fps, bitrate: Math.max(1_000_000, o.bitrate || 10_000_000), codec: 'hevc' }), 8000, '開始編碼')).id; }
  catch { return null; }
  try {
    for (let i = 0; i < o.frames; i++) {
      if (o.aborted?.()) { await p.cancel({ id }); return null; }
      await o.draw(i, i / fps);
      const blob = await new Promise<Blob | null>(r => o.canvas.toBlob(r, 'image/jpeg', 0.95));
      if (!blob) throw new Error('frame encode failed');
      await within(p.append({ id, data: await blobToBase64(blob), index: i }), 15000, '寫入畫面');
      o.onProgress?.((i + 1) / o.frames);
    }
    const { path } = await within(p.finish({ id }), 120000, '完成影片');
    return await (await fetch(fileSrc(path))).blob().then(b => new Blob([b], { type: 'video/mp4' }));
  } catch (e) {
    p.cancel({ id }).catch(() => {});
    throw e;
  }
}
