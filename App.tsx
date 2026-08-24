
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { CameraInterface } from './components/CameraInterface';
import { HomePage } from './components/HomePage';
import { ImageEditor } from './components/ImageEditor';
import { CollageTool } from './components/CollageTool';
import { GridLayoutTool } from './components/GridLayoutTool';
import { BeautyStudio } from './components/BeautyStudio';
import { ColorMatchStudio } from './components/ColorMatchStudio';

type AppView = 'home' | 'camera' | 'editor' | 'collage' | 'layout' | 'beauty' | 'match';

const LUT_LIST = [
  { id: 'none', name: '原始', url: '' },
  { id: 'f1', name: 'F1', url: './luts/f1.webp' },
  { id: 'f2', name: 'F2', url: './luts/f2.webp' },
  { id: 'f3', name: 'F3', url: './luts/f3.webp' },
  { id: 'f4', name: 'F4', url: './luts/f4.webp' },
  { id: 'f5', name: 'F5', url: './luts/f5.webp' },
  { id: 'f6', name: 'F6', url: './luts/f6.webp' },
  { id: 'f7', name: 'F7', url: './luts/f7.webp' },
  { id: 'f8', name: 'F8', url: './luts/f8.webp' },
  { id: 'f9', name: 'F9', url: './luts/f9.webp' },
  { id: 'f10', name: 'F10', url: './luts/f10.webp' },
  { id: 'f11', name: 'F11', url: './luts/f11.webp' },
  { id: 'f12', name: 'F12', url: './luts/f12.webp' },
  { id: 'f13', name: 'F13', url: './luts/f13.webp' },
  { id: 'f14', name: 'F14', url: './luts/f14.webp' },
  { id: 'f15', name: 'F15', url: './luts/f15.webp' },
  { id: 'f16', name: 'F16', url: './luts/f16.webp' },
  { id: 'f17', name: 'F17', url: './luts/f17.webp' },
  { id: 'f18', name: 'F18', url: './luts/f18.webp' },
  { id: 'f19', name: 'F19', url: './luts/f19.webp' },
  { id: 'f20', name: 'F20', url: './luts/f20.webp' },
  { id: 'f21', name: 'F21', url: './luts/f21.webp' },
  { id: 'f22', name: 'F22', url: './luts/f22.webp' },
  { id: 'f23', name: 'F23', url: './luts/f23.webp' },
];

// Expanded support for RAW and HEIC formats, and fallback for all other types to be caught by ImageMagick
/* 收哪些檔案統一由 utils/fileTypes 決定（以前這串複製在三個檔案裡，內容還不一樣）*/
const RAW_ACCEPT = SHARED_RAW_ACCEPT;

import { processImageFile, normalizeImageFiles } from './utils/imageLoader';
import { RAW_ACCEPT as SHARED_RAW_ACCEPT, MEDIA_ACCEPT, isVideoFileName } from './utils/fileTypes';
import {
  draftTime as collageDraftTime,
  clearDraft as clearCollageDraft,
} from './utils/collageDraft';
import {
  draftTime as toolDraftTime,
  draftTool,
  loadDraft as loadToolDraft,
  clearDraft as clearToolDraft,
  type ToolKind,
} from './utils/toolDraft';
import { listExports, loadExport, subscribeExports, type ExportMeta } from './utils/exportHistory';

const TOOL_NAMES: Record<ToolKind | 'layout', string> = {
  layout: '經典拼圖',
  editor: '編輯',
  beauty: '美顏',
  collage: '創意拼圖',
};

const App: React.FC = () => {
  // 上次沒做完的東西一律先問過再接回去，不要一開 App 就直接跳進去。
  // 兩份草稿（經典拼圖／其他工具）取比較新的那一份。
  /* 首頁的「接續上次」卡要顯示時間，所以順便把草稿的時間戳一起記著 */
  const [resume, setResume] = useState<{ kind: ToolKind | 'layout'; at: number } | null>(() => {
    const c = collageDraftTime();
    const t = toolDraftTime();
    if (!c && !t) return null;
    if (c >= t) return { kind: 'layout', at: c };
    const tool = draftTool();
    return tool ? { kind: tool, at: t } : null;
  });
  const [resuming, setResuming] = useState(false);

  /* 首頁的「最近輸出」。每次回到首頁重讀一次，剛導出的那張才會馬上出現 */
  const [recentExports, setRecentExports] = useState<ExportMeta[]>([]);
  const [toolDraftState, setToolDraftState] = useState<any>(null);
  const [currentView, setCurrentView] = useState<AppView>('home');
  const [editorImage, setEditorImage] = useState<string | null>(null);
  /** 批量編輯：這次匯入的所有照片（只有一張時就跟以前一樣） */
  const [editorImages, setEditorImages] = useState<string[]>([]);
  const [collageInitialFile, setCollageInitialFile] = useState<File | null>(null);
  /** 創意拼圖入口一次選了好幾個時，第一個之後的那些 */
  const [collageExtras, setCollageExtras] = useState<File[]>([]);
  const [layoutInitialFiles, setLayoutInitialFiles] = useState<File[]>([]);
  const [editorKey, setEditorKey] = useState(0);
  const [collageKey, setCollageKey] = useState(0);
  const [layoutKey, setLayoutKey] = useState(0);
  const [beautyImage, setBeautyImage] = useState<string | null>(null);
  const [matchImage, setMatchImage] = useState<string | null>(null);
  const [matchRef, setMatchRef] = useState<string | null>(null);
  const [beautyKey, setBeautyKey] = useState(0);
  /* 從歷史紀錄點開來的那一筆是誰。工具再存一次的時候要沿用同一個 key，
     這樣才會「蓋掉同一筆」而不是又多一筆一模一樣的。開新的照片就清掉。 */
  const [histKey, setHistKey] = useState<string | null>(null);

  /** 創意拼圖：第一個當底，其餘的自動變成物件（相簿多選） */
  /* 拼圖的入口以前是把 File 原封不動丟給工具，工具再自己 createObjectURL ——
     所以 RAW／HEIC 這種瀏覽器讀不懂的檔案到那裡就是一張載不出來的 <img>，
     畫面空白。這裡先解碼成一般 JPEG 再交出去，工具那邊一行都不用改。
     一般的 JPEG/PNG 會原樣放行，不會多轉一次、也不會掉畫質。 */
  const handleImportToCollage = async (files: File | File[]) => {
    const list = Array.isArray(files) ? files : [files];
    if (!list.length) return;
    setIsImporting(true);
    setImportPreviewUrl(null);
    let ready = list;
    try {
      ready = await normalizeImageFiles(list, (u) => setImportPreviewUrl(u));
    } catch (err) {
      console.error('Failed to process image:', err);
    } finally {
      setIsImporting(false);
      setImportPreviewUrl(null);
    }
    setToolDraftState(null);
    setHistKey(null);
    setCollageInitialFile(ready[0]);
    setCollageExtras(ready.slice(1));
    setCollageKey(prev => prev + 1);
    setCurrentView('collage');
  };

  const handleImportToLayout = async (files: File[]) => {
    if (!files.length) return;
    setIsImporting(true);
    setImportPreviewUrl(null);
    let ready = files;
    try {
      ready = await normalizeImageFiles(files, (u) => setImportPreviewUrl(u));
    } catch (err) {
      console.error('Failed to process image:', err);
    } finally {
      setIsImporting(false);
      setImportPreviewUrl(null);
    }
    setHistKey(null);
    setLayoutInitialFiles(ready);
    setLayoutKey(prev => prev + 1);
    setCurrentView('layout');
  };
  const [editorFile, setEditorFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importPreviewUrl, setImportPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleGlobalImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  /** 批量編輯裡的「新增」：把選到的照片接在現有清單後面，不重開編輯器 */
  const addPhotosInputRef = useRef<HTMLInputElement>(null);
  const handleAddPhotosClick = useCallback(() => {
    addPhotosInputRef.current?.click();
  }, []);
  const handleAddPhotosChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length) {
      setIsImporting(true);
      try {
        const urls: string[] = [];
        for (const f of files) urls.push(await processImageFile(f, (u) => setImportPreviewUrl(u)));
        setEditorImages(prev => [...prev, ...urls]);
      } catch (err) {
        console.error('Failed to process image:', err);
        alert('無法處理此圖片格式');
      } finally {
        setIsImporting(false);
        setImportPreviewUrl(null);
      }
    }
    if (addPhotosInputRef.current) addPhotosInputRef.current.value = '';
  };

  const collageFileInputRef = useRef<HTMLInputElement>(null);
  const layoutFileInputRef = useRef<HTMLInputElement>(null);
  const beautyFileInputRef = useRef<HTMLInputElement>(null);
  const matchFileInputRef = useRef<HTMLInputElement>(null);
  const matchRefInputRef = useRef<HTMLInputElement>(null);
  const handleCollageImportClick = () => {
    collageFileInputRef.current?.click();
  };
  const handleBeautyImportClick = () => {
    beautyFileInputRef.current?.click();
  };

  // 美顏入口與編輯器共用同一套 RAW / HEIC 解碼流程
  const handleBeautyFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsImporting(true);
      setImportPreviewUrl(null);
      try {
        const objectUrl = await processImageFile(file, (previewUrl) => {
          setImportPreviewUrl(previewUrl);
        });
        setToolDraftState(null);
        setBeautyImage(objectUrl);
        setBeautyKey(prev => prev + 1);
        setCurrentView('beauty');
      } catch (err) {
        console.error("Failed to process image:", err);
        alert("無法處理此圖片格式");
      } finally {
        setIsImporting(false);
        setImportPreviewUrl(null);
      }
    }
    if (beautyFileInputRef.current) {
      beautyFileInputRef.current.value = '';
    }
  };

  // ---- 仿色 ----
  const handleMatchImportClick = () => { matchFileInputRef.current?.click(); };
  const handleMatchRefClick = () => { matchRefInputRef.current?.click(); };
  const handleMatchFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsImporting(true);
      setImportPreviewUrl(null);
      try {
        const objectUrl = await processImageFile(file, (u) => setImportPreviewUrl(u));
        setMatchImage(objectUrl);
        setMatchRef(null);
        setCurrentView('match');
      } catch (err) {
        console.error('Failed to process image:', err);
        alert('無法處理此圖片格式');
      } finally { setIsImporting(false); setImportPreviewUrl(null); }
    }
    if (matchFileInputRef.current) matchFileInputRef.current.value = '';
  };
  const handleMatchRefChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsImporting(true);
      try {
        setMatchRef(await processImageFile(file));
      } catch (err) {
        console.error('Failed to process reference:', err);
        alert('無法處理此圖片格式');
      } finally { setIsImporting(false); setImportPreviewUrl(null); }
    }
    if (matchRefInputRef.current) matchRefInputRef.current.value = '';
  };

  // 美顏修完可直接接到現有編輯器套 LUT 濾鏡
  const handleBeautyToEditor = (dataUrl: string) => {
    setToolDraftState(null);
    setEditorImage(dataUrl);
    setEditorImages([dataUrl]);
    setEditorFile(null);
    setEditorKey(prev => prev + 1);
    setBeautyImage(null);
    setCurrentView('editor');
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length) {
      setIsImporting(true);
      setImportPreviewUrl(null);
      setEditorFile(files[0]);
      try {
        // 一次選多張就全部解碼進來，編輯器裡再切換要看哪一張
        const urls: string[] = [];
        for (const f of files) {
          urls.push(await processImageFile(f, (previewUrl) => {
            setImportPreviewUrl(previewUrl);
          }));
        }
        setToolDraftState(null);
        setEditorImages(urls);
        setEditorImage(urls[0]);
        setEditorKey(prev => prev + 1);
        setCurrentView('editor');
      } catch (err) {
        console.error("Failed to process image:", err);
        alert("無法處理此圖片格式");
      } finally {
        setIsImporting(false);
        setImportPreviewUrl(null);
      }
    }
    // Reset value to allow selecting the same file again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  /**
   * 使用者自己按返回／完成＝這份工作結束，草稿收掉（不是跳出應用）。
   *
   * 這幾個 callback 都用 useCallback 固定住：編輯器裡有「換照片就把參數歸零」
   * 的 effect 相依於 onCancel，函式每次 render 都變新的話，App 只要重新 render
   * 一次就會把使用者的調整整組打回預設（接續上次時剛好會踩到）。
   */
  const leaveTool = useCallback(() => {
    setCurrentView('home');
    setToolDraftState(null);
    clearToolDraft();
  }, []);

  const handleEditorSave = useCallback((newSrc: string) => {
    leaveTool();
    setEditorImage(null);
    setEditorFile(null);
  }, [leaveTool]);

  const handleEditorCancel = useCallback(() => {
    leaveTool();
    setEditorImage(null);
    setEditorFile(null);
  }, [leaveTool]);

  /** 接續上次：經典拼圖自己會從草稿還原，其他工具要把照片與參數餵回去 */
  const handleResume = async () => {
    if (!resume) return;
    if (resume.kind === 'layout') {
      setResume(null);
      setCurrentView('layout');
      return;
    }
    setResuming(true);
    try {
      const draft = await loadToolDraft();
      if (!draft) { await clearToolDraft(); setResume(null); return; }
      setToolDraftState(draft.state ?? null);
      if (draft.tool === 'editor') {
        setEditorImage(draft.src);
        setEditorImages([draft.src]);
        setEditorFile(null);
        setEditorKey(prev => prev + 1);
        setCurrentView('editor');
      } else if (draft.tool === 'beauty') {
        setBeautyImage(draft.src);
        setBeautyKey(prev => prev + 1);
        setCurrentView('beauty');
      } else {
        // 拼貼原本就是吃 File，草稿的照片轉回 File 就能走同一條載入路徑
        const blob = await (await fetch(draft.src)).blob();
        setCollageInitialFile(new File([blob], 'resume', { type: blob.type || 'image/png' }));
        setCollageKey(prev => prev + 1);
        setCurrentView('collage');
      }
      setResume(null);
    } finally {
      setResuming(false);
    }
  };

  /**
   * 回首頁就把導出紀錄重讀一次。
   * 另外訂閱變動 —— 離開工具時那筆是非同步寫進去的，會晚於這次重讀。
   */
  useEffect(() => {
    if (currentView !== 'home') return;
    let alive = true;
    const reload = () => { listExports().then(list => { if (alive) setRecentExports(list); }); };
    reload();
    const off = subscribeExports(reload);
    return () => { alive = false; off(); };
  }, [currentView]);

  /** 點最近輸出：把當時的原圖與參數餵回工具，回到導出當下的編輯狀態 */
  const handleOpenRecent = async (id: string) => {
    const rec = await loadExport(id);
    if (!rec) return;
    setToolDraftState(rec.meta.state ?? null);
    // 沿用這一筆的 key：等一下工具再記一次的時候是「更新這一筆」，不是多一筆
    setHistKey(rec.meta.photoKey ?? null);
    if (rec.meta.tool === 'layout') {
      /* 經典拼圖的紀錄要回到經典拼圖：state 裡有每一頁與每一個圖層
         （照片是當附件存的），所以回來之後每個物件都還能拖、還能改，
         不是一張已經拼死的圖。 */
      setLayoutInitialFiles([]);
      setLayoutKey(prev => prev + 1);
      setCurrentView('layout');
      return;
    }
    if (rec.meta.tool === 'collage') {
      /* 創意拼圖的紀錄要回到創意拼圖 —— 丟去編輯器的話開起來是另一個工具。
         存的是圖片內容，轉成 File 再餵回去（工具本來就吃 File）。 */
      try {
        const blob = await (await fetch(rec.src)).blob();
        setCollageInitialFile(new File([blob], 'abai.jpg', { type: blob.type || 'image/jpeg' }));
        setCollageKey(prev => prev + 1);
        setCurrentView('collage');
        return;
      } catch { /* 拿不到就照舊丟去編輯器 */ }
    }
    if (rec.meta.tool === 'beauty') {
      setBeautyImage(rec.src);
      setBeautyKey(prev => prev + 1);
      setCurrentView('beauty');
    } else {
      setEditorImage(rec.src);
      setEditorImages([rec.src]);
      setEditorFile(null);
      setEditorKey(prev => prev + 1);
      setCurrentView('editor');
    }
  };

  /** 不接續：兩份草稿都收掉，從乾淨的首頁開始 */
  const handleDiscardResume = async () => {
    setResume(null);
    await Promise.all([clearCollageDraft(), clearToolDraft()]);
  };

  return (
    <div className="abai-shell">
     <div className="abai-frame">
      {isImporting && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
          {importPreviewUrl && (
             <img src={importPreviewUrl} alt="Preview" className="absolute inset-0 w-full h-full object-contain opacity-30 blur-sm mix-blend-screen" />
          )}
          <div className="flex flex-col items-center gap-4 text-white relative z-10">
            <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin shadow-[0_0_15px_rgba(255,255,255,0.5)]"></div>
            <p className="text-sm font-black tracking-[0.2em] uppercase animate-pulse drop-shadow-md">載入中...</p>
          </div>
        </div>
      )}

      <input
        type="file"
        ref={addPhotosInputRef}
        className="hidden"
        multiple
        accept={RAW_ACCEPT}
        onChange={handleAddPhotosChange}
      />

      {/* 編輯可以一次選多張（批量編輯）；只選一張時跟以前完全一樣 */}
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        multiple
        accept={RAW_ACCEPT}
        onChange={handleFileChange}
      />

      <input
        type="file"
        ref={collageFileInputRef}
        className="hidden"
        /* 創意拼圖只收照片（含 RAW）。影片統一走經典拼圖。 */
        accept={RAW_ACCEPT}
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files || []) as File[];
          /* 有些系統的選檔器不理會 accept（「最近項目」那一欄尤其會），
             所以這裡再擋一次 —— 影片絕對不會進到創意拼圖。 */
          const photos = files.filter(f => !isVideoFileName(f));
          if (photos.length) handleImportToCollage(photos);
          if (collageFileInputRef.current) collageFileInputRef.current.value = '';
        }}
      />

      <input
        type="file"
        ref={beautyFileInputRef}
        className="hidden"
        accept={RAW_ACCEPT}
        onChange={handleBeautyFileChange}
      />

      <input type="file" ref={matchFileInputRef} className="hidden" accept={RAW_ACCEPT} onChange={handleMatchFileChange} />
      <input type="file" ref={matchRefInputRef} className="hidden" accept={RAW_ACCEPT} onChange={handleMatchRefChange} />

      <input 
        type="file" 
        ref={layoutFileInputRef} 
        className="hidden" 
        accept={MEDIA_ACCEPT}
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files || []) as File[];
          if (files.length > 0) handleImportToLayout(files);
          if (layoutFileInputRef.current) layoutFileInputRef.current.value = '';
        }}
      />

      {/* 上次還沒做完的東西：先問，不要直接跳進去 */}
      {resume && currentView === 'home' && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/80 backdrop-blur-sm px-8 animate-in fade-in duration-200">
          <div className="w-full max-w-[320px] rounded-3xl bg-[#141414] border border-white/10 p-6 text-center shadow-2xl animate-in zoom-in-95 duration-200">
            <p className="text-white font-black tracking-wide">要繼續上次的編輯嗎？</p>
            <p className="mt-2 text-[12px] leading-relaxed text-white/45">
              上次在「{TOOL_NAMES[resume.kind]}」還有沒完成的內容
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <button
                onClick={handleResume}
                disabled={resuming}
                className="h-12 rounded-full bg-white text-black font-black tracking-widest text-sm active:scale-95 transition-transform disabled:opacity-60"
              >
                {resuming ? '載入中…' : '繼續編輯'}
              </button>
              <button
                onClick={handleDiscardResume}
                disabled={resuming}
                className="h-12 rounded-full border border-white/15 text-white/70 font-bold tracking-widest text-sm active:scale-95 transition-transform disabled:opacity-60"
              >
                重新開始
              </button>
            </div>
          </div>
        </div>
      )}

      {currentView === 'home' && (
        <HomePage 
          onOpenCamera={() => setCurrentView('camera')} 
          onImportPhoto={handleGlobalImportClick} 
          onImportToCollage={handleCollageImportClick}
          onOpenLayout={() => {
            layoutFileInputRef.current?.click();
          }}
          onOpenBeauty={handleBeautyImportClick}
          onOpenMatch={handleMatchImportClick}
          recent={recentExports}
          onOpenRecent={handleOpenRecent}
        />
      )}

      {currentView === 'match' && matchImage && (
        <ColorMatchStudio
          imageSrc={matchImage}
          referenceSrc={matchRef}
          onPickReference={handleMatchRefClick}
          onCancel={() => { setCurrentView('home'); setMatchImage(null); setMatchRef(null); }}
          onHome={() => { setCurrentView('home'); setMatchImage(null); setMatchRef(null); }}
          onImportNew={handleMatchImportClick}
          onSendToEditor={handleBeautyToEditor}
        />
      )}

      {currentView === 'beauty' && beautyImage && (
        <BeautyStudio
          key={beautyKey}
          imageSrc={beautyImage}
          initialState={toolDraftState}
          onCancel={() => {
            leaveTool();
            setBeautyImage(null);
          }}
          onHome={() => {
            leaveTool();
            setBeautyImage(null);
          }}
          onImportNew={handleBeautyImportClick}
          onSendToEditor={handleBeautyToEditor}
        />
      )}

      {currentView === 'layout' && (
        <GridLayoutTool 
          key={layoutKey}
          onHome={() => {
            setCurrentView('home');
            setLayoutInitialFiles([]);
          }}
          initialFiles={layoutInitialFiles}
          initialState={toolDraftState}
          histKey={histKey}
          lutList={LUT_LIST}
          onImportNew={() => {
            layoutFileInputRef.current?.click();
          }}
        />
      )}

      {currentView === 'collage' && (
        <CollageTool 
          key={collageKey}
          onHome={() => {
            leaveTool();
            setCollageInitialFile(null);
            setCollageExtras([]);
          }}
          initialFile={collageInitialFile}
          initialExtras={collageExtras}
          initialState={toolDraftState}
          histKey={histKey}
          lutList={LUT_LIST}
          onImportNew={handleCollageImportClick}
        />
      )}

      {currentView === 'camera' && (
        <CameraInterface 
          onHome={() => setCurrentView('home')}
          lutList={LUT_LIST}
          onImportNew={handleGlobalImportClick}
        />
      )}

      {currentView === 'editor' && editorImage && (
        <ImageEditor 
          key={editorKey}
          imageSrc={editorImage}
          batchSrcs={editorImages}
          onAddPhotos={handleAddPhotosClick}
          initialState={toolDraftState}
          histKey={histKey}
          lutList={LUT_LIST}
          onSave={handleEditorSave}
          onCancel={handleEditorCancel}
          onHome={leaveTool}
          onImportNew={handleGlobalImportClick}
          originalFile={editorFile}
        />
      )}
     </div>
    </div>
  );
};

export default App;
