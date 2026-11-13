/* 逐格輸出影片（不是即時錄影）。
 *
 * 不用 canvas.captureStream ＋ MediaRecorder「即時」錄：錄影跟著牆上
 * 時鐘走，合成一格只要慢一點（濾鏡、特效、好幾段影片），那一格就直接被丟掉，
 * 錄出來的檔案本身就是一頓一頓的 —— 而且這是烤進檔案裡的，播放器救不回來。
 *
 * 這裡改成每一格都「先把畫面準備好、再交給編碼器」，時間戳是算出來的
 * （第 i 格＝i ÷ fps），跟合成花多久完全無關：不管手機多慢，每一格都在，
 * 播放起來就是順的。編碼用 WebCodecs（H.264），封裝成 MP4。
 * 不支援 WebCodecs 的裝置，呼叫端照舊走 MediaRecorder。
 */
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { isNative } from './native';

export const canEncodeFrames = (): boolean =>
  typeof window !== 'undefined' && typeof (window as any).VideoEncoder === 'function' && typeof (window as any).VideoFrame === 'function';

/** 這台裝置吃得下的編碼設定：H.264（高畫質優先，最後退到 baseline）；
 *  沒有 H.264 編碼器的瀏覽器（例如開源版 Chromium）才用 VP9。 */
async function encoderConfig(width: number, height: number, fps: number, bitrate: number): Promise<{ config: VideoEncoderConfig; muxCodec: 'avc' | 'vp9' } | null> {
  const tries: [string, 'avc' | 'vp9'][] = [
    ['avc1.640033', 'avc'], ['avc1.640028', 'avc'], ['avc1.4d0033', 'avc'], ['avc1.4d0028', 'avc'], ['avc1.42e033', 'avc'], ['avc1.42e028', 'avc'],
    ['vp09.00.41.08', 'vp9'], ['vp09.00.40.08', 'vp9'],
  ];
  for (const [codec, muxCodec] of tries) {
    const config = { codec, width, height, bitrate, framerate: fps, latencyMode: 'quality', ...(muxCodec === 'avc' ? { avc: { format: 'avc' } } : {}) } as VideoEncoderConfig;
    try { if ((await VideoEncoder.isConfigSupported(config)).supported) return { config, muxCodec }; } catch { /* 下一個 */ }
  }
  return null;
}

/**
 * 把一張畫布逐格編成 MP4。draw(i, t) 負責把第 i 格（時間 t 秒）畫好在 canvas 上。
 * 回傳 null＝這台裝置做不到（呼叫端改走即時錄影）；拋錯＝中途失敗。
 */
export async function encodeCanvasFrames(o: {
  canvas: HTMLCanvasElement; fps: number; frames: number; bitrate: number;
  draw: (index: number, time: number) => Promise<void> | void;
  onProgress?: (fraction: number) => void;
  aborted?: () => boolean;
  type?: string;
  /** 只用網頁的編碼器（自動測試用） */
  webOnly?: boolean;
}): Promise<Blob | null> {
  /* 編碼器要求寬高都是偶數（H.264／HEVC 的色度取樣），奇數的話網頁編碼器整個拒絕、原生端也要硬縮。
     畫布是奇數時，每一格先抄進一張偶數大小的畫布（只少最外面一排像素，不縮放）再交出去。 */
  if (o.canvas.width % 2 || o.canvas.height % 2) {
    const src = o.canvas, even = document.createElement('canvas');
    even.width = Math.max(2, src.width & ~1); even.height = Math.max(2, src.height & ~1);
    const g = even.getContext('2d')!;
    const draw = o.draw;
    try {
      return await encodeCanvasFrames({ ...o, canvas: even, draw: async (i, t) => {
        await draw(i, t);
        g.clearRect(0, 0, even.width, even.height); g.drawImage(src, 0, 0, even.width, even.height, 0, 0, even.width, even.height);
      } });
    } finally { even.width = even.height = 1; }
  }
  /* App 裡優先用原生的硬體 HEVC（檔案更小、切到背景也能編完）；做不到再走 WebCodecs。
     原生端「說成功」不代表檔案能播：先實際載入一次確認有畫面，不行就改用 WebCodecs 重編一次，
     絕不把一個播不出來的檔案交出去（成品頁會一片空白、存進相簿的也是壞檔）。 */
  if (isNative() && !o.webOnly) {
    const { encodeCanvasFramesNative } = await import('./nativeVideo');
    const t0 = performance.now();
    const native = await encodeCanvasFramesNative(o).catch(e => { exportDiag(`native failed: ${String(e?.message ?? e)}`); return null; });
    exportDiag(`native ${o.canvas.width}x${o.canvas.height} → ${native ? `${native.type} ${native.size}B` : 'null'} in ${Math.round(performance.now() - t0)}ms`);
    if (native) { const ok = await isPlayableVideo(native); exportDiag(`native playable=${ok}`); if (ok) return native; }
    if (o.aborted?.()) return null;
  }
  if (!canEncodeFrames()) return null;
  const { canvas, frames } = o;
  const fps = Math.max(1, Math.min(120, o.fps));
  const picked = await encoderConfig(canvas.width, canvas.height, fps, Math.max(500_000, o.bitrate || 8_000_000));
  exportDiag(`webcodecs config ${canvas.width}x${canvas.height}: ${picked ? picked.config.codec : 'none'}`);
  if (!picked) return null;
  const { config, muxCodec } = picked;
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: muxCodec, width: canvas.width, height: canvas.height, frameRate: fps }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
  let failure: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => { try { muxer.addVideoChunk(chunk, meta); } catch (e) { failure = e; } },
    error: e => { failure = e; },
  });
  encoder.configure(config);
  const frameUs = 1e6 / fps;
  // 編碼器跟不上時等一下，不要一次塞幾百張畫面進記憶體
  const drain = () => new Promise<void>(resolve => {
    if (encoder.encodeQueueSize <= 3) return resolve();
    const check = () => { if (encoder.encodeQueueSize <= 3 || failure) { encoder.removeEventListener('dequeue', check); resolve(); } };
    encoder.addEventListener('dequeue', check);
    setTimeout(() => { encoder.removeEventListener('dequeue', check); resolve(); }, 1000);
  });
  try {
    for (let i = 0; i < frames; i++) {
      if (o.aborted?.()) { try { encoder.close(); } catch { /* 已關 */ } return null; }
      if (failure) throw failure;
      await o.draw(i, i / fps);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) });
      // 每兩秒一張關鍵格：拖進度條、剪輯都不會卡
      encoder.encode(frame, { keyFrame: i % Math.max(1, Math.round(fps * 2)) === 0 });
      frame.close();
      o.onProgress?.((i + 1) / frames);
      await drain();
    }
    await encoder.flush();
    if (failure) throw failure;
    encoder.close();
    muxer.finalize();
    return new Blob([muxer.target.buffer], { type: o.type || 'video/mp4' });
  } catch (e) {
    try { encoder.close(); } catch { /* 已關 */ }
    throw e;
  }
}

/** 匯出診斷：寫進自動測試紀錄（平常沒有人收，不影響任何東西） */
export const exportDiag = (msg: string) => { try { const w = window as any; (w.__abaiQALog ||= []).push(`export: ${msg}`); console.info('[export]', msg); } catch { /* */ } };

/** 實際載入這段影片，確認瀏覽器播得出來（有長寬、能解出第一格）。最多等 8 秒 */
export function isPlayableVideo(blob: Blob): Promise<boolean> {
  if (!blob || !blob.size) return Promise.resolve(false);
  return new Promise(resolve => {
    const v = document.createElement('video'), url = URL.createObjectURL(blob);
    const t0 = performance.now();
    let done = false;
    const end = (ok: boolean) => { if (done) return; done = true; clearTimeout(t); v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); resolve(ok); };
    const t = setTimeout(() => { exportDiag(`playable check: timeout readyState=${v.readyState} net=${v.networkState}`); end(false); }, 8000);
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.onloadeddata = () => { exportDiag(`playable check: loadeddata ${v.videoWidth}x${v.videoHeight} after ${Math.round(performance.now() - t0)}ms`); end(v.videoWidth > 0 && v.videoHeight > 0); };
    v.onerror = () => { exportDiag(`playable check: error code=${v.error?.code} ${v.error?.message || ''}`); end(false); };
    v.src = url;
  });
}

/** 把每一段影片停在時間 t 的那一格（等畫面真的換好才回來） */
export async function seekVideosTo(videos: HTMLVideoElement[], t: number): Promise<void> {
  await Promise.all(videos.map(v => new Promise<void>(resolve => {
    try { if (!v.paused) v.pause(); } catch { /* 照樣跳 */ }
    const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : Infinity;
    // 影片比這一頁短：循環播放的那一格
    const target = dur === Infinity ? t : (t % dur);
    if (Math.abs(v.currentTime - target) < 1e-4 && v.readyState >= 2) return resolve();
    let settled = false;
    const done = () => {
      if (settled) return; settled = true;
      v.removeEventListener('seeked', onSeeked);
      resolve();
    };
    // seeked 的當下 drawImage 拿到的就是新的那一格（不能等 rVFC：不在畫面上的影片不會回呼）
    const onSeeked = () => done();
    v.addEventListener('seeked', onSeeked);
    setTimeout(done, 2500);
    try { v.currentTime = target; } catch { done(); }
  })));
}
