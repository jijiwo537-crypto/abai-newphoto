/**
 * 一鍵存全部。
 *
 * iOS 上按系統的分享鍵、選「儲存 N 張圖片」是最順的路 —— 相簿直接收到，
 * 不會像一般網頁下載那樣丟一包檔案給「檔案」App。所以優先走 Web Share，
 * 瀏覽器不支援才退回一張一張下載（一樣不打包成壓縮檔）。
 *
 * 注意：navigator.share 必須在使用者的點擊當下呼叫，中間不能 await ——
 * 一 await 就失去「暫時性啟用」，Safari 會直接丟 NotAllowedError。
 * 所以檔案要先備好（用 prepareFiles），按鈕按下去時只做 share 這一件事。
 *
 * 包成 App（Capacitor）之後改走 nativeShare()，見下面。網頁版一個字都沒動。
 */
import { isNative } from './native';

export type ShareResult = 'shared' | 'downloaded' | 'cancelled' | 'failed';

const extFor = (type: string, url: string): string => {
  if (type.includes('png')) return 'png';
  if (type.includes('webm')) return 'webm';
  if (type.includes('mp4')) return 'mp4';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  if (url.includes('.mp4')) return 'mp4';
  if (url.includes('.webm')) return 'webm';
  return 'png';
};

/** 把畫好的 blob:／data: 網址轉成可以分享的檔案。按鈕出現時就先做好。 */
export async function prepareFiles(urls: string[], baseName = 'abai'): Promise<File[]> {
  const out: File[] = [];
  for (let i = 0; i < urls.length; i++) {
    const blob = await (await fetch(urls[i])).blob();
    const type = blob.type || 'image/png';
    out.push(new File([blob], `${baseName}-${i + 1}.${extFor(type, urls[i])}`, { type }));
  }
  return out;
}

export function canShareFiles(files: File[]): boolean {
  if (!files.length) return false;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  return typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files });
}

/** 一張一張存下來 —— 沒有 Web Share 的瀏覽器才會走到這裡 */
async function downloadEach(files: File[]): Promise<ShareResult> {
  for (const f of files) {
    const url = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 20000);
    // 連續觸發下載時瀏覽器會擋，隔一下再來
    await new Promise(r => window.setTimeout(r, 350));
  }
  return 'downloaded';
}

/* ── 包成 App 之後走的路 ───────────────────────────────────────────
 *
 * WKWebView 裡 `<a download>` 是**完全沒有作用**的 —— 按下去畫面什麼都不會發生，
 * 也不會報錯，使用者只會覺得「存檔壞了」。navigator.share 在原生殼裡也不保證存在。
 * 這兩件事加起來，就是送審一定會被退的那種「主要功能無法使用」。
 *
 * 所以改成：先把檔案寫進 App 自己的暫存區，再把檔案路徑交給系統的分享面板。
 * 使用者看到的畫面跟網頁版一模一樣，一樣是選「儲存 N 張圖片」進相簿。
 *
 * 另外，原生這條路**沒有**「暫時性啟用」的限制（那是瀏覽器的規則），
 * 所以這裡可以放心 await，不必像網頁版那樣把檔案事先備好。
 */

/** 暫存資料夾。放在 Cache 底下，系統空間不夠時會自己回收。 */
const NATIVE_DIR = 'abai-share';

/** 轉成 base64（去掉開頭的 `data:...;base64,`）—— Filesystem.writeFile 只吃這個格式 */
const toBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(',') + 1));
    };
    r.onerror = () => reject(r.error ?? new Error('讀檔失敗'));
    r.readAsDataURL(blob);
  });

async function nativeShare(files: File[]): Promise<ShareResult> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);

  // 上一次存的先清掉，不然暫存區會愈積愈大
  try { await Filesystem.rmdir({ path: NATIVE_DIR, directory: Directory.Cache, recursive: true }); } catch { }
  try { await Filesystem.mkdir({ path: NATIVE_DIR, directory: Directory.Cache, recursive: true }); } catch { }

  const uris: string[] = [];
  for (const f of files) {
    try {
      const { uri } = await Filesystem.writeFile({
        path: `${NATIVE_DIR}/${f.name}`,
        data: await toBase64(f),
        directory: Directory.Cache,
      });
      uris.push(uri);
    } catch {
      /* 單張寫失敗就跳過它，其他的照樣要能存 */
    }
  }
  if (!uris.length) return 'failed';

  try {
    await Share.share({ files: uris });
    return 'shared';
  } catch (e: any) {
    // 使用者自己把面板收掉，不算錯誤
    const msg = String(e?.message ?? e);
    if (e?.name === 'AbortError' || /cancel/i.test(msg)) return 'cancelled';
    return 'failed';
  }
}

/** 直接在點擊事件裡呼叫，files 要事先備好 */
export async function shareFiles(files: File[]): Promise<ShareResult> {
  if (!files.length) return 'failed';
  // 包成 App 時走原生那條。網頁版永遠不會進到這個 if 裡面。
  if (isNative()) return nativeShare(files);
  if (canShareFiles(files)) {
    try {
      await (navigator as Navigator).share({ files });
      return 'shared';
    } catch (e: any) {
      if (e && e.name === 'AbortError') return 'cancelled';
      // NotAllowedError 之類的就往下走，改用下載
    }
  }
  // 圖片加影片混在一起時，有些瀏覽器只肯收其中一種。
  // 那就把收得下的那一批交給分享面板，剩下的用下載補完，不要整批失敗。
  const imgs = files.filter(f => !f.type.startsWith('video'));
  const vids = files.filter(f => f.type.startsWith('video'));
  if (imgs.length && vids.length) {
    for (const part of [imgs, vids]) {
      if (canShareFiles(part)) {
        try {
          await (navigator as Navigator).share({ files: part });
          const rest = part === imgs ? vids : imgs;
          await downloadEach(rest);
          return 'shared';
        } catch (e: any) {
          if (e && e.name === 'AbortError') return 'cancelled';
        }
      }
    }
  }
  return downloadEach(files);
}
