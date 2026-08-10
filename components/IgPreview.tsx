import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Heart, MessageCircle, Bookmark, Volume2, VolumeX } from 'lucide-react';

/**
 * IG 貼文預覽。
 *
 * 這一整組原本長在經典拼圖裡面，現在抽出來給兩個拼圖工具共用 ——
 * 同一份程式碼，所以兩邊看到的東西不可能有差別（那是「完全同款」唯一
 * 做得到的方式）。
 *
 * 外面只要餵：匯出好的那幾張圖、版位比例、頁數、頭像用的照片，以及關閉的回呼。
 * 帳號、頭像、翻頁、選音樂、聲音鍵全部是這一層自己的事。
 */
export type IgPreviewProps = {
  /** 每一頁匯出的成品（順序＝頁序）。還沒算好就傳空陣列，會顯示轉圈 */
  shots: string[];
  /** 貼文版位的比例：直接用頁面本身的比例，不夾到 IG 的支援範圍 */
  frame: { w: number; h: number };
  /** 共幾頁（頁碼、頁點、左右滑都看它） */
  pageCount: number;
  /** 頭像與「說讚」那排小頭像要用的照片，最多三張 */
  faces: string[];
  /** 這一頁有沒有影片：有的話才顯示聲音鍵 */
  hasVideo?: (pageIdx: number) => boolean;
  /** 比例 IG 吃不下時（直式 2:3、9:16）傳 false，會自己關掉 */
  supported?: boolean;
  /**
   * 這一篇貼文的「身分」。帳號、頭貼、按讚數這些都會照 slot 分開存，
   * 所以同一頁疊兩篇時彼此不會互相影響。不傳就是舊的單篇行為。
   */
  slot?: string;
  /** 內嵌模式：不自己占滿整個畫面、也不畫關閉鍵（由外面那層負責） */
  embedded?: boolean;
  /** 有值的話這一篇是影片版：媒體區放 <video> 而不是 <img> */
  video?: string;
  /** 音樂改成由外面保管（兩篇要共用同一首）。沒傳就用自己的狀態 */
  music?: any;
  onMusicChange?: (t: any) => void;
  onClose: () => void;
};

export const IgPreview: React.FC<IgPreviewProps> = ({
  shots, frame, pageCount, faces, hasVideo = (_pageIdx: number) => false, supported = true,
  slot = '', embedded = false, video, music, onMusicChange, onClose,
}) => {
  /** 這一篇貼文自己的存檔前綴。沒有 slot 就完全等於以前的鍵名。 */
  const KEY = (k: string) => `abai_ig_${slot ? slot + '_' : ''}${k}`;
  const igStripRef = useRef<HTMLDivElement>(null);
  const igTrackRef = useRef<HTMLDivElement>(null);
  const igDragRef = useRef<{ x0: number; y0: number; t0: number; dx: number; id: number; lock: '' | 'x' | 'y' } | null>(null);
  const [igPage, setIgPage] = useState(0);
  const [igBox, setIgBox] = useState({ w: 360, h: 450 });
  /* 是不是「加到主畫面」的全螢幕模式（PWA）。
     這個模式下 100dvh 等於整個螢幕，包含瀏海與主畫面指示條佔掉的區域，
     但那兩塊實際上不能拿來排版 —— 沒扣掉的話 IG 預覽的圖會長太高，
     下緣就被愛心那一排壓到（在 Safari 或電腦上不會，因為那裡的 100dvh
     本來就不含那兩塊）。env() 要 viewport-fit=cover 才會回報數值，
     這裡不動全域設定，改成偵測到全螢幕模式就自己扣一個保守值。 */
  const isStandalone = typeof window !== 'undefined'
    && (window.matchMedia?.('(display-mode: standalone)').matches
        || (window.navigator as any).standalone === true);

  /* ── IG 預覽的選音樂 ─────────────────────────────────────────────
     曲庫用 iTunes Search API：免金鑰、免登入，回傳 30 秒試聽、封面、歌名歌手。
     （Apple Music 官方那套要付費開發者帳號＋使用者本人有訂閱，不能用。）

     拿資料的路徑刻意排了三條，前一條失敗才走下一條 —— 因為在真機上失敗的
     方式不只一種，而且每一種都會讓清單變空：
       1. 直接 fetch：Apple 有給 CORS 標頭時這條最快、也最不容易出事。
       2. 同一個網址走 JSONP：沒有 CORS 標頭時只能這樣繞。
       3. 換一條轉送線再打同一支：Apple 是照 IP 限流的，換出口 IP 就繞得開。
     兩種傳輸都有逾時。JSONP 特別危險的是「腳本載進來了但根本沒呼叫
     callback」（API 不支援 callback 參數時就會這樣）—— 那時 onerror 不會觸發，
     沒有逾時的話畫面會永遠停在轉圈。 */
  type Track = {
    id: string; name: string; artist: string; art: string; preview: string; secs: number;
    /** 榜單來源才有：Apple 標的曲風（例如 51 / "K-Pop"） */
    genreId?: string; genre?: string;
    /** 新版榜單只給歌曲編號，試聽網址要再查一次才有 */
    appleId?: string;
    /** 這首歌的歌手編號：搜尋結果上方那一排歌手就是靠它認人、借封面當大頭照 */
    artistId?: string;
  };
  const TRANSPARENT_PX = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const [musicOpen, setMusicOpen] = useState(false);
  const [musicShown, setMusicShown] = useState(false);   // 控制滑入／滑出的動畫
  const [musicQuery, setMusicQuery] = useState('');
  const [musicTab, setMusicTab] = useState('為你推薦');
  const [musicList, setMusicList] = useState<Track[]>([]);
  const [musicLoading, setMusicLoading] = useState(false);
  const [musicError, setMusicError] = useState('');
  const [pickedOwn, setPickedOwn] = useState<Track | null>(null);
  /* 兩篇貼文要共用同一首歌，所以音樂可以交給外面保管。
     沒傳 onMusicChange 就退回自己管，經典拼圖那邊完全不受影響。 */
  const picked: Track | null = onMusicChange ? (music ?? null) : pickedOwn;
  const setPicked = (t: Track | null) => { if (onMusicChange) onMusicChange(t); else setPickedOwn(t); };
  /** 現在真的有聲音在放嗎（決定封面上要不要跳那排音量條） */
  const [musicPlaying, setMusicPlaying] = useState(false);
  /* 搜尋結果上方的「歌手」那一排，以及點進去之後的專輯／曲目。
     一層一層往下鑽：搜尋 → 歌手 → 專輯 → 那張專輯的每一首。 */
  const [musicArtists, setMusicArtists] = useState<Artist[]>([]);
  const [artistView, setArtistView] = useState<Artist | null>(null);
  const [artistAlbums, setArtistAlbums] = useState<Album[]>([]);
  const [albumView, setAlbumView] = useState<Album | null>(null);
  const [drillTracks, setDrillTracks] = useState<Track[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const drillReqRef = useRef(0);
  /** 正在替哪一首補試聽網址（那一列的封面上轉圈） */
  const [resolvingId, setResolvingId] = useState('');
  useEffect(() => {
    if (!audioRef.current) audioRef.current = new Audio();
    const a = audioRef.current;
    const on = () => setMusicPlaying(true);
    const off = () => setMusicPlaying(false);
    a.addEventListener('play', on);
    a.addEventListener('playing', on);
    a.addEventListener('pause', off);
    a.addEventListener('ended', off);
    return () => {
      a.removeEventListener('play', on);
      a.removeEventListener('playing', on);
      a.removeEventListener('pause', off);
      a.removeEventListener('ended', off);
    };
  }, []);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const musicReqRef = useRef(0);       // 只讓最後一次搜尋的結果進畫面
  /* 分頁：語言分頁＝該地區的熱門榜，再照 Apple 自己標的曲風篩出那個語言；
     為你推薦＝華日韓三份篩過的交錯；超夯＝各地合併，不分語言。
     「已儲存」不連網，讀本機收藏。 */
  const MUSIC_TABS = ['為你推薦', '超夯', '華語', '日語', '韓語', '已儲存'];
  /* 「每日全球 Top 100」：Apple 的每日榜是照國家發布的，沒有一份叫「全球」的，
     所以取幾個主要市場的每日榜合併，照「在幾個國家上榜」排名 ——
     跨越最多國家的那首就是全球最紅的那首。 */
  const GLOBAL_STORES = ['us', 'gb', 'jp', 'kr', 'tw', 'de', 'br'];

  /** 收藏：存在本機，「已儲存」那一頁就是這一份 */
  const [savedTracks, setSavedTracks] = useState<Track[]>(() => {
    try { return JSON.parse(localStorage.getItem('abai_music_saved') || '[]'); } catch { return []; }
  });
  const toggleSave = (t: Track) => setSavedTracks(prev => {
    const next = prev.some(x => x.id === t.id) ? prev.filter(x => x.id !== t.id) : [t, ...prev];
    try { localStorage.setItem('abai_music_saved', JSON.stringify(next)); } catch { /* 無痕模式寫不進去就算了 */ }
    return next;
  });

  /** 送出一次 JSONP，附逾時。網址由呼叫端組（回呼參數的位置每家不一樣） */
  const jsonp = (makeUrl: (cb: string) => string, ms = 4500) => new Promise<any>((resolve, reject) => {
    const cb = `itcb_${Math.random().toString(36).slice(2)}`;
    const sc = document.createElement('script');
    let settled = false;
    let timer = 0 as any;
    const cleanup = () => { clearTimeout(timer); delete (window as any)[cb]; sc.remove(); };
    timer = setTimeout(() => {
      if (settled) return; settled = true; cleanup(); reject(new Error('timeout'));
    }, ms);
    (window as any)[cb] = (v: any) => { if (settled) return; settled = true; cleanup(); resolve(v); };
    sc.onerror = () => { if (settled) return; settled = true; cleanup(); reject(new Error('blocked')); };
    sc.src = makeUrl(cb);
    document.head.appendChild(sc);
  });

  /** 一般 fetch，附逾時 */
  const getJSON = async (url: string, ms = 4500) => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    try {
      const r = await fetch(url, { signal: ac.signal, mode: 'cors', credentials: 'omit' });
      if (!r.ok) throw new Error(String(r.status));
      return await r.json();
    } finally { clearTimeout(t); }
  };

  const fromItunes = (d: any): Track[] => (d?.results || [])
    .filter((r: any) => r.previewUrl && r.trackName)
    .map((r: any) => ({
      id: `i${r.trackId}`,
      name: r.trackName,
      artist: r.artistName || '',
      // 100px 的封面換成 200px，視網膜螢幕才不會糊
      art: (r.artworkUrl100 || '').replace('100x100', '200x200'),
      preview: r.previewUrl,
      secs: Math.round((r.trackTimeMillis || 0) / 1000),
      artistId: String(r.artistId || ''),
    }));

  /** Apple 排行榜的 JSON：試聽檔藏在 link 陣列裡 rel="enclosure" 那一筆。
      那裡的 im:duration 是「試聽長度」不是歌曲長度，寫上去會每一首都顯示
      0:30，所以榜單這邊乾脆不顯示時間（secs 給 0）。 */
  const fromChart = (d: any): Track[] => (d?.feed?.entry || [])
    .map((e: any) => {
      const enc = (e.link || []).find((l: any) => l?.attributes?.rel === 'enclosure');
      const art = ((e['im:image'] || []).slice(-1)[0]?.label || '');
      return {
        id: `c${e.id?.attributes?.['im:id'] || e['im:name']?.label || ''}`,
        name: e['im:name']?.label || '',
        artist: e['im:artist']?.label || '',
        art: art.replace(/\/\d+x\d+bb\./, '/200x200bb.'),
        preview: enc?.attributes?.href || '',
        secs: 0,
        /* 榜單的每一筆本來就自己帶著曲風（Apple 放在 category 裡，新版欄位叫
           genres）。有這個就不必再用「歌名有沒有諺文」那種猜的方式分辨語言 ——
           BTS、BLACKPINK、NewJeans 的團名都是拉丁字母，用猜的一定會漏掉。 */
        genreId: String(e.category?.attributes?.['im:id'] ?? (e.genres || [])[0]?.genreId ?? ''),
        genre: String(e.category?.attributes?.term ?? e.category?.attributes?.label
          ?? (e.genres || [])[0]?.name ?? ''),
      };
    })
    .filter((t: Track) => t.preview && t.name);

  /* 同一份資料先試 fetch、再試 JSONP —— 真機上失敗的方式不只一種，
     而且每一種都會讓清單變空：
       · 對方沒給 CORS 標頭 → fetch 直接被瀏覽器擋掉，只能走 JSONP。
       · 整個網域連不上（被擋、被牆）→ 兩條都不通，只能換一家。
     兩種傳輸都有逾時。JSONP 特別危險的是「腳本載進來了但根本沒呼叫 callback」
     （API 不支援 callback 參數時就會這樣）—— 那時 onerror 不會觸發，
     沒有逾時的話畫面會永遠停在轉圈。 */
  const failLog = useRef<string[]>([]);
  /* 同一支端點，直接 fetch 與 JSONP 只會有一種通得了（要看對方給不給 CORS）。
     第一次兩種都試，之後就只用當時通的那一種 —— 每一次搜尋的請求數直接砍半。
     Apple 是照 IP 限流的，主人一路打字時這一半差很多。 */
  const goodWay = useRef<'' | 'f' | 'j'>('');
  /**
   * 同一份資料，fetch 與 JSONP「同時」發出去，誰先拿到有東西的就用誰。
   *
   * 以前是「先 fetch、失敗了才換 JSONP」—— 但 Apple 的搜尋端點沒有 CORS 標頭，
   * fetch 那條註定要等到逾時才會倒下，四個商店一起排隊等下來就是十幾秒，
   * 使用者早就認定「搜尋壞了」。同時發就只花其中快的那一條的時間。
   */
  const raceBoth = (
    tag: string,
    url: string,
    makeJsonpUrl: (cb: string) => string,
    parse: (d: any) => Track[],
  ): Promise<Track[]> => new Promise<Track[]>(resolve => {
    let done = false;
    let left = 2;
    const finish = (list: Track[]) => { if (!done) { done = true; resolve(list); } };
    const one = (job: Promise<any>, suffix: string) => job
      .then(d => {
        const list = parse(d);
        if (list.length) finish(list);
        else failLog.current.push(`${tag}${suffix}:0筆`);
      })
      .catch((e: any) => {
        failLog.current.push(`${tag}${suffix}:${String(e?.message || e).slice(0, 16)}`);
      })
      .finally(() => { if (--left === 0) finish([]); });
    if (goodWay.current === 'f') { left = 1; one(getJSON(url).then(d => { return d; }), ''); return; }
    if (goodWay.current === 'j') { left = 1; one(jsonp(makeJsonpUrl), 'J'); return; }
    one(getJSON(url).then(d => { goodWay.current = 'f'; return d; }), '');
    one(jsonp(makeJsonpUrl).then(d => { if (!goodWay.current) goodWay.current = 'j'; return d; }), 'J');
  });

  /**
   * Apple 現在還在維護的排行榜（rss.applemarketingtools.com）。
   *
   * 舊的 itunes.apple.com/{cc}/rss/topsongs 那支已經幾乎沒東西了 —— 那就是
   * 「韓語只有四首」的真正原因：不是篩掉的，是本來就只回那幾首。
   * 新版這支有 CORS、資料是滿的，而且每一筆自己帶著曲風（K-Pop / J-Pop…）。
   * 唯一的缺點是沒有試聽網址，要再用 lookup 補（見 lookupPreviews）。
   */
  const fromModernChart = (d: any): Track[] => (d?.feed?.results || []).map((r: any) => {
    const gs = (r.genres || []).filter((g: any) => String(g?.genreId) !== '34');
    return {
      id: `m${r.id}`,
      name: r.name || '',
      artist: r.artistName || '',
      art: String(r.artworkUrl100 || '').replace(/\/\d+x\d+bb\./, '/200x200bb.'),
      preview: '',
      secs: 0,
      appleId: String(r.id || ''),
      // 全部的曲風編號都留著（不是只留第一個）—— 語言分類就是照這個篩的
      genreId: gs.map((g: any) => String(g?.genreId || '')).filter(Boolean).join(','),
      genre: gs.map((g: any) => g?.name).filter(Boolean).join(' '),
    } as Track;
  }).filter((t: Track) => t.name && t.appleId);

  /* 這支有 CORS，直接 fetch 就好，不要再多送一個 JSONP ——
     它不支援 callback，那個 script 載回來會是純 JSON，瀏覽器當程式碼解析
     會噴一堆語法錯誤，白白多一個請求也多一堆雜訊。 */
  const loadModernChart = async (store: string): Promise<Track[]> => {
    const url = `https://rss.applemarketingtools.com/api/v2/${store}/music/most-played/100/songs.json`;
    try {
      return fromModernChart(await getJSON(url));
    } catch (e: any) {
      failLog.current.push(`${store}新榜:${String(e?.message || e).slice(0, 16)}`);
      return [];
    }
  };

  /** 一次把一整批歌曲編號換成試聽網址（一個請求最多 190 首，不是一首一個請求） */
  const lookupPreviews = async (ids: string[], store: string): Promise<Map<string, Track>> => {
    const m = new Map<string, Track>();
    if (!ids.length) return m;
    const url = 'https://itunes.apple.com/lookup?entity=song&limit=200'
      + `&country=${store}&id=${ids.slice(0, 190).join(',')}`;
    let got = await raceBoth(`${store}查`, url, cb => `${url}&callback=${cb}`, fromItunes)
      .catch(() => [] as Track[]);
    // 直接打被 IP 鎖住（403）時換一條線 —— 這一步就是韓語能不能有歌的關鍵
    if (!got.length) got = await viaRelay(`${store}查`, url, fromItunes);
    got.forEach(t => m.set(t.id.replace(/^i/, ''), t));
    return m;
  };

  /** 某個地區的近期熱門榜；榜單失效就退回該地區的搜尋 */
  /* 舊版榜單有給 CORS 標頭，直接 fetch 就好，不必再多送一個 JSONP：
     多送的那一個不但白花一次流量額度，回來的內容若不是合法 JS
     還會在主控台噴一排語法錯誤。直連不通時改走轉送。 */
  const loadChart = async (store: string, genre?: string): Promise<Track[]> => {
    const seg = `limit=100${genre ? `/genre=${genre}` : ''}`;
    const tag = `${store}${genre ? `榜${genre}` : '榜'}`;
    const url = `https://itunes.apple.com/${store}/rss/topsongs/${seg}/json`;
    try {
      const list = fromChart(await getJSON(url));
      if (list.length) return list;
      failLog.current.push(`${tag}:0筆`);
    } catch (e: any) {
      failLog.current.push(`${tag}:${String(e?.message || e).slice(0, 14)}`);
    }
    return viaRelay(tag, url, fromChart);
  };

  /* ── 語言分類：用 Apple 自己標的曲風編號，不做任何猜測 ────────────────
     主人要的是「每個分類 100% 是那個語言」。
     Apple 的排行榜每一筆本身就帶著曲風編號（genres），那是 Apple 官方的標籤，
     不是我從歌名猜的 —— 照它篩就不可能錯。編號取自 Apple 的曲風總表：
       51 / 1686  K-Pop      1243〜1247  韓國（含傳統）
       27 / 1627  J-Pop      28 演歌  29 動漫  1186 日本流行  1201 日本
       1253 Mandopop  1251 Cantopop/HK-Pop  1250 C-Pop  1232 / 1637 中文
       1233〜1240 中文古典、戲曲、台灣民謠等
     寧可少幾首也不放進不確定的 —— 精準優先，這是主人指定的。 */
  /* ── 試聽網址的長期快取 ───────────────────────────────────────────────
     Apple 的 /lookup 是照 IP 限流的那一支（大約每分鐘二十次就開始回 403）。
     試聽網址本身不會變，所以查過一次就寫進 localStorage 永久留著 ——
     同一首歌一輩子只查一次，額度幾乎不會再被用掉。
     榜單本身另外存三小時，換分頁、關掉再打開都不必重新連網。 */
  const PV_KEY = 'abai_music_pv';
  const previewCache = useRef<Record<string, { u: string; s: number }>>((() => {
    try { return JSON.parse(localStorage.getItem(PV_KEY) || '{}'); } catch { return {}; }
  })());
  const savePreviewCache = () => {
    try {
      const all = previewCache.current;
      const keys = Object.keys(all);
      // 只留最後五千筆，免得無上限地長大
      if (keys.length > 5000) keys.slice(0, keys.length - 5000).forEach(k => { delete all[k]; });
      localStorage.setItem(PV_KEY, JSON.stringify(all));
    } catch { /* 無痕模式寫不進去就算了 */ }
  };
  const rememberPreview = (appleId: string, u: string, s: number) => {
    if (!appleId || !u) return;
    previewCache.current[appleId] = { u, s };
  };
  /** 把快取裡有的先貼上去，回傳「還缺哪些編號」 */
  const applyCachedPreviews = (list: Track[]): { list: Track[]; missing: string[] } => {
    const missing: string[] = [];
    const out = list.map(t => {
      if (t.preview || !t.appleId) return t;
      const hit = previewCache.current[t.appleId];
      if (hit) return { ...t, preview: hit.u, secs: hit.s || t.secs };
      missing.push(t.appleId);
      return t;
    });
    return { list: out, missing };
  };

  const CHART_KEY = 'abai_music_chart';
  const CHART_TTL = 3 * 60 * 60 * 1000;
  const readChartCache = (store: string): Track[] | null => {
    try {
      const all = JSON.parse(localStorage.getItem(CHART_KEY) || '{}');
      const row = all[store];
      if (row && Date.now() - row.t < CHART_TTL && Array.isArray(row.v) && row.v.length) return row.v;
    } catch { /* 壞掉就當作沒有 */ }
    return null;
  };
  const writeChartCache = (store: string, v: Track[]) => {
    try {
      const all = JSON.parse(localStorage.getItem(CHART_KEY) || '{}');
      all[store] = { t: Date.now(), v };
      localStorage.setItem(CHART_KEY, JSON.stringify(all));
    } catch { /* 空間不夠就算了 */ }
  };

  /** 打 Apple：直連與轉送「同時」發，誰先拿到有東西的就用誰（不再等直連失敗才換） */
  const appleJson = <T,>(tag: string, url: string, parse: (d: any) => T[]): Promise<T[]> =>
    new Promise<T[]>(resolve => {
      let done = false;
      let left = 2;
      const finish = (v: T[]) => { if (!done) { done = true; resolve(v); } };
      const arm = (job: Promise<T[]>) => job
        .then(v => { if (v.length) finish(v); })
        .catch(() => { /* 死法已經記在 failLog 裡 */ })
        .finally(() => { if (--left === 0) finish([]); });
      arm(Date.now() >= appleBlockedUntil.current
        ? raceBoth(tag, url, cb => `${url}${url.includes('?') ? '&' : '?'}callback=${cb}`, parse as any) as any
        : Promise.resolve([] as T[]));
      arm(viaRelay(tag, url, parse as any) as any);
    });

  /**
   * 搜歌手時要出現「那位歌手的所有歌」，而不是搜尋結果那幾首。
   * 做法是 Apple 官方的兩步：先用 musicArtist 查出歌手編號，
   * 再用 lookup 把他名下的歌一次撈回來（一個請求最多 200 首）。
   */
  /** src：這位歌手／這張專輯是從哪一家查到的，往下鑽時要打對應的那一家 */
  type Artist = { id: string; name: string; genre?: string; art?: string };
  type Album = { id: string; name: string; art: string; year: string; count: number };

  const fromArtists = (d: any): Artist[] => (d?.results || [])
    .filter((r: any) => r.artistId && r.artistName)
    .map((r: any) => ({
      id: String(r.artistId), name: String(r.artistName),
      genre: r.primaryGenreName || '',
    }));

  const fromAlbums = (d: any): Album[] => (d?.results || [])
    .filter((r: any) => r.wrapperType === 'collection' && r.collectionId)
    .map((r: any) => ({
      id: String(r.collectionId),
      name: String(r.collectionName || ''),
      art: String(r.artworkUrl100 || '').replace(/\/\d+x\d+bb\./, '/300x300bb.'),
      year: String(r.releaseDate || '').slice(0, 4),
      count: Number(r.trackCount || 0),
    }));

  /** 找同名的歌手（搜尋結果上方那一排） */
  const findArtists = (term: string, store: string): Promise<Artist[]> => appleJson<Artist>(
    `${store}歌手`,
    `https://itunes.apple.com/search?media=music&entity=musicArtist&limit=12`
      + `&country=${store}&term=${encodeURIComponent(term)}`,
    fromArtists);

  /** 某位歌手的全部專輯（新到舊） */
  const loadArtistAlbums = async (a: Artist, store: string): Promise<Album[]> => {
    const list = await appleJson<Album>(`${store}專輯`,
      `https://itunes.apple.com/lookup?entity=album&limit=200&country=${store}&id=${a.id}`,
      fromAlbums);
    return [...list].sort((x, y) => (y.year || '').localeCompare(x.year || ''));
  };

  /** 某張專輯裡的每一首歌（照曲目順序） */
  const loadAlbumTracks = (al: Album, store: string): Promise<Track[]> => appleJson<Track>(
    `${store}曲目`,
    `https://itunes.apple.com/lookup?entity=song&limit=200&country=${store}&id=${al.id}`,
    fromItunes);

  /** 某位歌手的熱門曲。注意：這一支回的是「代表作」，不是全部。 */
  const loadSongsOfArtist = (a: Artist, store: string): Promise<Track[]> => appleJson<Track>(
    `${store}全曲`,
    `https://itunes.apple.com/lookup?entity=song&limit=200&country=${store}&id=${a.id}`,
    fromItunes);

  const songKey = (t: Track) => `${t.name}|${t.artist}`.toLowerCase().replace(/\s+/g, '');

  /**
   * 某位歌手的「全部歌曲」。
   *
   * lookup?entity=song 回的只是代表作那幾首 —— 搜「yoasobi」只出現幾首就是這個
   * 原因。真正的全部要一張專輯一張專輯去拿：先問他有哪些專輯，再把每一張的曲目
   * 都撈回來，跟代表作合起來去重。
   *
   * onGot 是「拿到一批就先給一批」，畫面才不用等到全部專輯都問完。
   * 專輯數有上限、同時只問三張：Apple 的 lookup 是照 IP 限流的，要省著用。
   */
  /** 翻過的歌手全曲存起來：同一位歌手在同一次開著面板期間只翻一次專輯 */
  const artistAll = useRef<Map<string, Track[]>>(new Map());

  const loadWholeArtist = async (
    a: Artist, store: string, onGot?: (list: Track[]) => void,
    maxAlbums = 10, known?: Album[],
  ): Promise<Track[]> => {
    const memo = artistAll.current.get(a.id);
    if (memo && memo.length) { onGot?.(memo); return memo; }
    const [top, albums] = await Promise.all([
      loadSongsOfArtist(a, store).catch(() => [] as Track[]),
      // 歌手頁已經先問過專輯了，就別再問一次（Apple 的額度要省著用）
      known ? Promise.resolve(known) : loadArtistAlbums(a, store).catch(() => [] as Album[]),
    ]);
    const out = [...top];
    const seen = new Set(out.map(songKey));
    if (out.length) onGot?.([...out]);
    const pick = albums.slice(0, maxAlbums);
    let cur = 0;
    const worker = async () => {
      for (;;) {
        const i = cur++;
        if (i >= pick.length) return;
        const tracks = await loadAlbumTracks(pick[i], store).catch(() => [] as Track[]);
        let added = false;
        tracks.forEach(t => {
          const k = songKey(t);
          if (seen.has(k)) return;
          seen.add(k);
          out.push(t);
          added = true;
        });
        if (added) onGot?.([...out]);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (out.length) artistAll.current.set(a.id, out);
    return out;
  };

  /**
   * 搜尋結果上方那一排歌手。
   *
   * 以前只靠 entity=musicArtist 那一支，它打歌名時回空的，那一排就整個不見 ——
   * 這就是主人說的「有時候有、有時候沒有」。
   * 現在改成兩邊合起來：那一支查到的，加上「搜尋結果裡實際出現的每一位歌手」。
   * 只要搜得到歌，就一定看得到歌手。
   *
   * 歌曲資料裡本來就有 artistId，靠它就能認出「這一排該有誰」；
   * 照片另外去 Apple Music 的歌手頁拿（見下面的 fetchArtistPic）。
   */
  const artistsInTracks = (tracks: Track[]) => {
    const hits = new Map<string, number>();
    const cover = new Map<string, string>();
    const list: Artist[] = [];
    const seen = new Set<string>();
    tracks.forEach(t => {
      const id = t.artistId || '';
      if (!id || !t.artist) return;
      hits.set(id, (hits.get(id) || 0) + 1);
      if (t.art && !cover.has(id)) cover.set(id, t.art);
      if (seen.has(id)) return;
      seen.add(id);
      list.push({ id, name: t.artist });
    });
    return { list, hits, cover };
  };

  /** 兩份歌手合起來、排序：名字對得上的排前面，其次是歌比較多的 */
  const mergeArtists = (found: Artist[], tracks: Track[], term: string): Artist[] => {
    const { list: fromSongs, hits, cover } = artistsInTracks(tracks);
    const out: Artist[] = [];
    const seen = new Set<string>();
    [...found, ...fromSongs].forEach(a => {
      if (!a.id || seen.has(a.id)) return;
      seen.add(a.id);
      /* 有官方照片就用官方照片；還沒抓到就先用他自己的歌的封面墊著 ——
         那一排一定要有圖，不能只剩一個字母。抓到官方照片之後會自動換掉。 */
      out.push({ ...a, art: a.art || artistPic.current[a.id] || cover.get(a.id) || '' });
    });
    const nq = term.toLowerCase().replace(/\s+/g, '');
    const match = (a: Artist) => (a.name.toLowerCase().replace(/\s+/g, '').includes(nq) ? 1 : 0);
    return out
      .sort((a, b) => (match(b) - match(a)) || ((hits.get(b.id) || 0) - (hits.get(a.id) || 0)))
      .slice(0, 15);
  };

  /* ── 歌手大頭照：跟 Apple Music 上看到的同一張 ─────────────────────────
     iTunes 的 entity=musicArtist 那一支**不給**歌手照片，所以之前是拿他隨便
     一首歌的專輯封面頂替 —— 那不是他的照片，主人說得對。
     Apple Music 的歌手頁把官方照片放在 og:image，那就是網頁上顯示的那一張。
     那個網域沒有 CORS，所以借轉送把 HTML 取回來讀那一行。
     抓過一次就永久存在本機，同一位歌手一輩子只抓一次。 */
  const PIC_KEY = 'abai_music_artistpic';
  const artistPic = useRef<Record<string, string>>((() => {
    try { return JSON.parse(localStorage.getItem(PIC_KEY) || '{}'); } catch { return {}; }
  })());
  const savePics = () => {
    try { localStorage.setItem(PIC_KEY, JSON.stringify(artistPic.current)); } catch { /* 寫不進去就算了 */ }
  };
  const getText = async (url: string, ms: number): Promise<string> => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    try {
      const r = await fetch(url, { signal: ac.signal, mode: 'cors', credentials: 'omit' });
      if (!r.ok) throw new Error(String(r.status));
      return await r.text();
    } finally { clearTimeout(t); }
  };
  const fetchArtistPic = async (a: Artist, store: string): Promise<string> => {
    if (artistPic.current[a.id] !== undefined) return artistPic.current[a.id];
    const page = `https://music.apple.com/${store}/artist/${a.id}`;
    for (const make of RELAYS) {
      try {
        const html = await getText(make(page), 6000);
        const m = html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
          || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
        if (m && m[1]) {
          // Apple 的圖片服務是即時裁的，換成正方形小圖，載得快也不會糊
          const url = m[1].replace(/\/\d+x\d+[a-z]{0,3}\.(jpg|jpeg|png|webp)/i, '/300x300bb.$1');
          artistPic.current[a.id] = url;
          savePics();
          return url;
        }
      } catch { /* 換下一條轉送 */ }
    }
    /* 轉送不通、或那位真的沒有官方照片時，退而用他自己專輯的封面 ——
       總比只剩一個字母好。記下來，不要每次都重抓。 */
    const al = await loadArtistAlbums(a, store).catch(() => [] as Album[]);
    const fallback = al.find(x => x.art)?.art || '';
    artistPic.current[a.id] = fallback;
    savePics();
    return fallback;
  };
  /** 把那一排歌手的照片補齊（一次最多八位、三條同時），抓到一張就即時貼上去 */
  const fillArtistArt = async (
    list: Artist[], store: string, onGot?: (l: Artist[]) => void,
  ): Promise<Artist[]> => {
    const out = [...list];
    const need = out.map((a, i) => [a, i] as const)
      .filter(([a]) => artistPic.current[a.id] === undefined).slice(0, 8);
    if (!need.length) return out;
    let cur = 0;
    const worker = async () => {
      for (;;) {
        const k = cur++;
        if (k >= need.length) return;
        const [a, i] = need[k];
        const url = await fetchArtistPic(a, store).catch(() => '');
        if (url) { out[i] = { ...out[i], art: url }; onGot?.([...out]); }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    return out;
  };

  /** 名字要真的對得上才算「就是在找這位歌手」 */
  const bestArtist = (artists: Artist[], term: string): Artist | undefined => {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');
    const nq = norm(term);
    if (!nq) return undefined;
    /* 以前只要有結果就拿第一位，打歌名（例如「告白氣球」）時會被硬塞
       一位不相干歌手的兩百首歌，把真正的關鍵字結果全部擠到後面去。 */
    return artists.find(a => norm(a.name) === nq)
      || artists.find(a => norm(a.name).includes(nq) || nq.includes(norm(a.name)));
  };

  const loadArtistSongs = async (term: string, store: string): Promise<Track[]> => {
    const best = bestArtist(await findArtists(term, store), term);
    return best ? loadSongsOfArtist(best, store) : [];
  };

  /* ── 搜尋的備援曲庫 ───────────────────────────────────────────────────
     只在 itunes.apple.com 一個字都沒回的時候才用，而且**只用在搜尋結果**。
     排行榜、語言分頁、為你推薦、超夯完全不碰這裡 ——
     上次把別家的地區榜混進語言分頁，就是分類變亂的原因，不會再犯。
     這裡走 JSONP：對方沒有 CORS 標頭，fetch 一定被瀏覽器擋掉。 */
  const fromBackup = (d: any): Track[] => (d?.data || [])
    .filter((r: any) => r.preview && r.title)
    .map((r: any) => ({
      id: `b${r.id}`,
      name: String(r.title),
      artist: r.artist?.name || '',
      art: r.album?.cover_medium || r.artist?.picture_medium || '',
      preview: String(r.preview),
      secs: Number(r.duration) || 30,
    }));

  const loadBackupSearch = async (term: string): Promise<Track[]> => {
    const page = async (i: number): Promise<Track[]> => {
      try {
        const u = `https://api.deezer.com/search?limit=100&index=${i * 100}`
          + `&q=${encodeURIComponent(term)}`;
        return fromBackup(await jsonp(cb => `${u}&output=jsonp&callback=${cb}`, 5000));
      } catch (e: any) {
        failLog.current.push(`備援${i + 1}:${String(e?.message || e).slice(0, 12)}`);
        return [];
      }
    };
    // 一頁一百，三頁一起發：關鍵字相關的歌一次最多三百首
    return (await Promise.all([page(0), page(1), page(2)])).flat();
  };

  /* Apple 的搜尋端點一旦回 403（流量上限），那一段時間內怎麼打都是 403。
     記下來先別再打：既不會拖慢畫面，也不會把鎖定時間一直往後推。 */
  const appleBlockedUntil = useRef(0);

  /**
   * 換一條線再問一次 Apple。
   *
   * 重點不是繞過 CORS（Apple 那兩支本來就有給 CORS 標頭），而是**換一個出口 IP**。
   * Apple 的搜尋／查詢服務是「照 IP」限流的，一旦被鎖，同一支手機怎麼重試都是
   * 403 —— 那正是「搜不到歌」和「榜單查不到試聽網址（所以韓語只剩四首）」的
   * 共同原因。透過公用轉送服務等於從別的 IP 出去，就繞開了那個鎖。
   * 只在直接打失敗時才用，正常情況完全不會經過它。
   */
  const RELAYS = [
    (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u: string) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  ];
  /* 幾條轉送要「同時」發、誰先成功就用誰。
     之前是一條一條試：第一條逾時 6.5 秒才輪到第二條，一次搜尋會呼叫這支
     四次（找歌手、拿歌手全曲、搜歌、美國商店），最壞情況疊起來就是幾十秒 ——
     那就是「搜尋反而變慢、甚至等不到結果」的原因。 */
  const viaRelay = (tag: string, url: string, parse: (d: any) => Track[]): Promise<Track[]> =>
    new Promise<Track[]>(resolve => {
      let left = RELAYS.length;
      let done = false;
      const finish = (v: Track[]) => { if (!done) { done = true; resolve(v); } };
      RELAYS.forEach((make, i) => {
        getJSON(make(url), 5000)
          .then(d => {
            const list = parse(d);
            if (list.length) finish(list);
            else failLog.current.push(`${tag}轉${i + 1}:0筆`);
          })
          .catch((e: any) => {
            failLog.current.push(`${tag}轉${i + 1}:${String(e?.message || e).slice(0, 14)}`);
          })
          .finally(() => { if (--left === 0) finish([]); });
      });
    });

  /* 搜尋結果照關鍵字存起來：退格、改字、切回同一個字都不必再打一次網路。
     Apple 的搜尋端點有流量上限，超過之後那段時間會整片回 403 ——
     少送一次就少一次被鎖的機會。 */
  const searchCache = useRef<Map<string, Track[]>>(new Map());
  /** 這次開啟已經抓下來的榜單，搜尋全掛時就在這裡面找，完全不用網路 */
  const chartPool = useRef<Map<string, Track[]>>(new Map());
  /* 這次開著面板期間「看過的每一首歌」（每個分頁的榜、每一次搜尋的結果）。
     打字時先在這裡面找，完全同步、零延遲，畫面在按鍵的當下就有東西。 */
  const seenPool = useRef<Map<string, Track>>(new Map());
  const instantRef = useRef('');
  /* 畫面上現在到底有沒有東西。搜尋時的規則很簡單：
     **已經有內容就絕不蓋轉圈上去**，不然打字打到一半會一直閃。 */
  const shownRef = useRef(0);
  /** 上一次真的把查詢送出去的時間，用來壓住「一路打字一路打 Apple」 */
  const lastFireRef = useRef(0);
  const remember = (list: Track[]) => list.forEach(t => {
    if (t.id && !seenPool.current.has(t.id)) seenPool.current.set(t.id, t);
  });

  /* 判斷一首歌是不是某個語言的：直接看歌名與歌手用的是哪一種文字。
     各地區的熱門榜本來就混了一堆西洋歌（韓國榜上很大一部分是英文歌），
     照榜原封不動端出來，「韓語」那一頁就不是韓語歌。 */
  /**
   * 「這一頁要哪一國的榜」就是全部了 —— 不再用歌名去猜語言。
   *
   * 之前用漢字／假名／諺文去篩，或用曲風標籤去挑，兩種都會出事：
   * BTS、BLACKPINK、NewJeans 的團名是拉丁字母，用文字篩會整批丟掉；
   * 曲風名稱各地區不一樣（韓國回「가요」不是「K-Pop」），對不上就變空的。
   *
   * 韓國商店的本週最多播放榜本來就是韓語歌的排行榜，台灣榜就是華語榜，
   * 日本榜就是日語榜 —— 直接把那一國的榜端出來，不多做任何判斷，
   * 這才是音樂平台真正的「本週熱門」。
   */

  /**
   * 全球熱門：把幾個主要地區的榜合起來，照「在幾個國家上榜」排序，
   * 同樣名次再比平均名次。一首歌在越多國家越前面，就越接近全球熱門。
   */
  const globalMerge = (byStore: Record<string, Track[]>): Track[] => {
    const score = new Map<string, { t: Track; s: number; n: number }>();
    Object.values(byStore).forEach(list => {
      (list || []).forEach((t, i) => {
        const k = trackKey(t);
        const add = 1 / (i + 1);
        const cur = score.get(k);
        if (cur) { cur.s += add; cur.n += 1; } else score.set(k, { t, s: add, n: 1 });
      });
    });
    /* 只留一百首：這一頁講明了是「每日全球 Top 100」，
       七個地區的榜合起來有好幾百首，不切的話就不是 Top 100 了。 */
    return [...score.values()]
      .sort((a, b) => (b.n - a.n) || (b.s - a.s))
      .slice(0, 100)
      .map(x => x.t);
  };

  /**
   * 判斷兩筆是不是同一首歌。
   *
   * 只比對「歌名｜歌手」的原字串是不夠的：同一首歌在不同地區的商店裡，
   * 後綴常常不一樣（Idol / Idol (feat. …) / アイドル - Single、大小寫、全半形、
   * 中間的空白與符號），四個榜合起來就會看到同一首出現好幾次。
   * 這裡把括號內容、-Single/Remaster 這類尾巴、所有非文字數字的符號全部拿掉再比。
   */
  const trackKey = (t: Track) => `${t.name}|${t.artist}`
    .toLowerCase()
    .replace(/[（(［\[【][^）)］\]】]*[）)］\]】]/g, ' ')
    .replace(/\s*[-–—]\s*(single|ep|remaster(ed)?[^|]*|deluxe[^|]*|explicit|feat\.?[^|]*)/g, ' ')
    .replace(/[^\p{L}\p{N}|]+/gu, '');

  /**
   * 把幾份歌單依 pattern 輪流交錯成一份，同一首歌只留一次。
   * lead 是「開頭先固定拿幾首」，為你推薦就靠這個讓前幾首一定是中文。
   */
  const weave = (
    lists: Record<string, Track[]>,
    pattern: string[],
    lead?: { store: string; count: number; keepOrder?: boolean },
  ): Track[] => {
    const q: Record<string, Track[]> = {};
    /* 一律照原本的順序，不再換起點。
       以前每次打開面板會隨機換一個開頭，是為了讓畫面看起來不那麼一成不變；
       但現在每個分頁講明了就是「每日 Top 100」，名次就是內容的一部分 ——
       第一名要真的排第一。

       lead 指定的那一份也要在這裡備好 —— 它不一定出現在 pattern 裡
       （搜歌手時「該歌手的全部歌曲」就只掛在 lead 上），漏掉的話
       整份會被無聲丟掉。 */
    const keys = lead ? [lead.store, ...pattern] : pattern;
    keys.forEach(k => {
      if (q[k]) return;
      q[k] = [...(lists[k] || [])];
    });
    const out: Track[] = [];
    const seen = new Set<string>();
    const push = (t?: Track) => {
      if (!t) return;
      const key = trackKey(t);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(t);
    };
    if (lead) for (let i = 0; i < lead.count; i++) push(q[lead.store]?.shift());
    let i = 0;
    for (let guard = 0; guard < 600; guard++) {
      if (!pattern.some(k => q[k]?.length)) break;
      const k = pattern[i++ % pattern.length];
      if (q[k]?.length) push(q[k]!.shift());
    }
    return out;
  };

  type Src =
    | { kind: 'search'; term: string; broad?: boolean }
    | { kind: 'chart'; stores: string[]; pattern: string[];
        lead?: { store: string; count: number } }
    | { kind: 'global'; stores: string[] };

  /**
   * 每個分頁就是 Apple 的一份榜，原封不動照名次端出來。
   *   為你推薦 → 每日台灣 Top 100
   *   華語 → 排行榜・華語流行樂
   *   日語 → 排行榜・日本流行樂（日本商店）
   *   韓語 → 排行榜・韓國流行樂
   *   超夯 → 每日全球 Top 100（七地每日榜合併）
   *
   * 三個曲風榜一律讀**台灣商店**的那一份 —— 主人打開 Apple Music 看到的
   * 「排行榜・韓國流行樂」就是台灣商店裡的那一份，不是韓國人自己在聽的那份。
   * 之前韓語讀韓國商店、日語讀日本商店，端出來的當然跟主人畫面上看到的不一樣。
   * 曲風編號是 Apple 官方的：1253 華語流行、27 日本流行、51 韓國流行。
   * alt 是備援商店：台灣商店那份真的拿不到時，再去該國自己的商店拿同一個曲風榜。
   */
  const TAB_CHART: Record<string, { store: string; genre?: string; alt?: string }> = {
    '為你推薦': { store: 'tw' },
    '華語': { store: 'tw', genre: '1253', alt: 'hk' },
    /* 日語讀**日本商店**的日本流行樂榜。
       台灣商店的那一份會把「華語歌手唱的日文歌」（例如鄧麗君的日文專輯）
       也算進日本流行樂 —— 對 Apple 的分類來說沒錯，但那不是主人要的日文歌。
       日本自己的榜就是現在的日本流行樂，不會有這個問題。 */
    '日語': { store: 'jp', genre: '27', alt: 'tw' },
    '韓語': { store: 'tw', genre: '51', alt: 'kr' },
  };
  const currentSource = (): Src => {
    const q = musicQuery.trim();
    if (q) return { kind: 'search', term: q };
    if (musicTab === '超夯') return { kind: 'global', stores: GLOBAL_STORES };
    const c = TAB_CHART[musicTab];
    if (c) {
      const key = c.genre ? `${c.store}#${c.genre}#${c.alt || ''}` : c.store;
      return { kind: 'chart', stores: [key], pattern: [key] };
    }
    return { kind: 'search', term: 'pop' };
  };

  /**
   * 一個地區的每日榜（含試聽網址）。曲風榜與每日榜都會用到。
   *
   * 一條鐵律：榜單絕不因為「配不到試聽網址」被丟掉 ——
   * 那正是韓語那次會整份消失的原因。
   */
  const dailyChart = async (store: string): Promise<{ list: Track[]; how: string[] }> => {
    const modern = await loadModernChart(store).catch(() => [] as Track[]);
    const hows: string[] = [];
    if (!modern.length) return { list: [], how: hows };
    hows.push('榜');
    // 先貼上本機記得的試聽網址，剩下的才需要真的連網去查
    const step1 = applyCachedPreviews(modern);
    let list = step1.list;
    if (step1.missing.length) {
      const m = await lookupPreviews(step1.missing, store);
      if (m.size) {
        hows.push('試聽');
        list = list.map(t => {
          const hit = t.preview ? null : m.get(t.appleId || '');
          if (!hit) return t;
          rememberPreview(t.appleId || '', hit.preview, hit.secs);
          return { ...t, preview: hit.preview, secs: hit.secs, art: hit.art || t.art };
        });
        savePreviewCache();
      } else {
        failLog.current.push(`${store}試聽:0筆`);
      }
    } else if (list.some(t => t.preview)) hows.push('試聽快取');
    return { list, how: hows };
  };

  const hasGenre = (t: Track, genre: string) =>
    String(t.genreId || '').split(/[^0-9]+/).includes(genre);

  /**
   * 拿一份榜。key 是 'tw'（每日榜）或 'tw#51#kr'（曲風榜＋備援商店）。
   * 全部走 Apple，沒有別家。
   *
   * 曲風榜要的就是「照抄 Apple Music 上的那一份」，所以這裡**一路都待在同一個
   * 曲風裡**，四條路依序試，沒有一條會換成別的東西：
   *   1. 台灣商店的曲風排行榜（主人在 Apple Music 看到的就是這一份）
   *   2. 該國自己商店的同一個曲風排行榜
   *   3. 台灣每日榜裡，Apple 標成這個曲風的歌
   *   4. 該國每日榜裡，Apple 標成這個曲風的歌
   * 四條都拿不到就回空的。
   * 以前最後會退回「整份每日榜」—— 韓語那一頁因此變成韓國每日榜（什麼語言都有），
   * 那就是主人說的「根本不是韓國流行樂」。寧可說拿不到，也不端別的東西上來。
   */
  const oneStore = async (key: string): Promise<{ list: Track[]; how: string }> => {
    const [store, genre, alt] = key.split('#');
    const inMem = chartPool.current.get(key);
    if (inMem && inMem.length) return { list: inMem, how: '快取' };
    const onDisk = readChartCache(key);
    if (onDisk && onDisk.length) {
      chartPool.current.set(key, onDisk);
      return { list: onDisk, how: '快取' };
    }
    const done = (list: Track[], how: string) => {
      chartPool.current.set(key, list);
      writeChartCache(key, list);
      return { list, how };
    };

    if (genre) {
      // ① 台灣商店的曲風排行榜（這一支自己就帶試聽網址，碰不到 /lookup 的限流）
      const g = await loadChart(store, genre).catch(() => [] as Track[]);
      if (g.length >= 10) return done(g, '曲風榜');
      failLog.current.push(`${store}曲風榜:${g.length}筆`);
      // ② 該國自己商店的同一個曲風排行榜
      if (alt) {
        const g2 = await loadChart(alt, genre).catch(() => [] as Track[]);
        if (g2.length >= 10) return done(g2, `${alt}曲風榜`);
        failLog.current.push(`${alt}曲風榜:${g2.length}筆`);
      }
      // ③④ 每日榜裡只留 Apple 標成這個曲風的歌（先台灣、再該國）
      for (const st of [store, ...(alt ? [alt] : [])]) {
        const d = await dailyChart(st);
        const only = d.list.filter(t => hasGenre(t, genre));
        if (only.length >= 10) return done(only, `${st}每日+曲風`);
      }
      failLog.current.push(`曲風${genre}:都拿不到`);
      return { list: [], how: '無' };
    }

    const d = await dailyChart(store);
    if (d.list.length) return done(d.list, d.how.join('+'));
    // 新榜整個拿不到才回頭問已經停更的舊榜
    const legacy = await loadChart(store).catch(() => [] as Track[]);
    if (legacy.length) chartPool.current.set(key, legacy);
    return { list: legacy, how: legacy.length ? '舊榜' : '無' };
  };

  const loadMusic = useCallback(async (src: Src) => {
    const my = ++musicReqRef.current;
    setMusicError('');
    /* 換分頁時要把舊的清掉、轉圈等新的 —— 不然畫面上還是上一個分類的歌，
       來回切幾次就會覺得「怎麼一直是重複的歌」。

       但**打字搜尋時絕對不能清**。清了的話，每按一個鍵畫面就閃成空白，
       等這一次連線回來才又有東西；主人打字比連線快，於是每個鍵都把畫面清掉，
       看起來就是「要打完整個字才會出現」。
       打字那一層（上面那個同步的 effect）已經先把結果放上去了，
       這裡只要安靜地把線上結果補上去就好。 */
    if (src.kind !== 'search') {
      setMusicLoading(true);
      shownRef.current = 0;
      setMusicList([]);
      setMusicArtists([]);
    }
    failLog.current = [];
    let list: Track[] = [];
    let how = '';
    if (src.kind === 'chart' || src.kind === 'global') {
      const stores = src.stores;
      const got = await Promise.all(stores.map(s => oneStore(s)));
      const byStore: Record<string, Track[]> = {};
      const hows = new Set<string>();
      // 榜原封不動，照 Apple 給的名次
      stores.forEach((s, i) => { hows.add(got[i].how); byStore[s] = got[i].list; });
      list = src.kind === 'global'
        ? globalMerge(byStore)
        : weave(byStore, src.pattern, src.lead);
      how = [...hows].filter(Boolean).join('/');
    } else {
      // 畫面上一片空白時才需要轉圈；已經有東西就讓它留著，等新的回來再換掉
      if (!shownRef.current) setMusicLoading(true);
      /* broad＝主人已經停手了，這次才把三個商店都問一遍（完整結果）。
         打字途中送出的是「窄」的那一種，只問台灣一個商店 ——
         夠讓畫面馬上有東西，又不會一路把 Apple 的額度打光。 */
      const broad = !!src.broad;
      const cached = searchCache.current.get(src.term.toLowerCase());
      if (cached) {
        if (my !== musicReqRef.current) return;
        shownRef.current = cached.length;
        setMusicList(cached);
        setMusicLoading(false);
        /* 這裡以前直接 return，上面剛剛才被清空的「歌手那一排」就再也沒被填回去 ——
           同一個字第一次搜有歌手、第二次（走快取）就整排不見，
           那正是主人說的「有時候會出現、有時候不會」。 */
        const back = mergeArtists([], cached, src.term);
        if (back.length) {
          setMusicArtists(back);
          if (back.some(a => artistPic.current[a.id] === undefined)) {
            fillArtistArt(back, 'tw', got => {
              if (my === musicReqRef.current) setMusicArtists(got);
            }).catch(() => {});
          }
        }
        return;
      }
      /* 所有來源「同時」發，而且誰先回來就先顯示誰。
         以前是一段一段接力（直連失敗才轉送、台灣查不到才問美國），
         每一段都要等上一段逾時，加起來就是主人說的「要等很久」。
         現在全部並行，畫面在第一份結果回來的那一刻就有東西，
         其餘的回來再補進去，不必等最慢的那一條。 */
      const term = src.term;
      const q = term.toLowerCase();
      const appleUrl = 'https://itunes.apple.com/search?media=music&entity=song&limit=200'
        + `&country=tw&term=${encodeURIComponent(term)}`;
      const usUrl = appleUrl.replace('country=tw', 'country=us');
      const jpUrl = appleUrl.replace('country=tw', 'country=jp');

      /* 榜單池只是「還沒連上線之前先有東西看」的墊檔。
         線上結果一回來就把它拿掉 —— 搜尋要搜的是整個 Apple Music 音樂庫，
         不是這幾份榜裡面。 */
      const local: Track[] = [];
      chartPool.current.forEach(arr => arr.forEach(t => {
        if (`${t.name} ${t.artist}`.toLowerCase().includes(q)) local.push(t);
      }));

      const bucket: Record<string, Track[]> = { ar: [], ap: [], us: [], jp: [], bk: [], lo: local };
      const online = () => !!(bucket.ap.length || bucket.us.length || bucket.jp.length
        || bucket.ar.length || bucket.bk.length);
      /* ar 放最前面而且一次全部倒出來：搜歌手時要看到「他的所有歌」，
         不是跟其他結果一首一首交錯。 */
      const render = () => weave(
        bucket,
        online() ? ['ap', 'us', 'jp', 'bk'] : ['lo'],
        { store: 'ar', count: 400, keepOrder: true },
      );
      if (local.length) { list = render(); shownRef.current = list.length; setMusicList(list); setMusicLoading(false); }

      /** 每次結果進來，上面那一排歌手也跟著重算（一定有圖片） */
      const refreshArtists = (found: Artist[]) => {
        const all = [...bucket.ar, ...bucket.ap, ...bucket.us, ...bucket.jp, ...bucket.bk];
        const merged = mergeArtists(found, all, term);
        if (merged.length) setMusicArtists(merged);
        return merged;
      };
      let artistsFound: Artist[] = [];

      /* 主人打「yoas」時要看到一大堆 YOASOBI 的歌。
         光靠 entity=musicArtist 那一支不夠 —— 打不完整的名字時它常常回空的。
         這裡改成「從搜尋結果本身認人」：結果裡哪位歌手的名字是以主人打的字
         開頭（或包含），而且他的歌最多，那就是主人在找的人，
         接著把他的全部歌曲整份倒到最前面。 */
      let expanded = '';
      const nq0 = term.toLowerCase().replace(/\s+/g, '');
      const norm0 = (x: string) => x.toLowerCase().replace(/\s+/g, '');
      const artistFromResults = (): Artist | undefined => {
        if (nq0.length < 2) return undefined;
        const { list, hits } = artistsInTracks([...bucket.ap, ...bucket.us, ...bucket.jp]);
        const cand = list.filter(a => norm0(a.name).includes(nq0));
        if (!cand.length) return undefined;
        return cand.sort((x, y) => {
          const sx = norm0(x.name).startsWith(nq0) ? 1 : 0;
          const sy = norm0(y.name).startsWith(nq0) ? 1 : 0;
          return (sy - sx) || ((hits.get(y.id) || 0) - (hits.get(x.id) || 0));
        })[0];
      };
      const expandArtist = async (a?: Artist) => {
        if (!a || !a.id || expanded === a.id) return;
        expanded = a.id;
        await loadWholeArtist(a, 'tw', got => feed('ar', got)).catch(() => {});
      };

      const feed = (key: string, got: Track[]) => {
        if (my !== musicReqRef.current || !got.length) return;
        remember(got);
        bucket[key] = got;
        list = render();
        shownRef.current = list.length;
        setMusicList(list);
        setMusicLoading(false);
        refreshArtists(artistsFound);
        /* 只在「主人停手之後的完整查詢」才去翻專輯 ——
           翻一位歌手要問十幾次，打字途中每個鍵都翻的話額度馬上就沒了。
           翻過的存在 artistAll 裡，之後同一位歌手完全不用再問。 */
        if (broad && key !== 'ar') expandArtist(artistFromResults());
      };

      await Promise.all([
        /* 同名歌手查一次就好，兩件事共用：
           上面那一排歌手（點進去挑專輯、挑單曲），
           以及名字對得上時把他的全部歌曲整份倒在最前面。 */
        findArtists(term, 'tw').then(async a => {
          if (my !== musicReqRef.current) return;
          artistsFound = a;
          refreshArtists(a);
          const best = bestArtist(a, term);
          if (!best) return;
          /* 打的就是歌手名字（例如「yoasobi」）時，要的是「他的全部歌曲」，
             所以連專輯一起翻。打的是歌名時只拿代表作就好 ——
             不然每搜一個字都去翻十張專輯，Apple 的額度馬上就爆掉。 */
          /* 名字以主人打的字開頭就算數（兩個字以上）——
             打「yoas」時 nb='yoasobi' 就命中，不必等打完整個名字。 */
          const nb = norm0(best.name);
          const wantWhole = nb === nq0 || (nq0.length >= 2 && nb.startsWith(nq0))
            || (nq0.length >= 4 && nb.includes(nq0));
          if (!wantWhole) { feed('ar', await loadSongsOfArtist(best, 'tw').catch(() => [] as Track[])); return; }
          await expandArtist(best);
        }).catch(() => {}),
        /* 三個商店「一起」問，不是查不到才問下一個。
           搜的是整個 Apple Music 音樂庫，各兩百首合起來去重 ——
           中文歌、西洋歌、日文歌都不會漏。搜尋結果本身就帶試聽網址，不必再查。 */
        appleJson('搜tw', appleUrl, fromItunes).then(r => feed('ap', r)).catch(() => {}),
        /* 還在打字（或只打了一兩個字）時只問台灣就好。
           一路問三個商店等於每按一個鍵就送好幾個請求出去，額度幾下就沒了。 */
        ...(!broad || term.trim().length <= 2 ? [] : [
          appleJson('搜us', usUrl, fromItunes).then(r => feed('us', r)).catch(() => {}),
          appleJson('搜jp', jpUrl, fromItunes).then(r => feed('jp', r)).catch(() => {}),
        ]),
      ]);
      // 兩個商店都空手才試「用歌手名整份撈」的那條路
      const gotApple = () => !!(bucket.ap.length || bucket.us.length || bucket.jp.length || bucket.ar.length);
      if (!gotApple()) feed('ar', await loadArtistSongs(term, 'us').catch(() => [] as Track[]));
      /* Apple 整個沒回東西（手機被限流、或連不上 itunes.apple.com）時的最後一道。
         主人在畫面上只看到兩三首、以為「搜尋壞了」，其實那兩三首是榜單快取裡
         剛好對到的 —— itunes.apple.com 一個字都沒回。
         這條備援**只補搜尋結果**，語言分頁與排行榜完全不碰，
         所以分類永遠還是 Apple 自己的，不會再被別家的榜弄亂。 */
      if (!gotApple()) {
        feed('bk', await loadBackupSearch(term).catch(() => [] as Track[]));
      }
      list = render();
      // 那一排歌手：還沒有圖片的幾位，拿他最新一張專輯的封面補上
      {
        const merged = refreshArtists(artistsFound);
        if (merged.some(a => artistPic.current[a.id] === undefined)) {
          fillArtistArt(merged, 'tw', got => {
            if (my === musicReqRef.current) setMusicArtists(got);
          }).catch(() => {});
        }
      }
      how = [bucket.ar.length && '歌手全曲', bucket.ap.length && '台灣商店',
             bucket.us.length && '美國商店', bucket.jp.length && '日本商店',
             bucket.bk.length && '備援',
             !online() && local.length && '榜單內'].filter(Boolean).join('+');
      /* 只有真的從線上拿到東西才存快取。
         單靠榜單池湊出來的那兩三首不能存 —— 存下去之後，同一個字再搜幾次
         都直接回那兩三首，永遠不會再連網重試，就變成「怎麼搜都只有兩首」。 */
      // 只有「問完三個商店」的完整結果才存快取；打字途中那份窄的不存，
      // 不然停手之後的完整查詢會直接吃到窄的快取，結果永遠少一截
      if (broad && list.length && (gotApple() || bucket.bk.length)) searchCache.current.set(q, list);
    }
    if (my !== musicReqRef.current) return;   // 已經有更新的搜尋了，這份丟掉
    remember(list);
    /* 連線結果是空的、但打字那一層已經放了東西上去，就別把畫面清空 ——
       主人會看到「本來有、忽然變沒有」。 */
    if (!list.length && src.kind === 'search' && shownRef.current) {
      setMusicLoading(false);
      return;
    }
    shownRef.current = list.length;
    setMusicList(list);
    setMusicError(list.length
      ? ''
      : `拿不到歌單，請確認網路後重試\n（${failLog.current.join('、') || '沒有可用的來源'}）`);
    setMusicLoading(false);
  }, []);

  // 開啟時滑入
  useEffect(() => {
    if (!musicOpen) return;
    const t = setTimeout(() => setMusicShown(true), 16);
    return () => clearTimeout(t);
  }, [musicOpen]);

  /* 每次重新打開都重抓一次榜、並換一個起點。
     不清的話，同一次開著 app 的期間看到的永遠是同一批、同一個順序 ——
     「每次進來都是固定那幾首」。榜單本身 Apple 每天更新，重抓就會拿到最新的；
     起點再輪一格，推薦的開頭也不會每次都一樣。 */
  useEffect(() => {
    if (!musicOpen) return;
    chartPool.current.clear();
    searchCache.current.clear();
    seenPool.current.clear();
    artistAll.current.clear();
    instantRef.current = '';
    // 重開就回到推薦、清掉上次打的字，不然會停在上次的搜尋結果
    setMusicQuery('');
    setMusicTab('為你推薦');
  }, [musicOpen]);

  /* 每敲一個字，先「不連網」把結果放上去。
     這一段完全同步，所以是零延遲 —— 主人打字的當下就看得到東西。
     資料來自 seenPool：這次開著面板期間看過的每一首歌（各分頁的榜、
     每一次搜尋回來的結果）都記在裡面，所以打得越久、這一層越準。
     真正的連線查詢在下一個 effect 裡防抖後才送，回來再蓋掉這一層。 */
  useEffect(() => {
    if (!musicOpen) return;
    const q = musicQuery.trim().toLowerCase();
    if (!q) return;
    const hit: Track[] = [];
    seenPool.current.forEach(t => {
      if (`${t.name} ${t.artist}`.toLowerCase().includes(q)) hit.push(t);
    });
    if (!hit.length) return;
    instantRef.current = q;
    shownRef.current = Math.min(hit.length, 200);
    setMusicList(hit.slice(0, 200));
    setMusicLoading(false);
    setMusicError('');
    // 這一層也馬上給出歌手那一排，不必等連線
    const arts = mergeArtists([], hit, musicQuery.trim());
    if (arts.length) setMusicArtists(arts);
  }, [musicOpen, musicQuery]);

  /* 分頁或搜尋字改變就重新拿一份。
     這裡刻意「不」把 savedTracks 放進相依陣列 —— 放進去的話，按一下收藏書籤
     就會整份重抓，清單先變成轉圈再重畫，看起來就是閃一下、抖一下。 */
  useEffect(() => {
    // 在「已儲存」也要能打字搜尋，只有沒打字的時候那一頁才是純本機清單
    if (!musicOpen || (musicTab === '已儲存' && !musicQuery.trim())) return;
    /* 打字時的送出時機：一般的防抖再加一個「最久等這麼久」的上限。
         · 停手 350ms → 送出（一般的防抖）
         · 但不管有沒有停手，距離上一次送出超過 700ms 就一定送一次

       只有防抖的話，主人一路打「yoasobi」中間都沒停超過 350ms，
       就會變成「打完整個字才出現」；只看每個鍵的話又會一路狂打 Apple，
       額度幾下就沒了、然後什麼都搜不到。兩個合起來剛好：
       打到 yo 就出結果，整串打完也只送三次左右。

       單獨一個英數字（例如剛打下 y）不查 —— 那個階段查了也沒意義。 */
    const q = musicQuery.trim();
    if (q.length === 1 && /^[a-z0-9]$/i.test(q)) return;
    const since = Date.now() - lastFireRef.current;
    const wait = q ? Math.max(0, Math.min(350, 700 - since)) : 0;
    const narrow = setTimeout(() => {
      lastFireRef.current = Date.now();
      loadMusic(currentSource());
    }, wait);
    /* 停手之後再補一次「完整」的：三個商店都問。
       只要主人又按了下一個鍵，這個計時器就會被下面的 cleanup 取消，
       所以真正跑到的只有最後那一次。 */
    const full = setTimeout(() => {
      lastFireRef.current = Date.now();
      const src = currentSource();
      if (src.kind === 'search') loadMusic({ ...src, broad: true });
    }, wait + 550);
    return () => { clearTimeout(narrow); clearTimeout(full); };
  }, [musicOpen, musicQuery, musicTab, loadMusic]);

  // 「已儲存」而且沒在搜尋時不連網，直接把本機收藏放上去（收藏變動時才跟著更新）
  useEffect(() => {
    if (!musicOpen || musicTab !== '已儲存' || musicQuery.trim()) return;
    musicReqRef.current++;                       // 取消還在跑的那一次
    setMusicList(savedTracks);
    setMusicLoading(false);
    setMusicError(savedTracks.length ? '' : '還沒有收藏的音樂，點歌曲右邊的書籤就會收進來');
  }, [musicOpen, musicTab, musicQuery, savedTracks]);

  /* 點輸入框時 iOS 會把整頁往上捲，好讓輸入框露出鍵盤 —— 但 IG 預覽整層是
     position:fixed，被捲上去只會整個歪掉。捲多少就捲回來，畫面完全不動；
     面板本身維持原本的高度，不因為鍵盤而縮，鍵盤後面的部分照樣在那裡。
     選音樂的搜尋欄和改帳號名字都會叫出鍵盤，所以整個 IG 預覽期間都盯著。 */
  useEffect(() => {
    const vv = (window as any).visualViewport;
    const hold = () => {
      /* 有輸入框正在打字時「不要」跟瀏覽器搶捲動位置。
         iOS 聚焦輸入框時會自己捲一段，好讓游標露在鍵盤上方；這時候每一幀都把它
         捲回 0 等於跟系統打架 —— 鍵盤忽開忽關、按鍵吃不進去，看起來就是
         「搜尋欄根本不能用」。 */
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (window.scrollY !== 0 || window.pageYOffset !== 0) window.scrollTo(0, 0);
      if (document.documentElement.scrollTop) document.documentElement.scrollTop = 0;
      if (document.body.scrollTop) document.body.scrollTop = 0;
    };
    window.addEventListener('scroll', hold, { passive: true });
    vv?.addEventListener('scroll', hold);
    vv?.addEventListener('resize', hold);
    return () => {
      window.removeEventListener('scroll', hold);
      vv?.removeEventListener('scroll', hold);
      vv?.removeEventListener('resize', hold);
    };
  }, []);
  // 預覽開著的時候比例被改成 IG 吃不下的，就把預覽收掉（按鈕也已經不見了）
  useEffect(() => {
    if (!supported) onClose();
  }, [supported, onClose]);

  // 關掉 IG 預覽（＝這個元件被卸載）時把音樂一起停掉
  useEffect(() => () => {
    audioRef.current?.pause();
  }, []);

  /** 滑出去之後才真的卸載，動畫才跑得完 */
  const closeMusic = () => {
    setMusicShown(false);
    setTimeout(() => setMusicOpen(false), 300);
  };

  /* ── 歌手 → 專輯 → 曲目 ────────────────────────────────────────
     搜尋只給關鍵字相關的歌，想精準找到某一首時就從歌手鑽進去。 */
  const openArtist = async (a: Artist) => {
    const my = ++drillReqRef.current;
    setArtistView(a); setAlbumView(null);
    setArtistAlbums([]); setDrillTracks([]); setDrillLoading(true);
    /* 歌手頁要的就是「他的每一首」，所以直接走翻專輯那條路。
       每翻完一張就先貼上畫面（onGot），主人不用等到全部問完才看得到東西。
       去重刻意不用榜單那把 trackKey —— 它會連括號一起抹掉，
       「雙截棍」和「雙截棍（演唱會版）」會被當成同一首而少掉一個版本。 */
    let al = await loadArtistAlbums(a, 'tw').catch(() => [] as Album[]);
    if (my !== drillReqRef.current) return;
    let store = 'tw';
    if (!al.length) {                       // 台灣商店查不到就換美國（日韓西洋歌比較齊）
      const al2 = await loadArtistAlbums(a, 'us').catch(() => [] as Album[]);
      if (my !== drillReqRef.current) return;
      if (al2.length) { al = al2; store = 'us'; }
    }
    setArtistAlbums(al);
    const sg = await loadWholeArtist(a, store, got => {
      if (my === drillReqRef.current) { setDrillTracks(got); setDrillLoading(false); }
    }, 20, al).catch(() => [] as Track[]);
    if (my !== drillReqRef.current) return;
    setDrillTracks(sg);
    setDrillLoading(false);
  };

  const openAlbum = async (al: Album) => {
    const my = ++drillReqRef.current;
    setAlbumView(al); setDrillTracks([]); setDrillLoading(true);
    let tracks = await loadAlbumTracks(al, 'tw').catch(() => [] as Track[]);
    if (my !== drillReqRef.current) return;
    if (!tracks.length) {
      tracks = await loadAlbumTracks(al, 'us').catch(() => [] as Track[]);
      if (my !== drillReqRef.current) return;
    }
    setDrillTracks(tracks);
    setDrillLoading(false);
  };

  /** 回上一層：專輯 → 歌手 → 搜尋結果 */
  const drillBack = () => {
    drillReqRef.current++;
    if (albumView) { setAlbumView(null); if (artistView) openArtist(artistView); return; }
    setArtistView(null); setArtistAlbums([]); setDrillTracks([]); setDrillLoading(false);
  };
  // 換分頁、改搜尋字、關掉面板都要退回最外層
  useEffect(() => {
    drillReqRef.current++;
    setArtistView(null); setAlbumView(null);
    setArtistAlbums([]); setDrillTracks([]); setDrillLoading(false);
  }, [musicTab, musicQuery, musicOpen]);

  /* 點一首歌＝當場試聽，面板不關。
     可以一首一首點著比較，決定好了再自己把面板關掉，才會回到 IG 預覽。
     再點同一首就是停止播放。 */
  const pickTrack = async (t: Track) => {
    if (!audioRef.current) audioRef.current = new Audio();
    const a = audioRef.current;
    if (picked?.id === t.id && !a.paused) { a.pause(); return; }
    let use = t;
    if (!use.preview) {
      /* 這一首還沒配到試聽網址（整批查的時候被 Apple 擋掉了）。
         就替這一首單獨查一次 —— 一個請求換一首，額度上非常便宜。
         先在這一拍裡碰一下音訊元件把它解鎖：iOS 只認「使用者按下去的那一拍」，
         等查完網址才第一次呼叫 play 會被系統擋掉。 */
      try { a.play().then(() => a.pause()).catch(() => {}); } catch { /* 還沒有 src，忽略 */ }
      setResolvingId(t.id);
      const got = t.appleId ? await lookupPreviews([t.appleId], 'tw') : new Map<string, Track>();
      const hit = got.get(t.appleId || '');
      setResolvingId('');
      if (!hit) return;                       // 真的查不到就當作沒這回事，不要跳錯誤訊息
      rememberPreview(t.appleId || '', hit.preview, hit.secs);
      savePreviewCache();
      use = { ...t, preview: hit.preview, secs: hit.secs || t.secs };
      const patch = (arr: Track[]) => arr.map(x => (x.id === t.id ? use : x));
      setMusicList(patch);
      setDrillTracks(patch);
    }
    setPicked(use);
    a.src = use.preview;
    a.loop = true;
    a.currentTime = 0;
    a.play().catch(() => {});
  };
  // 元件整個被卸載時（例如離開經典拼圖）也要把音樂停掉，不然會一直播下去
  useEffect(() => () => { audioRef.current?.pause(); audioRef.current = null; }, []);
  // 直接量那個 4:5 的框：算的話會跟實際差幾個像素，頁面就會凸出去一點
  useEffect(() => {
    setIgPage(0);
    setIgMuted(true);
    let ro: ResizeObserver | null = null;
    const attach = () => {
      const el = igStripRef.current;
      if (!el) { requestAnimationFrame(attach); return; }
      const measure = () => setIgBox({ w: Math.round(el.clientWidth), h: Math.round(el.clientHeight) });
      measure();
      ro = new ResizeObserver(measure);
      ro.observe(el);
    };
    attach();
    return () => ro?.disconnect();
  }, []);

  /* ── IG 貼文的翻頁 ────────────────────────────────────────────────
     不用瀏覽器的捲動＋scroll-snap：那個放手之後還會自己滑一段再吸過去，
     就是那股「緩衝感」，而且滑太快還會一次跳過好幾頁。IG 不是這樣 ——
     手指拖到哪就到哪，放手當下立刻決定翻或不翻，一次只翻一頁，
     220ms 直接就位，中途不再飄。所以這裡自己接指標事件、自己搬位置。 */
  /** 把軌道移到某個位置；animate=false 是跟著手指走，不能有過場 */
  const igMoveTrack = (px: number, animate: boolean) => {
    const el = igTrackRef.current;
    if (!el) return;
    /* 340ms＋前段快後段緩的曲線：220ms 那組太衝，放手幾乎是瞬移過去。
       這一條起步就有速度、越靠近定位越慢，看得出「滑過去」的過程。 */
    el.style.transition = animate ? 'transform 340ms cubic-bezier(0.32, 0.72, 0, 1)' : 'none';
    el.style.transform = `translate3d(${px}px, 0, 0)`;
  };
  // 頁數或框寬改變時（換頁、旋轉、重新量框）把軌道對回正確的位置
  useEffect(() => {
    igMoveTrack(-igPage * igBox.w, !igDragRef.current);
  }, [igPage, igBox.w, pageCount]);

  const onIgPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pageCount < 2) return;
    igDragRef.current = { x0: e.clientX, y0: e.clientY, t0: e.timeStamp, dx: 0, id: e.pointerId, lock: '' };
    /* 這裡刻意「先不」setPointerCapture ——
       一按下去就捕捉的話，瀏覽器會把這一串當成我們的手勢，
       直向的捲動就永遠不會發生。等確定是橫向再捕捉。 */
    igMoveTrack(-igPage * igBox.w, false);
  };
  const onIgPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = igDragRef.current;
    if (!d || d.id !== e.pointerId) return;
    let dx = e.clientX - d.x0;
    // 先判斷這一下是橫的還是直的，直的就整個不管（避免斜著滑時圖亂晃）
    if (!d.lock) {
      const dy = e.clientY - d.y0;
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      d.lock = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      // 確定是橫向翻頁了，這時候才把指標抓過來
      if (d.lock === 'x') { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 抓不到就算了 */ } }
    }
    if (d.lock !== 'x') return;
    // 頭尾不給拖出去（IG 第一張往右滑是完全不動的，沒有回彈）
    if (igPage === 0 && dx > 0) dx = 0;
    if (igPage === pageCount - 1 && dx < 0) dx = 0;
    d.dx = dx;
    igMoveTrack(-igPage * igBox.w + dx, false);
  };
  const onIgPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = igDragRef.current;
    if (!d || d.id !== e.pointerId) return;
    igDragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* 已經放開了 */ }
    const w = igBox.w || 1;
    const dt = Math.max(1, e.timeStamp - d.t0);
    const v = d.dx / dt;                       // px/ms，甩一下也要能翻
    let next = igPage;
    if (d.dx < -w * 0.18 || v < -0.35) next = Math.min(pageCount - 1, igPage + 1);
    else if (d.dx > w * 0.18 || v > 0.35) next = Math.max(0, igPage - 1);
    igMoveTrack(-next * w, true);              // 先動，再更新狀態，才不會等一拍
    if (next !== igPage) setIgPage(next);
  };

  /** 貼文版位的比例：頁面本身的比例 IG 支援就照它，不支援就用直式 3:4 */
  /* 框永遠等於頁面本身的比例，不再夾到 IG 的支援範圍。
     夾比例等於在預覽裡自作主張改變構圖 —— 使用者要的是「匯出長怎樣就顯示怎樣」，
     每一頁都一樣、完整、不壓縮、不裁切。真的超出 IG 支援範圍時，IG 自己會怎麼處理
     是發文當下的事，預覽不該先幫他決定。 */
  const igFrame = frame;
  /* 預覽裡的帳號與頭像：兩個都能改，存在本機，下次開還在。 */
  const [igAccount, setIgAccount] = useState(() => {
    try { return localStorage.getItem(KEY('account')) || 'abai_is.perfect'; } catch { return 'abai_is.perfect'; }
  });
  const [igAvatar, setIgAvatar] = useState(() => {
    try { return localStorage.getItem(KEY('avatar')) || ''; } catch { return ''; }
  });
  const igAvatarInputRef = useRef<HTMLInputElement>(null);
  /** 上一個「有效」的名字：清成空白再點別的地方時要還原成它 */
  const lastIgNameRef = useRef(igAccount);

  const commitIgName = (v: string) => {
    const name = v.trim().slice(0, 30) || lastIgNameRef.current || 'abai_is.perfect';
    lastIgNameRef.current = name;
    setIgAccount(name);
    try { localStorage.setItem(KEY('account'), name); } catch { /* 無痕模式寫不進去就算了 */ }
  };

  /** 上傳的頭像先置中裁成正方形、縮到 240px 再存 —— 原圖直接塞會撐爆本機空間 */
  const setIgAvatarFrom = (file: File) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const S = 240;
      const c = document.createElement('canvas');
      c.width = S; c.height = S;
      const g = c.getContext('2d');
      if (g) {
        const s = Math.min(im.naturalWidth, im.naturalHeight);
        g.drawImage(im, (im.naturalWidth - s) / 2, (im.naturalHeight - s) / 2, s, s, 0, 0, S, S);
        const data = c.toDataURL('image/png');
        setIgAvatar(data);
        try { localStorage.setItem(KEY('avatar'), data); } catch { /* 存不下就只用這一次 */ }
      }
      URL.revokeObjectURL(url);
    };
    im.onerror = () => URL.revokeObjectURL(url);
    im.src = url;
  };
  /**
   * IG 的頁點：最多只露五顆，兩邊還有頁面時最外面那兩顆會縮小。
   * 回傳 0 代表這一顆不畫。
   */
  const igDotPx = (i: number) => {
    const n = pageCount;
    if (n <= 5) return 6;
    const start = Math.min(Math.max(igPage - 2, 0), n - 5);
    const end = start + 5;
    if (i < start || i >= end) return 0;
    if (start > 0 && i === start) return 4;
    if (start > 0 && i === start + 1) return 5;
    if (end < n && i === end - 1) return 4;
    if (end < n && i === end - 2) return 5;
    return 6;
  };
  /* ── 下面那幾個數字與愛心／儲存 ────────────────────────────────
     IG 的貼文下面本來就是可以互動的，預覽也要能改：四個數字點下去直接打字，
     愛心與書籤點一下就切換（愛心亮著時讚數 +1，跟 IG 一樣）。
     全部存在本機，下次開還在。 */
  const readStat = (k: string, dflt: string) => {
    try { return localStorage.getItem(KEY(k)) ?? dflt; } catch { return dflt; }
  };
  const [igLikes, setIgLikes] = useState(() => readStat('likes', '5,850'));
  const [igComments, setIgComments] = useState(() => readStat('comments', '6'));
  const [igReposts, setIgReposts] = useState(() => readStat('reposts', '20'));
  const [igShares, setIgShares] = useState(() => readStat('shares', '342'));
  const [igCaption, setIgCaption] = useState(() => readStat('caption', '和其他人都說讚'));
  const [igLiked, setIgLiked] = useState(() => readStat('liked', '0') === '1');
  const [igSaved, setIgSaved] = useState(() => readStat('saved', '0') === '1');
  const saveStat = (k: string, v: string) => {
    try { localStorage.setItem(KEY(k), v); } catch { /* 無痕模式寫不進去就算了 */ }
  };
  /** 讚數加一：只認數字，逗號原樣留著（5,850 → 5,851） */
  const bumpLikes = (n: number) => setIgLikes(prev => {
    const digits = prev.replace(/[^\d]/g, '');
    if (!digits) return prev;
    const next = Math.max(0, parseInt(digits, 10) + n);
    const out = prev.includes(',') ? next.toLocaleString('en-US') : String(next);
    saveStat('likes', out);
    return out;
  });
  /** 下面那幾個數字共用的樣式：看起來就是一般文字，點下去才知道能改 */
  const statInput = (
    value: string, onChange: (v: string) => void, commit: (v: string) => void, w: string, title: string,
  ) => (
    <input
      value={value}
      title={title}
      maxLength={12}
      onChange={e => onChange(e.target.value.slice(0, 12))}
      onBlur={e => commit(e.currentTarget.value)}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
      enterKeyHint="done"
      inputMode="numeric"
      className="text-[14px] font-semibold tabular-nums text-white bg-transparent"
      style={{ width: w, border: 0, outline: 'none', boxShadow: 'none', padding: 0, margin: 0 }}
    />
  );

  /** 聲音鍵：只有預覽裡「目前這一頁」的影片會出聲，其他一律靜音 */
  const [igMuted, setIgMuted] = useState(true);
  useEffect(() => {
    document.querySelectorAll('video').forEach(v => { v.muted = true; });
    if (igMuted) return;
    const slide = igTrackRef.current?.children[igPage] as HTMLElement | undefined;
    slide?.querySelectorAll('video').forEach(v => { v.muted = false; v.play().catch(() => { }); });
  }, [igPage, igMuted, pageCount]);

  return (
        <div
          className={embedded
            ? 'relative w-full h-full bg-black flex flex-col'
            : 'fixed inset-0 z-[120] bg-black flex flex-col animate-in fade-in duration-200'}
          style={{
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Noto Sans TC", "PingFang TC", sans-serif',
            /* inset-0 用的是「版面視窗」，但 iOS Safari 的底部工具列是蓋在網頁上面、
               不佔版面高度，所以畫面最下面那一段會躲在工具列後面 —— 圖的下緣看起來
               就是被切掉。100dvh 是會扣掉瀏覽器 UI 的動態視窗高度，再加安全區內距，
               內容就一定落在看得見的範圍裡。 */
            height: embedded ? '100%' : '100dvh',
            maxHeight: embedded ? '100%' : '100dvh',
            /* 底部一定要留白。加到主畫面的 PWA 在全螢幕下，畫面最下緣是 iPhone 的
               主畫面指示條（那條小橫線）所在的位置，內容擺到那裡就會被壓住。
               env() 只有在 viewport-fit=cover 時才會回報真實數值，所以再給一個
               24px 的保底，兩者取大的。 */
            paddingBottom: embedded ? 0 : 'max(env(safe-area-inset-bottom, 0px), 24px)',
            boxSizing: 'border-box',
          }}
        >
          {/* 整篇貼文置中，不再用 vh 硬算要墊多高 ——
              手機瀏覽器的 vh 含網址列高度，真機上算出來會偏，貼文被推下去、
              圖的下緣就被下面那排愛心／留言蓋住。
              置中用「第一個小孩 margin-top:auto、最後一個 margin-bottom:auto」，
              而不是 justify-center：內容比容器高的時候 justify-center 會把上下
              都切掉而且捲不到，auto margin 則會自動退讓、完整可捲。 */}
          <div
            className="flex-1 min-h-0 overflow-hidden flex flex-col"
            style={{
              /* overflow:hidden 的元素在瀏覽器眼中仍然是一個捲動容器，
                 配上 overscroll-behavior:contain 就會「把手勢吃掉」——
                 內嵌成兩篇時，手指落在貼文上往上滑就傳不到外面那層捲動容器，
                 那正是「有時候滑不動」的原因。內嵌時交還給外層。 */
              overscrollBehavior: embedded ? 'auto' : 'contain',
              /* 整篇貼文往下挪：內容原本從最上面開始排，下面會空一大塊。
                 補 padding-top 讓整組（帳號列＋圖＋愛心那幾列）一起往下，
                 圖就落在畫面中心略偏上 —— 同步移動，不是只動圖片。 */
              paddingTop: '58px',
            }}
          >
            {/* 帳號那一列：限動漸層圈的頭像、粗體帳號，第二行是音訊 */}
            <div className="h-[52px] flex items-center gap-[9px] pl-[10px] pr-1">
              {/* 點頭像換頭貼：置中裁成正方形存在本機；沒換過就沿用拼圖裡的第一張照片 */}
              <button
                onClick={() => igAvatarInputRef.current?.click()}
                className="relative w-[38px] h-[38px] rounded-full shrink-0 p-[2px] active:opacity-70"
                style={{ background: 'conic-gradient(from 200deg, #f9ce34, #ee2a7b, #6228d7, #ee2a7b, #f9ce34)' }}
                title="更換頭貼"
              >
                <div className="w-full h-full rounded-full overflow-hidden bg-[#262626] border-2 border-black">
                  {(igAvatar || faces[0]) && (
                    <img src={igAvatar || faces[0]} alt="" draggable={false} className="w-full h-full object-cover" />
                  )}
                </div>
              </button>
              <input
                ref={igAvatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) setIgAvatarFrom(f);
                  e.target.value = '';       // 選同一張也要能再觸發
                }}
              />
              <div className="flex-1 min-w-0">
                {/* 帳號名字：一直都是同一個 input，點下去就能改、Enter 或點別的地方存檔。
                    以前是「平常顯示 <button>、點了才換成 <input>」—— 兩種元素的行高與
                    內距差那麼一點點，換過去的瞬間名字與底下的音訊列就會抖一下。
                    永遠是同一個元素就不會有那一下。高度也寫死，字數變動不會撐開。 */}
                <input
                  value={igAccount}
                  title="修改帳號名稱"
                  maxLength={30}
                  onChange={e => setIgAccount(e.target.value.slice(0, 30))}
                  onBlur={e => commitIgName(e.currentTarget.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                  enterKeyHint="done"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  className="block w-full text-[14px] font-semibold text-white"
                  style={{
                    border: 0, outline: 'none', boxShadow: 'none',
                    padding: 0, margin: 0, background: 'transparent',
                    height: '19px', lineHeight: '19px',
                    WebkitAppearance: 'none', appearance: 'none',
                  }}
                />
                {/* 點這一行選音樂；選過之後整行換成「歌名 · 歌手」 */}
                <button
                  onClick={() => setMusicOpen(true)}
                  className="text-[13px] text-white leading-[17px] truncate block w-full text-left active:opacity-60"
                >
                  <span className="text-[12px] mr-[3px]">♫</span>
                  {picked ? `${picked.name} · ${picked.artist}` : `原創音訊 · ${igAccount}`}
                </button>
              </div>
              {/* IG 現在的版本右上角是兩條橫線；這裡順便當關閉鍵。
                  內嵌時每一篇都畫一顆會很吵，交給外面那層畫一顆就好。 */}
              {!embedded && (
                <button
                  onClick={() => onClose()}
                  className="w-10 h-10 shrink-0 flex items-center justify-center text-white active:opacity-60"
                  title="關閉"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                    <path d="M5 9.5h14M5 15h14" />
                  </svg>
                </button>
              )}
            </div>

            {/* 貼文的圖：一頁一屏，左右滑 */}
            <div className="relative w-full bg-black select-none">
              {/*
                翻頁不用瀏覽器的捲動＋scroll-snap —— 那個放開手之後還會自己滑一段
                再吸過去，就是那股「緩衝感」。IG 是手指拖到哪就到哪，放手立刻決定
                翻不翻，220ms 直接就位，中途不會再飄。
                所以這裡自己接指標事件、自己算位移，容器本身完全不捲動。
              */}
              <div
                ref={igStripRef}
                className="flex-1 min-h-0 w-full overflow-hidden"
                /* pan-y：橫的交給我們自己接（翻頁），直的還給瀏覽器（外層上下捲）。
                   以前寫 none 等於連直的也一起擋掉 —— 手指落在圖片上時
                   整頁就滑不動了，那正是「有時候滑不到下一篇」的原因。
                   單頁貼文根本不需要接手勢，直接 auto。 */
                style={{ touchAction: pageCount > 1 ? 'pan-y' : 'auto' }}
                onPointerDown={onIgPointerDown}
                onPointerMove={onIgPointerMove}
                onPointerUp={onIgPointerUp}
                onPointerCancel={onIgPointerUp}
              >
                {/* flex-1 + min-h-0（在外層）：圖片區「拿剩下的空間」，不用 aspect-ratio
                    撐固定高度 —— 那樣直式頁面算出來會超過畫面，多的部分被裁掉。 */}
                <div ref={igTrackRef} className="h-full flex will-change-transform">
                  {Array.from({ length: pageCount }).map((_, idx) => (
                    <div
                      key={`ig-${idx}`}
                      // 寬度用整數的 px（不是 100%）：小數寬度會讓隔壁那一頁露出一條白線
                      className="h-full shrink-0 flex items-center justify-center bg-black overflow-hidden"
                      style={{ width: `${igBox.w}px` }}
                    >
                      {/* 直接顯示匯出的那一張。object-contain 保證完整顯示、絕不裁切 */}
                      {video
                        ? <video src={video} autoPlay loop playsInline muted={igMuted}
                            className="max-w-full max-h-full object-contain" />
                        : shots[idx]
                        ? <img src={shots[idx]} alt="" draggable={false} className="max-w-full max-h-full object-contain" />
                        : (
                          /* 還在算圖：給一個轉圈，不要放空白的頁面 —— 整片白會讓人以為壞掉 */
                          <div className="w-full h-full flex items-center justify-center">
                            <div className="w-7 h-7 rounded-full border-2 border-white/25 border-t-white animate-spin" />
                          </div>
                        )}
                    </div>
                  ))}
                </div>
              </div>
              {/* 多圖貼文右上角的頁碼膠囊：上緣與右緣留一樣的空隙 */}
              {pageCount > 1 && (
                <div className="absolute top-[18px] right-[14px] h-[26px] px-[10px] rounded-full bg-black/60 flex items-center pointer-events-none">
                  <span className="text-white text-[12px] font-medium leading-none tabular-nums">
                    {igPage + 1}/{pageCount}
                  </span>
                </div>
              )}
              {/* 這一頁有影片才有聲音鍵，位置跟 IG 一樣在右下角 */}
              {hasVideo(igPage) && (
                <button
                  onClick={() => setIgMuted(m => !m)}
                  className="absolute bottom-3 right-3 w-9 h-9 rounded-full bg-black/50 flex items-center justify-center text-white active:scale-95 transition-transform"
                  title={igMuted ? '開啟聲音' : '關閉聲音'}
                >
                  {igMuted ? <VolumeX size={17} strokeWidth={1.9} /> : <Volume2 size={17} strokeWidth={1.9} />}
                </button>
              )}
            </div>

            {/* 頁點：IG 最多只露五顆，兩邊還有頁面時最外面那兩顆會縮小 */}
            {pageCount > 1 && (
              <div className="flex items-center justify-center gap-[5px] pt-[13px] pb-[2px]">
                {Array.from({ length: pageCount }).map((_, i) => {
                  const s = igDotPx(i);
                  if (!s) return null;
                  return (
                    <span
                      key={`dot-${i}`}
                      className="rounded-full transition-all duration-200"
                      style={{ width: `${s}px`, height: `${s}px`, backgroundColor: i === igPage ? '#3897f0' : 'rgba(255,255,255,0.35)' }}
                    />
                  );
                })}
              </div>
            )}

            {/* 按讚那一排：四個圖示同尺寸、留言的尾巴在右邊、轉發與分享照 IG 的畫法 */}
            <div className="h-[44px] flex items-center px-3 text-white">
              <div className="flex items-center gap-[13px]">
                <span className="flex items-center gap-[5px]">
                  <button
                    onClick={() => { const n = !igLiked; setIgLiked(n); saveStat('liked', n ? '1' : '0'); bumpLikes(n ? 1 : -1); }}
                    title={igLiked ? '收回讚' : '按讚'}
                    className="active:scale-90 transition-transform"
                    style={{ lineHeight: 0 }}
                  >
                    <Heart data-ig="heart" size={24} strokeWidth={1.8}
                      fill={igLiked ? '#ff3040' : 'none'}
                      color={igLiked ? '#ff3040' : 'currentColor'} />
                  </button>
                  {statInput(igLikes, setIgLikes, v => { setIgLikes(v); saveStat('likes', v); }, `${Math.max(2, igLikes.length)}ch`, '改讚數')}
                </span>
                <span className="flex items-center gap-[5px]">
                  {/* 依愛心的頭腳對齊；留言那顆照要求再小非常一點點 */}
                  <MessageCircle data-ig="comment" size={24} strokeWidth={1.8} style={{ transform: 'scaleX(-1) translateY(0.45px) scale(0.83)' }} />
                  {statInput(igComments, setIgComments, v => { setIgComments(v); saveStat('comments', v); }, `${Math.max(1, igComments.length)}ch`, '改留言數')}
                </span>
                <span className="flex items-center gap-[5px]">
                  {/* IG 的轉發：兩支對向的循環箭頭（拉高，不能扁扁的） */}
                  <svg data-ig="repost" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'translateY(0.48px) scale(0.944)' }}>
                    <path d="M14.6 3 18 6.4l-3.4 3.4" />
                    <path d="M18 6.4H8.6A4.6 4.6 0 0 0 4 11v2.6" />
                    <path d="M9.4 21 6 17.6l3.4-3.4" />
                    <path d="M6 17.6h9.4a4.6 4.6 0 0 0 4.6-4.6V10.4" />
                  </svg>
                  {statInput(igReposts, setIgReposts, v => { setIgReposts(v); saveStat('reposts', v); }, `${Math.max(1, igReposts.length)}ch`, '改轉發數')}
                </span>
                <span className="flex items-center gap-[5px]">
                  {/* IG 的分享：斜著飛的紙飛機，三個角都帶一點圓角 */}
                  <svg data-ig="share" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'translateY(0.82px) scale(0.966)' }}>
                    <path d="M20.5 3.5 9.9 13.5" />
                    <path d="M20.29 2.98 Q21.5 2.5 21.01 3.7 L14.39 19.8 Q13.9 21 13.29 19.85 L9.9 13.5 4.15 10.41 Q3 9.8 4.21 9.32 Z" />
                  </svg>
                  {statInput(igShares, setIgShares, v => { setIgShares(v); saveStat('shares', v); }, `${Math.max(1, igShares.length)}ch`, '改分享數')}
                </span>
              </div>
              <button
                onClick={() => { const n = !igSaved; setIgSaved(n); saveStat('saved', n ? '1' : '0'); }}
                title={igSaved ? '取消儲存' : '儲存'}
                className="ml-auto active:scale-90 transition-transform"
                style={{ lineHeight: 0 }}
              >
                <Bookmark data-ig="bookmark" size={24} strokeWidth={1.8}
                  fill={igSaved ? '#ffffff' : 'none'}
                  style={{ transform: 'translateY(0.48px) scale(0.944)' }} />
              </button>
            </div>

            {/* 說讚的人：三顆疊在一起的小頭像＋一行字 */}
            <div className="flex items-center gap-[8px] px-3">
              <span className="flex shrink-0">
                {faces.map((src, i) => (
                  <span
                    key={`face-${i}`}
                    className="block w-[22px] h-[22px] rounded-full border-2 border-black overflow-hidden bg-[#2f2f2f]"
                    style={{ marginLeft: i ? '-9px' : 0, zIndex: 3 - i }}
                  >
                    {src && <img src={src} alt="" draggable={false} className="w-full h-full object-cover" />}
                  </span>
                ))}
              </span>
              <p className="text-[14px] text-white leading-[18px] truncate flex items-baseline min-w-0">
                <span className="font-semibold shrink-0">{igAccount}</span>
                <input
                  value={igCaption}
                  title="改這一行字"
                  maxLength={60}
                  onChange={e => setIgCaption(e.target.value.slice(0, 60))}
                  onBlur={e => { const v = e.currentTarget.value; setIgCaption(v); saveStat('caption', v); }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                  enterKeyHint="done"
                  className="flex-1 min-w-0 text-[14px] text-white bg-transparent"
                  style={{ border: 0, outline: 'none', boxShadow: 'none', padding: 0, margin: 0, lineHeight: '18px' }}
                />
              </p>
            </div>
          </div>

          {/* ── 選音樂的底部面板 ───────────────────────────────────────
              從下往上滑進來、往下滑出去。用 translate-y + transition，
              關閉時先播完動畫再卸載（closeMusic 裡的 setTimeout）。 */}
          {musicOpen && (
            <>
              <div
                onClick={closeMusic}
                className={`absolute inset-0 z-[130] bg-black/50 transition-opacity duration-300 ${musicShown ? 'opacity-100' : 'opacity-0'}`}
              />
              <div
                className={`absolute left-0 right-0 z-[131] bg-[#161616] rounded-t-2xl flex flex-col transition-transform duration-300 ease-out ${musicShown ? 'translate-y-0' : 'translate-y-full'}`}
                style={{
                  /* 高度固定，鍵盤跳出來也不縮 —— 縮的話等於把鍵盤後面那段
                     介面裁掉。鍵盤只是蓋在上面，底下的東西照樣在。 */
                  bottom: 0,
                  height: '93%',
                  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                }}
              >
                {/* 上緣的小握把 */}
                <div className="shrink-0 pt-2 pb-1 flex justify-center">
                  <div className="w-9 h-1 rounded-full bg-white/30" />
                </div>

                {/* 搜尋列 */}
                <div className="shrink-0 px-4 pt-2 pb-3">
                  <div className="h-11 rounded-full bg-[#2a2a2a] flex items-center gap-2 px-4">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="2.2" strokeLinecap="round">
                      <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.2-3.2" />
                    </svg>
                    {/* 這個專案有裝 @tailwindcss/forms，它會給所有 input 一圈
                        1px 的框和內距，聚焦時還會多一圈 ring —— 就是搜尋欄外面
                        那個細方框。用行內樣式蓋掉，優先權最高，一次清乾淨。
                        enterKeyHint 讓手機鍵盤右下角直接是「搜尋」，按下去立刻查、
                        收鍵盤，不用等 350ms 的防抖。 */}
                    <input
                      value={musicQuery}
                      onChange={e => setMusicQuery(e.target.value)}
                      placeholder="搜尋......"
                      type="text"
                      inputMode="search"
                      enterKeyHint="search"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      onKeyDown={e => {
                        if (e.key !== 'Enter') return;
                        e.preventDefault();
                        (e.currentTarget as HTMLInputElement).blur();
                        loadMusic(currentSource());
                      }}
                      className="flex-1 min-w-0 text-[15px] text-white placeholder-white/45"
                      style={{
                        border: 0, outline: 'none', boxShadow: 'none',
                        padding: 0, background: 'transparent',
                        WebkitAppearance: 'none', appearance: 'none',
                      }}
                    />
                    {!!musicQuery && (
                      <button onClick={() => setMusicQuery('')} className="text-white/45 text-[15px] px-1">✕</button>
                    )}
                  </div>
                </div>

                {/* 鑽進歌手／專輯時，膠囊那一排換成「← 返回 ＋ 現在在看誰」 */}
                {(artistView || albumView) ? (
                  <div className="shrink-0 flex items-center gap-2 px-4 pb-3">
                    <button
                      onClick={drillBack}
                      className="shrink-0 w-9 h-9 rounded-full bg-[#2a2a2a] flex items-center justify-center active:opacity-60"
                      aria-label="返回"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M15 5l-7 7 7 7" />
                      </svg>
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-semibold text-white truncate">
                        {albumView ? albumView.name : artistView!.name}
                      </p>
                      {albumView && artistView && (
                        <p className="text-[12px] text-white/45 truncate">{artistView.name}</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="shrink-0 flex gap-2 px-4 pb-3 overflow-x-auto no-scrollbar">
                    {MUSIC_TABS.map(t => (
                      <button
                        key={t}
                        onClick={() => { setMusicTab(t); setMusicQuery(''); }}
                        className={`shrink-0 h-9 px-4 rounded-full text-[14px] font-semibold transition-colors ${
                          musicTab === t ? 'bg-white text-black' : 'bg-[#2a2a2a] text-white'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}

                {/* 歌曲清單 */}
                <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-4 pb-4">
                  {(musicLoading || drillLoading) && (
                    <div className="py-10 flex justify-center">
                      <div className="w-6 h-6 rounded-full border-2 border-white/25 border-t-white animate-spin" />
                    </div>
                  )}

                  {/* 搜尋結果最上面：同名的歌手。點進去可以挑專輯、挑單曲 */}
                  {!artistView && !musicLoading && !!musicQuery.trim() && musicArtists.length > 0 && (
                    <>
                      <p className="pt-1 pb-2 text-[12px] font-semibold text-white/40">歌手</p>
                      <div className="flex gap-3 overflow-x-auto no-scrollbar pb-3 -mx-1 px-1">
                        {musicArtists.map(a => (
                          <button
                            key={a.id}
                            onClick={() => openArtist(a)}
                            className="shrink-0 w-[72px] flex flex-col items-center gap-1.5 active:opacity-60"
                          >
                            {/* 大頭照就是 Apple Music 歌手頁上的那一張（og:image）。
                                還沒抓到、或那位真的沒有照片，才顯示名字的第一個字。 */}
                            <span className="relative w-[62px] h-[62px] rounded-full bg-[#2a2a2a] overflow-hidden flex items-center justify-center text-[22px] font-bold text-white/70">
                              {a.name.trim().slice(0, 1).toUpperCase()}
                              {!!a.art && (
                                <img
                                  src={a.art} alt="" loading="lazy"
                                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                                  className="absolute inset-0 w-full h-full object-cover"
                                />
                              )}
                            </span>
                            <span className="w-full text-[11px] text-white/85 leading-[14px] text-center line-clamp-2">{a.name}</span>
                          </button>
                        ))}
                      </div>
                      <p className="pt-1 pb-2 text-[12px] font-semibold text-white/40">歌曲</p>
                    </>
                  )}

                  {/* 歌手頁：先列專輯（點進去看那張的曲目），下面才是全部歌曲 */}
                  {artistView && !albumView && !drillLoading && artistAlbums.length > 0 && (
                    <>
                      <p className="pt-1 pb-2 text-[12px] font-semibold text-white/40">專輯 · {artistAlbums.length}</p>
                      <div className="flex gap-3 overflow-x-auto no-scrollbar pb-3 -mx-1 px-1">
                        {artistAlbums.map(al => (
                          <button
                            key={al.id}
                            onClick={() => openAlbum(al)}
                            className="shrink-0 w-[104px] text-left active:opacity-60"
                          >
                            <img
                              src={al.art || TRANSPARENT_PX} alt="" loading="lazy"
                              onError={e => { (e.currentTarget as HTMLImageElement).src = TRANSPARENT_PX; }}
                              className="w-[104px] h-[104px] rounded-[6px] bg-white/10 object-cover"
                            />
                            <p className="mt-1.5 text-[12px] text-white leading-[15px] line-clamp-2">{al.name}</p>
                            <p className="text-[11px] text-white/40 leading-[14px]">
                              {al.year}{al.count > 0 && ` · ${al.count} 首`}
                            </p>
                          </button>
                        ))}
                      </div>
                      <p className="pt-1 pb-2 text-[12px] font-semibold text-white/40">全部歌曲 · {drillTracks.length}</p>
                    </>
                  )}

                  {!musicLoading && !drillLoading &&
                   ((artistView || albumView) ? drillTracks.length === 0 : musicList.length === 0) && (
                    <div className="py-10 flex flex-col items-center gap-3">
                      <p className="text-center text-[13px] text-white/40 px-6 whitespace-pre-line leading-relaxed">
                        {(artistView || albumView) ? '找不到歌曲' : (musicError || '找不到歌曲')}
                      </p>
                      {musicTab !== '已儲存' && !artistView && !albumView && (
                        <button
                          onClick={() => loadMusic(currentSource())}
                          className="h-9 px-5 rounded-full bg-[#2a2a2a] text-[14px] font-semibold text-white active:opacity-60"
                        >
                          重試
                        </button>
                      )}
                    </div>
                  )}
                  {/* 一列本身能點（選這首），右邊的書籤是獨立的按鈕（收藏／取消收藏）。
                      所以外層不能是 <button> —— button 裡面不能再包 button。 */}
                  {/* 讀取中不要留著上一批 —— 轉圈底下還墊著舊分類的歌，
                      來回切分頁就會看成「一直出現重複的歌」。
                      key 再補一個序號：不同商店的同一首歌 id 可能撞在一起。 */}
                  {/* 鑽進歌手／專輯時換成那一份曲目，其餘照舊放搜尋／榜單的結果 */}
                  {!((artistView || albumView) ? drillLoading : musicLoading) &&
                   ((artistView || albumView) ? drillTracks : musicList).map((t, ti) => (
                    <div key={`${t.id}#${ti}`} className="w-full flex items-center py-2.5">
                      {/* 按下去的變暗只掛在這一塊，不掛在整列 ——
                          掛在整列的話，按右邊的書籤會連帶讓整列閃一下。 */}
                      <div
                        role="button"
                        onClick={() => pickTrack(t)}
                        className="flex-1 min-w-0 flex items-center gap-3 text-left active:opacity-60"
                      >
                        {/* 封面載不到就換成全透明的 1×1，只留底色 ——
                            直接放著不管的話會出現瀏覽器的破圖圖示和一圈框。
                            正在試聽的那一首：封面上壓一層會跳動的音量條。 */}
                        <div className="relative w-14 h-14 shrink-0">
                          <img
                            src={t.art || TRANSPARENT_PX} alt="" loading="lazy"
                            onError={e => { (e.currentTarget as HTMLImageElement).src = TRANSPARENT_PX; }}
                            className="w-14 h-14 rounded-[6px] bg-white/10 object-cover"
                          />
                          {/* 這一首還沒配到試聽網址，按下去當場去查 —— 查的時候轉個圈 */}
                          {resolvingId === t.id && (
                            <div className="absolute inset-0 rounded-[6px] bg-black/45 flex items-center justify-center">
                              <div className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                            </div>
                          )}
                          {resolvingId !== t.id && picked?.id === t.id && musicPlaying && (
                            <div className="absolute inset-0 rounded-[6px] bg-black/45 flex items-end justify-center gap-[3px] pb-[18px]">
                              {[0, 1, 2, 3].map(i => (
                                <span
                                  key={i}
                                  className="w-[3px] rounded-full bg-white"
                                  style={{
                                    height: '18px',
                                    transformOrigin: 'bottom',
                                    animation: `abaiEq 900ms ease-in-out ${i * 130}ms infinite`,
                                  }}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-[16px] leading-[21px] truncate text-white ${picked?.id === t.id ? 'font-semibold' : ''}`}>{t.name}</p>
                          <p className="text-[14px] leading-[19px] text-white/50 truncate">
                            {t.artist}{t.secs > 0 && ` · ${Math.floor(t.secs / 60)}:${String(t.secs % 60).padStart(2, '0')}`}
                          </p>
                        </div>
                      </div>
                      {/* 收藏書籤：收藏過的填滿，「已儲存」那一頁讀的就是這一份 */}
                      <button
                        onClick={e => { e.stopPropagation(); toggleSave(t); }}
                        aria-label="收藏"
                        className="w-9 h-9 ml-1 shrink-0 flex items-center justify-center active:opacity-60"
                      >
                        <svg width="22" height="22" viewBox="0 0 24 24"
                             fill={savedTracks.some(x => x.id === t.id) ? '#fff' : 'none'}
                             stroke="#fff" strokeWidth="1.8" strokeLinejoin="round">
                          <path d="M6 3h12a1 1 0 011 1v17l-7-4-7 4V4a1 1 0 011-1z" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
  );

};
