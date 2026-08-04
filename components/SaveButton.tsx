import React, { useEffect, useState } from 'react';
import { prepareFiles, shareFiles } from '../utils/shareAll';

/**
 * 存檔按鈕。
 *
 * iOS 上按下去會叫出系統的分享面板，選「儲存 N 張圖片」相簿就直接收到；
 * 沒有 Web Share 的瀏覽器則退回一張一張下載（不打包成資料夾）。
 *
 * 檔案是在按鈕出現時就先備好的 —— navigator.share 中間不能 await，
 * 一 await 就失去「暫時性啟用」，Safari 會直接把它擋掉。
 */
export const SaveButton: React.FC<{
  urls: string[];
  className?: string;
  /** 自己指定字樣，不給就依張數與類型自動決定 */
  label?: string;
}> = ({ urls, className, label }) => {
  const [files, setFiles] = useState<File[]>([]);
  const key = urls.join('|');

  useEffect(() => {
    if (!urls.length) { setFiles([]); return; }
    let alive = true;
    setFiles([]);
    prepareFiles(urls, 'abai').then(fs => { if (alive) setFiles(fs); }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const ready = files.length > 0;
  const videos = files.filter(f => f.type.startsWith('video')).length;
  const text = label ?? (
    files.length > 1
      ? (videos ? `儲存全部 ${files.length} 個` : `儲存全部 ${files.length} 張`)
      : (videos ? '儲存影片' : '儲存圖片')
  );

  return (
    <button
      onClick={(e) => { e.stopPropagation(); if (ready) shareFiles(files); }}
      disabled={!ready}
      className={className ?? `h-12 rounded-full bg-white text-black font-black tracking-widest uppercase text-sm shadow-lg shadow-white/10 transition-all ${ready ? 'active:scale-95' : 'opacity-40'}`}
    >
      {ready ? text : '準備中…'}
    </button>
  );
};
