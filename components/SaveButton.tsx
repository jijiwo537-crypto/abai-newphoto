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
function coverLayer(fading = false) {
  const last = (window as any).__abaiBusyLabel as { text: string; cls: string; at: number } | undefined;
  const label = last && Date.now() - last.at < 15000 ? last : null;
  return (
    /* 全黑、不透明：存相簿的這幾秒，後面已經做好的成品頁不能透出來（轉圈還在轉、成品頁卻先看得到）。
       存好時用 0.2 秒淡出，轉圈剛好接到成品頁。 */
    /* 跟各工具「匯出中」那一層是同一個元件、同一個位置（見 BusyLayer），換層時轉圈不會跳 */
    <BusyLayer data-abai-save-cover="" className="z-[10000] bg-black flex items-center justify-center" aria-label="儲存中"
      style={{ opacity: fading ? 0 : 1, transition: 'opacity 200ms ease-out', pointerEvents: fading ? 'none' : undefined }}>
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
  /** 存好了、蓋板正在淡出的那 0.2 秒 */
  const [fading, setFading] = useState(false);
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
      setFading(true);
      setTimeout(() => { autoDone.add(key); setFading(false); setTick(t => t + 1); }, 200);
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

  /* App：成品頁先被一層跟匯出時一樣的黑色轉圈蓋住，存進相簿完成的那一刻才掀開 ——
     「看到成品頁」和「照片真的存好＋震動」是同一個瞬間 */
  const covering = isNative() && !autoDone.has(key) && urls.length > 0;
  const btnRef = useRef<HTMLButtonElement>(null);
  return (
    <>
    {covering && coverLayer(fading)}
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
