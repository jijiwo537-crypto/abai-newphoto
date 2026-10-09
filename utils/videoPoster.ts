/* 影片的第一格縮圖（濾鏡／特效卡片牆、拖曳預覽用）。
 *
 * 卡片是把網址塞進 <img> 重畫的，影片網址畫不出東西，所以要先烤一張第一格。
 * 以前是在「影格資料到了」那一刻直接畫：iOS 上那時常常還沒有真的解出畫面，
 * 畫出來是黑的或透明的；有的地方甚至只等到 metadata 就交差，根本沒有縮圖。
 *
 * 這裡固定的做法：另開一個靜音的 <video>，跳到開頭（0.001 秒，強迫解出第一格），
 * 等 seeked 之後再等畫面真的交出來（requestVideoFrameCallback，沒有就等兩幀），
 * 才畫進小畫布存成 blob 網址。同一個網址只做一次，大家共用結果。
 */
const cache = new Map<string, Promise<string | undefined>>();

export function videoPoster(url: string, maxSide = 512): Promise<string | undefined> {
  if (!url) return Promise.resolve(undefined);
  let hit = cache.get(url);
  if (!hit) {
    hit = grab(url, maxSide);
    cache.set(url, hit);
    // 失敗的不要留著，下次還能再試
    hit.then(p => { if (!p) cache.delete(url); });
  }
  return hit;
}

function grab(url: string, maxSide: number): Promise<string | undefined> {
  return new Promise(resolve => {
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; (v as any).playsInline = true;
    v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
    if (!url.startsWith('blob:') && !url.startsWith('data:')) v.crossOrigin = 'anonymous';
    let done = false;
    const finish = (out?: string) => {
      if (done) return; done = true;
      clearTimeout(timer);
      try { v.pause(); v.removeAttribute('src'); v.load(); } catch { /* 收不掉算了 */ }
      resolve(out);
    };
    const timer = setTimeout(() => finish(), 8000);
    const draw = () => {
      try {
        const w = v.videoWidth, h = v.videoHeight;
        if (!w || !h) return finish();
        const k = Math.min(1, maxSide / Math.max(w, h));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
        const g = c.getContext('2d');
        if (!g) return finish();
        g.drawImage(v, 0, 0, c.width, c.height);
        c.toBlob(b => { c.width = c.height = 0; finish(b ? URL.createObjectURL(b) : undefined); }, 'image/jpeg', 0.85);
      } catch { finish(); }
    };
    const whenPainted = () => {
      const rvfc = (v as any).requestVideoFrameCallback;
      if (typeof rvfc === 'function') {
        rvfc.call(v, () => draw());
        // 有些瀏覽器暫停中的影片不會回呼：給它一點時間，不來就直接畫
        setTimeout(() => { if (!done) draw(); }, 300);
      } else requestAnimationFrame(() => requestAnimationFrame(draw));
    };
    v.addEventListener('seeked', whenPainted, { once: true });
    v.addEventListener('loadedmetadata', () => {
      try { v.currentTime = Math.min(0.001, (v.duration || 1) / 2); } catch { whenPainted(); }
    }, { once: true });
    v.addEventListener('error', () => finish(), { once: true });
    v.src = url;
    try { v.load(); } catch { /* 有 src 就會自己載 */ }
  });
}
