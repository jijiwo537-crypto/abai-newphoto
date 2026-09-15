/**
 * 動態成品的最低幀率是 50fps。若素材影片本身高於 60fps，則盡量保留
 * 素材的原生幀率（上限 120fps，避免錯誤 metadata 讓編碼器失控）。
 * captureStream 的 track settings 是目前瀏覽器唯一不必先播放／跳格取樣、
 * 也不會擾動影片 currentTime 的標準化讀法；讀不到時安全回到 50fps。
 */
export const preferredVideoFrameRate = (videos: HTMLVideoElement[] = []): number => {
  let target = 50;
  for (const video of videos) {
    let probe: MediaStream | null = null;
    try {
      const capture = (video as any).captureStream || (video as any).mozCaptureStream;
      if (typeof capture !== 'function') continue;
      probe = capture.call(video) as MediaStream;
      const fps = Number(probe.getVideoTracks?.()[0]?.getSettings?.().frameRate || 0);
      if (Number.isFinite(fps) && fps > 60) target = Math.max(target, Math.min(120, fps));
    } catch {
      // Safari 可能不公開來源幀率；此時仍保證使用 50fps。
    } finally {
      probe?.getTracks?.().forEach(track => track.stop());
    }
  }
  return Math.round(target * 100) / 100;
};
