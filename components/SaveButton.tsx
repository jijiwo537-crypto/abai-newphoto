import React, { useEffect, useRef, useState } from 'react';
import { BusyLayer } from './BusyLayer';
import { prepareFiles, shareFiles } from '../utils/shareAll';
import { isNative } from '../utils/native';
import { saveToPhotos } from '../utils/nativePhotos';

/**
 * 存檔按鈕（成品頁）。
 *
 * ‧ 網頁版：按下去叫出系統的分享面板，選「儲存 N 張圖片」相簿就直接收到；
 *   沒有 Web Share 的瀏覽器則退回一張一張下載。檔案在按鈕出現時就先備好 ——
 *   navigator.share 中間不能 await，一 await 就失去「暫時性啟用」，Safari 會擋掉。
 * ‧ App：成品一做好就自動存進相簿（按「儲存」就是存檔，不用再按一次），
 *   按鈕顯示「已存到相簿」；想再存一份可以再按。
 */
/** 已經自動存過的成品（同一份不重複存，例如成品頁重新顯示時） */
const autoSaved = new Set<string>();
/** 存相簿時蓋在成品頁上的那一層：剛剛匯出畫面（幾秒內）原樣接上；沒有就用標準的黑底轉圈 */
function coverLayer() {
  const last = (window as any).__abaiBusyLabel as { text: string; cls: string; at: number } | undefined;
  const label = last && Date.now() - last.at < 15000 ? last : null;
  return (
    /* 全黑、不透明：後面的成品頁不能透出來（轉圈還在轉、成品頁卻先看得到）。
       掀開時不淡出：淡出那 0.2 秒等於轉圈和成品頁疊在一起。成品頁準備好的那一格直接換過去。 */
    /* 跟各工具「匯出中」那一層是同一個元件、同一個位置（見 BusyLayer），換層時轉圈不會跳 */
    <BusyLayer data-abai-save-cover="" className="z-[10000] bg-black flex items-center justify-center" aria-label="儲存中"
      >
      <div className="w-12 h-12 border-4 border-white/10 border-t-white rounded-full animate-spin" />
      {label && <span className={label.cls} style={{ position: 'absolute', left: 0, right: 0, top: label.cls.includes('text-lg') ? 'calc(50% + 44px)' : 'calc(50% + 40px)', textAlign: 'center' }}>{label.text}</span>}
    </BusyLayer>
  );
}
/** 自動存檔已經結束（成功或失敗）的成品：成品頁不再蓋著 */
const autoDone = new Set<string>();
export const SaveButton: React.FC<{
  urls: string[];
  className?: string;
  /** 自己指定字樣，不給就依張數與類型自動決定 */
  label?: string;
}> = ({ urls, className, label }) => {
  const [files, setFiles] = useState<File[]>([]);
  /* App 裡直接存進相簿：按下去顯示「儲存中…」，存好變成「已存到相簿」，失敗就說原因 */
  const [phase, setPhase] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [, setTick] = useState(0);
  /** 成品頁上的圖片／影片都已經解好、畫得出來了（之前一直蓋著轉圈，不露出空的黑畫面） */
  const [mediaReady, setMediaReady] = useState(false);
  const key = urls.join('|');
  useEffect(() => { setPhase('idle'); }, [key]);
  const save = async () => {
    if (!isNative()) { void shareFiles(files); return; }
    if (phase === 'saving') return;
    setPhase('saving');
    const r = await saveToPhotos(files);
    if (!r) { setPhase('idle'); void shareFiles(files); return; }
    if (r.status === 'saved') { setPhase('saved'); return; }
    setPhase('idle');
    alert(/denied|權限|authoriz/i.test(r.error || '')
      ? '沒有存到相簿的權限。請到「設定 → ABAI → 照片」打開「僅限加入照片」後再試一次。'
      : `存檔失敗：${r.error || '請再試一次'}`);
  };

  useEffect(() => {
    if (!urls.length) { setFiles([]); return; }
    let alive = true;
    setFiles([]);
    prepareFiles(urls, 'abai').then(fs => { if (alive) setFiles(fs); }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  /* App：檔案備好就自動存進相簿 */
  useEffect(() => {
    if (!isNative() || !files.length || autoSaved.has(key)) return;
    autoSaved.add(key);
    let done = false;
    const uncover = () => {
      if (done) return; done = true;
      autoDone.add(key); setTick(t => t + 1);
    };
    /* 保險：存檔 30 秒都沒回來就先掀開，不讓畫面一直蓋著 */
    const t = setTimeout(uncover, 30000);
    void save().finally(() => { clearTimeout(t); uncover(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, key]);

  const ready = files.length > 0;
  const videos = files.filter(f => f.type.startsWith('video')).length;
  const text = label ?? (
    files.length > 1
      ? (videos ? `儲存全部 ${files.length} 個` : `儲存全部 ${files.length} 張`)
      : (videos ? '儲存影片' : '儲存圖片')
  );

  const btnRef = useRef<HTMLButtonElement>(null);
  /* 成品頁一出現就先被一層跟匯出時一模一樣的轉圈蓋住（同一個 BusyLayer、同一個位置），
     等到成品頁上的圖片／影片都真的解好、畫出來了才掀開 —— 不然匯出的轉圈一收，
     看到的會是「圖還沒出來的全黑成品頁」（大圖、影片解得慢時特別明顯）。
     App 另外還要等存進相簿完成：「看到成品頁」和「照片真的存好＋震動」是同一個瞬間。 */
  useEffect(() => {
    setMediaReady(false);
    if (!urls.length) return;
    let alive = true;
    const root = btnRef.current?.closest('[data-export-screen]') as HTMLElement | null;
    const media = root ? Array.from(root.querySelectorAll<HTMLImageElement | HTMLVideoElement>('img, video')) : [];
    const ready = (el: HTMLImageElement | HTMLVideoElement) => new Promise<void>(res => {
      if (el instanceof HTMLVideoElement) {
        if (el.readyState >= 2 || el.error) return res();
        el.addEventListener('loadeddata', () => res(), { once: true });
        el.addEventListener('error', () => res(), { once: true });
        return;
      }
      if (el.complete && el.naturalWidth) { el.decode().then(() => res(), () => res()); return; }
      if (el.complete) return res();   // 壞圖：不卡住
      el.addEventListener('load', () => { el.decode().then(() => res(), () => res()); }, { once: true });
      el.addEventListener('error', () => res(), { once: true });
    });
    /* 保險：最多等 8 秒，不讓畫面一直蓋著 */
    const all = Promise.race([Promise.all(media.map(ready)), new Promise<void>(r => setTimeout(r, 8000))]);
    /* 解好之後再等兩格，確定成品頁那一格已經畫到螢幕上才掀開 */
    all.then(() => requestAnimationFrame(() => requestAnimationFrame(() => { if (alive) setMediaReady(true); })));
    return () => { alive = false; };
  }, [key]);
  const covering = urls.length > 0 && (!mediaReady || (isNative() && !autoDone.has(key)));
  return (
    <>
    {covering && coverLayer()}
    <button
      ref={btnRef}
      onClick={(e) => { e.stopPropagation(); if (ready) void save(); }}
      disabled={!ready || phase === 'saving'}
      className={className ?? `h-12 rounded-full bg-white text-black font-black tracking-widest uppercase text-sm shadow-lg shadow-white/10 transition-all ${ready ? 'active:scale-95' : 'opacity-40'}`}
    >
      {!ready ? (isNative() ? '儲存中…' : '準備中…') : phase === 'saving' ? '儲存中…' : phase === 'saved' ? '已存到相簿' : text}
    </button>
    </>
  );
};
