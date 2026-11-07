/* 原生影片輸出（對應 ios/App/App/VideoWriterPlugin.swift）：硬體 HEVC、切到背景也能編完。
 * 網頁版回 null，呼叫端照舊用 WebCodecs。 */
import { nativePlugin, fileSrc, blobToBase64 } from './nativeBridge';

interface VideoWriterApi {
  begin(o: { width: number; height: number; fps: number; bitrate: number; codec: 'hevc' | 'h264' }): Promise<{ id: number }>;
  append(o: { id: number; data: string; index: number }): Promise<void>;
  finish(o: { id: number }): Promise<{ path: string }>;
  cancel(o: { id: number }): Promise<void>;
}

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
  try { id = (await p.begin({ width: o.canvas.width, height: o.canvas.height, fps, bitrate: Math.max(1_000_000, o.bitrate || 10_000_000), codec: 'hevc' })).id; }
  catch { return null; }
  try {
    for (let i = 0; i < o.frames; i++) {
      if (o.aborted?.()) { await p.cancel({ id }); return null; }
      await o.draw(i, i / fps);
      const blob = await new Promise<Blob | null>(r => o.canvas.toBlob(r, 'image/jpeg', 0.95));
      if (!blob) throw new Error('frame encode failed');
      await p.append({ id, data: await blobToBase64(blob), index: i });
      o.onProgress?.((i + 1) / o.frames);
    }
    const { path } = await p.finish({ id });
    return await (await fetch(fileSrc(path))).blob().then(b => new Blob([b], { type: 'video/mp4' }));
  } catch (e) {
    p.cancel({ id }).catch(() => {});
    throw e;
  }
}
