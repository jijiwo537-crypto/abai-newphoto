/* order.html：排「圖案」與「圖形」順序的小工具。
   長按一顆約 0.3 秒 → 它會浮起來 → 拖到想要的位置放開。
   排好之後按「複製順序」，把文字貼給 Claude，就會照這個順序改進 App。
   圖示用的是 App 裡同一套畫法（PatternIcon／ShapeGlyph／HoleGlyph），看到的就是選單上的樣子。 */
import './styles.css';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { PatternIcon } from './components/PatternIcon';
import { ShapeGlyph, HoleGlyph, shapePickerSections, shapeSupportsStretch, shapeTexAvailable, NO_TEXTURE_SHAPE_IDS } from './components/GridLayoutTool';
import { PATTERN_ORDER, SHAPE_SECTIONS, type ShapeSection } from './utils/pickerOrder';
import { patternDefaultSize } from './utils/patternDefaults';
import { CollageTool } from './components/CollageTool';
import { StarBurstLab, loadCustomBursts, loadDeletedBursts } from './components/StarBurstLab';
import { STAR_BURSTS } from './utils/starBursts';
import { FrameLab, LAB_FRAMES, STORE_FRAME_PICK, STORE_FRAME_RANGE, loadFramePicks, loadFrameRanges } from './components/FrameLab';
import { frameRangeDefault } from './utils/frameShapes';

/** 新做好、還沒排過位置的項目 —— 格子右上角會有一個小點 */
const NEW_IDS = new Set<string>(['star-rounded', 'p-star-double', 'p-blur-star-rounded', 'p-blur-cross-star', 'p-blur-sparkle4', 'p-blur-heart', 'music-eighth', 'music-beamed', 'music-sixteenth', 'music-clef', 'question', 'burst-dash', 'spinner', 'hole-question', 'burst-dash-f', 'spinner-f', 'hole-music-eighth', 'hole-music-beamed', 'hole-music-sixteenth', 'hole-music-clef', 'hole-q-mark', 'hole-anger-mark', 'hole-excl-mark', 'q-mark', 'excl-mark', 'anger-mark', 'p-star-o', 'p-sparkle4-o', 'track-select-o', 'track-select8-o', 'track-cross-o']);
const STORE = 'abai-order-tool-v1';
/** 「這個圖形也想當圖案用」的清單（圖形的 id）。存在這台裝置上，複製順序時一起帶出去 */
const STORE_ADD = 'abai-order-tool-shape-as-pattern-v1';
const ADD_PREFIX = 'shape:';
const allShapeItems = () => shapePickerSections().flatMap(([, items]) => items as any[]);
const asPatternItem = (shape: any) => ({ id: ADD_PREFIX + shape.id, fromShape: shape });
/** 已經正式變成圖案的圖形（之前用「加到圖案」選過的，就不要再重複出現一次） */
const patternIdOfShape = (shapeId: string) => {
  const kind = shapeId.replace(/-f$/, '');
  // 借來的圖案（hole-xxx）在圖案裡就叫 xxx；邊框圖形（xxx-o）叫 p-xxx-o
  return kind === 'star-rounded' ? 'star-rounded' : kind.startsWith('hole-') ? kind.slice(5) : 'p-' + kind;
};
const ALREADY_PATTERN = (shapeId: string) => PATTERN_ORDER.includes(patternIdOfShape(shapeId));
const loadAdded = (): string[] => { try { const v = JSON.parse(localStorage.getItem(STORE_ADD) || '[]'); return Array.isArray(v) ? v.filter((id: string) => !ALREADY_PATTERN(id)) : []; } catch { return []; } };
const HOLD_MS = 280;
/** 「這些圖形想改成可以變形（四邊擠壓）」的清單（圖形的 id），一樣存在這台裝置上 */
const STORE_STRETCH = 'abai-order-tool-stretch-v1';
/** App 目前就已經可以變形的圖形 */
const CAN_STRETCH = (it: any) => shapeSupportsStretch(it.kind, it.filled, it.hole);
/** 「這些圖形想刪掉」的清單（圖形的 id），一樣存在這台裝置上 */
const STORE_DELETE = 'abai-order-tool-delete-v1';
const loadDelete = (): string[] => { try { const v = JSON.parse(localStorage.getItem(STORE_DELETE) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
/** 「圖案大小」頁試調的起始大小（圖案 id → 0～100），一樣存在這台裝置上 */
const STORE_SIZE = 'abai-order-tool-pattern-size-v1';
const loadSizes = (): Record<string, number> => {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_SIZE) || '{}');
    if (!v || typeof v !== 'object') return {};
    return Object.fromEntries(Object.entries(v).filter(([id, n]) => PATTERN_ORDER.includes(id) && typeof n === 'number' && n !== patternDefaultSize(id))) as Record<string, number>;
  } catch { return {}; }
};
/** 沒導入圖片時預覽用的示範照片（漸層＋幾塊色塊，看得出圖案挖在照片上的樣子） */
const sampleFile = (): Promise<File> => new Promise(resolve => {
  const c = document.createElement('canvas'); c.width = 1200; c.height = 1600;
  const g = c.getContext('2d')!;
  const lg = g.createLinearGradient(0, 0, 1200, 1600);
  lg.addColorStop(0, '#f4a6a0'); lg.addColorStop(0.5, '#f7d9a8'); lg.addColorStop(1, '#8fb9d8');
  g.fillStyle = lg; g.fillRect(0, 0, 1200, 1600);
  for (const [x, y, r, col] of [[300, 420, 260, '#ffffff55'], [880, 980, 340, '#3a5f8a66'], [420, 1250, 200, '#e8735a66']] as const) {
    g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  c.toBlob(b => resolve(new File([b!], 'sample.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.9);
});
/** 「星芒」頁勾選想加進 App 的那幾種 */
const STORE_BURST = 'abai-order-tool-starburst-v1';
const loadBursts = (): string[] => { try { const v = JSON.parse(localStorage.getItem(STORE_BURST) || '[]'); return Array.isArray(v) ? v.filter((id: string) => STAR_BURSTS.some(b => b.id === id) || loadCustomBursts().some(c => c.id === id)) : []; } catch { return []; } };
/** 「紋理」：跟 App 現在不一樣的那些圖形（本來有紋理 → 想拿掉；App 已經拿掉 → 想恢復），一樣存在這台裝置上 */
const STORE_TEX = 'abai-order-tool-texture-v1';
/** App 現在面板上有沒有「紋理」那一格 */
const TEX_IN_APP = (it: any) => shapeTexAvailable(it.kind, it.filled, it.hole) && !NO_TEXTURE_SHAPE_IDS.includes(it.id);
/** 這個圖形有沒有可能有紋理（App 拿掉的也算，才能選擇恢復） */
const TEX_POSSIBLE = (it: any) => shapeTexAvailable(it.kind, it.filled, it.hole);
const loadTex = (): string[] => { try { const v = JSON.parse(localStorage.getItem(STORE_TEX) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const loadStretch = (): string[] => { try { const v = JSON.parse(localStorage.getItem(STORE_STRETCH) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };

type Group = { key: string; label: string; cols: number; items: any[] };

const defaultGroups = (): Group[] => {
  const sections = shapePickerSections();
  return [
    { key: 'pattern', label: '圖案（創意拼圖）', cols: 5, items: PATTERN_ORDER.map(id => ({ id, pattern: true })) },
    ...SHAPE_SECTIONS.map(([key], i) => ({ key, label: `圖形・${sections[i][0]}`, cols: 6, items: [...sections[i][1]] })),
  ];
};

const load = (base0: Group[]): Group[] => {
  // 先把「加到圖案」的那些圖形接在圖案那一區的最後面，再照存下來的順序排
  const shapes = new Map(allShapeItems().map(it => [it.id, it]));
  const added = loadAdded().filter(id => shapes.has(id));
  const base = base0.map(g => g.key !== 'pattern' ? g : { ...g, items: [...g.items, ...added.map(id => asPatternItem(shapes.get(id)))] });
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null') as Record<string, string[]> | null;
    if (!saved) return base;
    return base.map(g => {
      const order = saved[g.key]; if (!order) return g;
      // 存下來的「shape:圖形」如果已經正式變成圖案，就當成那個圖案的位置
      const rank = new Map(order.map((id, i) => [id.startsWith(ADD_PREFIX) && ALREADY_PATTERN(id.slice(ADD_PREFIX.length)) ? patternIdOfShape(id.slice(ADD_PREFIX.length)) : id, i]));
      return { ...g, items: [...g.items].sort((a, b) => (rank.get(a.id) ?? 1e6 + g.items.indexOf(a)) - (rank.get(b.id) ?? 1e6 + g.items.indexOf(b))) };
    });
  } catch { return base; }
};

const Icon = ({ it }: { it: any }): React.ReactElement => it.fromShape ? <Icon it={it.fromShape} /> : it.pattern ? <PatternIcon s={it.id} />
  : it.hole ? <HoleGlyph s={it.hole} filled={it.filled} /> : <ShapeGlyph item={it} />;

type Drag = { group: string; id: string; pointerId: number; dx: number; dy: number; x: number; y: number; w: number; h: number };

function OrderTool() {
  const base = useMemo(defaultGroups, []);
  const [groups, setGroups] = useState<Group[]>(() => load(base));
  const [tab, setTab] = useState<'pattern' | 'shape' | 'size' | 'burst' | 'frame'>('pattern');
  /** 「邊框」頁：勾選想加進 App 的、以及試調過的範圍 */
  const [framePicks, setFramePicks] = useState<string[]>(loadFramePicks);
  const [frameRanges, setFrameRanges] = useState<Record<string, number>>(loadFrameRanges);
  useEffect(() => { try { localStorage.setItem(STORE_FRAME_PICK, JSON.stringify(framePicks)); } catch {} }, [framePicks]);
  useEffect(() => { try { localStorage.setItem(STORE_FRAME_RANGE, JSON.stringify(frameRanges)); } catch {} }, [frameRanges]);
  const [bursts, setBursts] = useState<string[]>(loadBursts);
  const [, setBurstTick] = useState(0);
  useEffect(() => { try { localStorage.setItem(STORE_BURST, JSON.stringify(bursts)); } catch {} }, [bursts]);
  /** 圖案起始大小：只存「跟 App 不一樣」的那些 */
  const [sizes, setSizes] = useState<Record<string, number>>(loadSizes);
  useEffect(() => { try { localStorage.setItem(STORE_SIZE, JSON.stringify(sizes)); } catch {} }, [sizes]);
  const sizeOf = (id: string) => patternDefaultSize(id, sizes);
  const setSize = (id: string, v: number) => setSizes(m => {
    const n = { ...m };
    if (Math.round(v) === patternDefaultSize(id)) delete n[id]; else n[id] = Math.round(v);
    return n;
  });
  const [sizeSel, setSizeSel] = useState<string>('star');
  /** 主人自己導入的照片（只留在這個分頁裡，不會上傳也不會存起來） */
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState('');
  useEffect(() => { if (!photo) { setPhotoUrl(''); return; } const u = URL.createObjectURL(photo); setPhotoUrl(u); return () => URL.revokeObjectURL(u); }, [photo]);
  const photoInput = useRef<HTMLInputElement>(null);
  /** 開著時整頁換成真正的創意拼圖（照片、圖案、大小都是實際的畫法） */
  const [preview, setPreview] = useState<{ file: File; pattern: string; key: number } | null>(null);
  /* 預覽裡拖「大小」滑桿每一格都會回報；直接 setState 的話整頁（連同創意拼圖）每格重畫一次，
     所以先記在這份物件上（創意拼圖換圖案時讀的也是它），回到這裡才一次寫回。 */
  const previewSizes = useRef<Record<string, number>>({});
  const scrollBack = useRef(0);
  const openPreview = async (pattern: string) => {
    previewSizes.current = { ...sizes };
    scrollBack.current = window.scrollY;
    const file = photo || await sampleFile();
    window.scrollTo(0, 0);
    setPreview({ file, pattern, key: Date.now() });
  };
  const closePreview = () => {
    const tuned = previewSizes.current;
    setSizes(Object.fromEntries((Object.entries(tuned) as [string, number][]).filter(([id, v]) => Math.round(v) !== patternDefaultSize(id)).map(([id, v]) => [id, Math.round(v)])));
    setPreview(null);
    requestAnimationFrame(() => window.scrollTo(0, scrollBack.current));
  };
  const [drag, setDrag] = useState<Drag | null>(null);
  const [toast, setToast] = useState('');
  /** 開著的時候，在「圖形」那一頁點一下圖形 → 加進圖案（再點一下取消） */
  const [mode, setMode] = useState<'none' | 'add' | 'stretch' | 'delete' | 'tex'>('none');
  const addMode = mode === 'add', stretchMode = mode === 'stretch', deleteMode = mode === 'delete', texMode = mode === 'tex';
  /** 「紋理」頁點過、要跟 App 現在相反的圖形 */
  const [texIds, setTexIds] = useState<string[]>(() => {
    const all = new Map(allShapeItems().map(it => [it.id, it]));
    return loadTex().filter(id => all.has(id) && TEX_POSSIBLE(all.get(id)));
  });
  useEffect(() => { try { localStorage.setItem(STORE_TEX, JSON.stringify(texIds)); } catch {} }, [texIds]);
  /** 照這台裝置上的勾選，這個圖形最後有沒有紋理 */
  const texWanted = (it: any) => TEX_IN_APP(it) !== texIds.includes(it.id);
  const toggleTex = (it: any) => {
    if (!TEX_POSSIBLE(it)) { flash('這個圖形本來就不能調紋理'); return; }
    const willHave = !texWanted(it);
    setTexIds(ids => ids.includes(it.id) ? ids.filter(x => x !== it.id) : [...ids, it.id]);
    flash(willHave ? '已勾選：恢復紋理' : '已勾選：不要紋理');
  };
  /** 勾選「要刪掉」的圖形 */
  const [deleteIds, setDeleteIds] = useState<string[]>(() => {
    const all = new Set(allShapeItems().map(it => it.id));
    return loadDelete().filter(id => all.has(id));
  });
  useEffect(() => { try { localStorage.setItem(STORE_DELETE, JSON.stringify(deleteIds)); } catch {} }, [deleteIds]);
  const toggleDelete = (it: any) => {
    setDeleteIds(ids => ids.includes(it.id) ? ids.filter(x => x !== it.id) : [...ids, it.id]);
    flash(deleteIds.includes(it.id) ? '已取消刪除' : '已勾選：刪除這個圖形');
  };
  /** 勾選「要改成可變形」的圖形 */
  const [stretchIds, setStretchIds] = useState<string[]>(() => {
    const all = new Map(allShapeItems().map(it => [it.id, it]));
    return loadStretch().filter(id => all.has(id) && !CAN_STRETCH(all.get(id)));
  });
  useEffect(() => { try { localStorage.setItem(STORE_STRETCH, JSON.stringify(stretchIds)); } catch {} }, [stretchIds]);
  const toggleStretch = (it: any) => {
    if (CAN_STRETCH(it)) { flash('這個圖形本來就可以變形'); return; }
    setStretchIds(ids => ids.includes(it.id) ? ids.filter(x => x !== it.id) : [...ids, it.id]);
    flash(stretchIds.includes(it.id) ? '已取消' : '已勾選：改成可變形');
  };
  const patternIds = new Set((groups.find(g => g.key === 'pattern')?.items || []).map(i => i.id));
  const toggleAsPattern = (shape: any) => {
    const pid = ADD_PREFIX + shape.id;
    setGroups(gs => gs.map(g => g.key !== 'pattern' ? g
      : g.items.some(i => i.id === pid) ? { ...g, items: g.items.filter(i => i.id !== pid) }
      : { ...g, items: [...g.items, asPatternItem(shape)] }));
    flash(patternIds.has(pid) ? '已從圖案移除' : '已加到圖案（在「圖案」那一頁的最後面）');
  };
  const hold = useRef<{ timer: number; x: number; y: number; pointerId: number } | null>(null);
  const dragRef = useRef<Drag | null>(null); dragRef.current = drag;

  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(groups.map(g => [g.key, g.items.map(i => i.id)])))); } catch {}
    try { localStorage.setItem(STORE_ADD, JSON.stringify((groups.find(g => g.key === 'pattern')?.items || []).filter(i => i.fromShape).map(i => i.fromShape.id))); } catch {}
  }, [groups]);

  // 拖曳中不讓頁面跟著捲動（iOS 要在 touchmove 上 preventDefault，而且不能是 passive）
  useEffect(() => {
    const block = (e: TouchEvent) => { if (dragRef.current) e.preventDefault(); };
    document.addEventListener('touchmove', block, { passive: false });
    return () => document.removeEventListener('touchmove', block);
  }, []);

  const changed = (g: Group) => {
    const b = base.find(x => x.key === g.key)!;
    return g.items.length !== b.items.length || g.items.some((it, i) => b.items[i]?.id !== it.id);
  };

  const cancelHold = () => { if (hold.current) { clearTimeout(hold.current.timer); hold.current = null; } };

  const onDown = (e: React.PointerEvent, group: string, id: string) => {
    if (dragRef.current) return;
    const el = e.currentTarget as HTMLElement, r = el.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY, pointerId = e.pointerId;
    cancelHold();
    hold.current = { x: sx, y: sy, pointerId, timer: window.setTimeout(() => {
      hold.current = null;
      try { el.setPointerCapture(pointerId); } catch {}
      navigator.vibrate?.(8);
      setDrag({ group, id, pointerId, dx: sx - r.left, dy: sy - r.top, x: sx, y: sy, w: r.width, h: r.height });
    }, HOLD_MS) };
  };

  const onMove = (e: React.PointerEvent) => {
    const h = hold.current;
    if (h && h.pointerId === e.pointerId && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 8) cancelHold();
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    e.preventDefault();
    setDrag({ ...d, x: e.clientX, y: e.clientY });
    // 手指底下是哪一格（同一區裡），就把拖著的這顆插到那一格的位置
    const target = document.elementsFromPoint(e.clientX, e.clientY)
      .map(n => (n as HTMLElement).closest?.('[data-cell]') as HTMLElement | null)
      .find(n => n && n.dataset.group === d.group && n.dataset.cell !== d.id);
    if (!target) return;
    const to = target.dataset.cell!;
    setGroups(gs => gs.map(g => {
      if (g.key !== d.group) return g;
      const items = g.items.slice(), from = items.findIndex(i => i.id === d.id), at = items.findIndex(i => i.id === to);
      if (from < 0 || at < 0) return g;
      const [it] = items.splice(from, 1); items.splice(at, 0, it);
      return { ...g, items };
    }));
  };

  const onUp = (e: React.PointerEvent) => {
    cancelHold();
    if (dragRef.current?.pointerId === e.pointerId) setDrag(null);
  };

  const text = () => {
    const lines = ['【ABAI 排序 v1】（只列有改的部分）'];
    // 只帶有改過順序的那幾區，沒動的不用每次都整串貼過去
    for (const g of groups) if (changed(g)) lines.push(g.label, g.items.map(i => i.id).join(', '));
    const items = new Map(allShapeItems().map(it => [it.id, it]));
    const texOff = texIds.filter(id => items.has(id) && TEX_IN_APP(items.get(id)));
    const texOn = texIds.filter(id => items.has(id) && !TEX_IN_APP(items.get(id)));
    if (texOff.length) lines.push('要拿掉紋理的圖形（面板上不要有「紋理」）', texOff.join(', '));
    if (texOn.length) lines.push('要恢復紋理的圖形', texOn.join(', '));
    const added = (groups.find(g => g.key === 'pattern')?.items || []).filter(i => i.fromShape);
    if (added.length) lines.push('要加到圖案的圖形（上面圖案順序裡 shape: 開頭的就是這些）', added.map(i => i.fromShape.id).join(', '));
    if (stretchIds.length) lines.push('要改成可以變形（四邊擠壓）的圖形', stretchIds.join(', '));
    if (deleteIds.length) lines.push('要刪除的圖形', deleteIds.join(', '));
    const sized = PATTERN_ORDER.filter(id => id in sizes);
    if (bursts.length) {
      const preset = STAR_BURSTS.filter(b => bursts.includes(b.id));
      const mine = loadCustomBursts().filter(c => bursts.includes(c.id));
      lines.push('想加進去的星芒（新圖形「星芒」）', [...preset.map(b => `${STAR_BURSTS.indexOf(b) + 1}. ${b.name}（${b.id}）`), ...mine.map(c => c.name)].join(', '));
      for (const c of mine) lines.push(`${c.name} 的參數`, JSON.stringify(c.params));
    }
    const delBursts = loadDeletedBursts();
    if (delBursts.length) lines.push('要刪除的星芒', STAR_BURSTS.filter(b => delBursts.includes(b.id)).map(b => `${b.name}（${b.id}）`).join(', '));
    if (sized.length) lines.push('圖案起始大小（創意拼圖的「大小」0~100）', sized.map(id => `${id}: ${sizes[id]}（原本 ${patternDefaultSize(id)}）`).join(', '));
    const picks = LAB_FRAMES.filter(f => framePicks.includes(f.id));
    if (picks.length) lines.push('想加進 App 的邊框（圖形・邊框）', picks.map(f => {
      const r = frameRanges[f.id];
      return r !== undefined && r !== frameRangeDefault(f.kind) ? `${f.label}（${f.id}，範圍 ${r}）` : `${f.label}（${f.id}）`;
    }).join(', '));
    if (lines.length === 1) lines.push('（目前沒有改任何東西）');
    return lines.join('\n');
  };
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(''), 1600); };
  const copy = async () => {
    const t = text();
    try { await navigator.clipboard.writeText(t); flash('已複製，貼給 Claude 就好'); }
    catch {
      const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); flash('已複製，貼給 Claude 就好'); } catch { flash('複製失敗，請長按下方文字複製'); }
      ta.remove();
    }
  };
  const reset = () => { if (confirm('回到 App 目前的順序？（加到圖案、變形、刪除的勾選、調過的圖案大小、星芒的勾選、刪除和自訂也會清掉）')) { setGroups(base.map(g => ({ ...g, items: [...g.items] }))); setStretchIds([]); setDeleteIds([]); setTexIds([]); setSizes({}); setBursts([]); try { localStorage.removeItem('abai-order-tool-starburst-deleted-v1'); localStorage.removeItem('abai-order-tool-starburst-custom-v1'); } catch {} window.dispatchEvent(new Event('abai-burst-reset')); } };

  const shown = tab === 'size' || tab === 'burst' || tab === 'frame' ? [] : groups.filter(g => tab === 'pattern' ? g.key === 'pattern' : g.key !== 'pattern');
  const dragged = drag && groups.find(g => g.key === drag.group)?.items.find(i => i.id === drag.id);
  const anyChanged = groups.some(changed) || framePicks.length > 0 || texIds.length > 0 || stretchIds.length > 0 || deleteIds.length > 0 || Object.keys(sizes).length > 0 || bursts.length > 0;
  const sizeList = (groups.find(g => g.key === 'pattern')?.items || []).filter(i => !i.fromShape);

  /* 預覽時整頁就是一個真正的創意拼圖（跟 App 裡一樣全螢幕，選單、彈出層都照原本的方式疊） */
  if (preview) return (
    <CollageTool key={preview.key} sandbox initialFile={preview.file} initialPattern={preview.pattern}
      patternSizes={previewSizes.current} onPatternSizeTuned={(id, v) => { previewSizes.current[id] = v; }}
      onHome={closePreview} onImportNew={() => {}} />
  );

  return (
    <div className="min-h-[100dvh] bg-black text-white select-none" style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}>
      <div data-order-header className="sticky top-0 z-20 bg-black/95 backdrop-blur border-b border-white/10" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className={`${tab === 'burst' ? 'max-w-[1100px]' : 'max-w-[560px]'} mx-auto px-4 pt-3 pb-3`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[15px] font-bold tracking-wide">排序工具</div>
              <div className="text-[11px] text-white/45 mt-0.5">長按一顆，浮起來後拖到新位置放開</div>
            </div>
            <div className="flex gap-2">
              <button onClick={reset} className="h-9 px-3 rounded-full border border-white/15 text-[12px] text-white/70 active:scale-95">重設</button>
              <button onClick={copy} className={`h-9 px-4 rounded-full text-[13px] font-bold active:scale-95 ${anyChanged ? 'bg-white text-black' : 'bg-white/15 text-white'}`}>複製有改的</button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-5 gap-1 p-1 rounded-full bg-white/[0.06]">
            {(['pattern', 'shape', 'size', 'burst', 'frame'] as const).map(k => (
              <button key={k} onClick={() => setTab(k)} className={`h-8 rounded-full text-[13px] font-bold transition-colors ${tab === k ? 'bg-white text-black' : 'text-white/55'}`}>
                {k === 'pattern' ? '圖案' : k === 'shape' ? '圖形' : k === 'size' ? '圖案大小' : k === 'burst' ? '星芒' : '邊框'}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className={`${tab === 'burst' ? 'max-w-[1100px]' : 'max-w-[560px]'} mx-auto px-4 pb-16`} style={{ paddingBottom: 'calc(64px + env(safe-area-inset-bottom))' }}>
        {tab === 'shape' && (
          <div className="mt-4 rounded-[12px] border border-white/10 bg-white/[0.04] px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] text-white/55 leading-snug">
                {addMode ? '點一下圖形就加到圖案，再點一下取消'
                  : stretchMode ? '點一下勾選「要改成可以變形」，再點一下取消'
                  : deleteMode ? '點一下勾選「要刪除」，再點一下取消'
                  : texMode ? '有「紋」的是現在可以調紋理的；點一下改成不要紋理，再點一下取消'
                  : '加到圖案、改成可變形、刪除圖形、或拿掉紋理'}
              </div>
              <div className="shrink-0 flex flex-wrap justify-end gap-1.5">
                <button onClick={() => setMode(m => m === 'add' ? 'none' : 'add')}
                  className={`h-8 px-3 rounded-full text-[12px] font-bold active:scale-95 ${addMode ? 'bg-[#9fd3a8] text-black' : 'border border-white/20 text-white/80'}`}>
                  {addMode ? '完成' : '加到圖案'}
                </button>
                <button onClick={() => setMode(m => m === 'stretch' ? 'none' : 'stretch')}
                  className={`h-8 px-3 rounded-full text-[12px] font-bold active:scale-95 ${stretchMode ? 'bg-[#f2c46d] text-black' : 'border border-white/20 text-white/80'}`}>
                  {stretchMode ? '完成' : '變形'}
                </button>
                <button onClick={() => setMode(m => m === 'delete' ? 'none' : 'delete')}
                  className={`h-8 px-3 rounded-full text-[12px] font-bold active:scale-95 ${deleteMode ? 'bg-[#ff7a7a] text-black' : 'border border-white/20 text-white/80'}`}>
                  {deleteMode ? '完成' : '刪除'}
                </button>
                <button onClick={() => setMode(m => m === 'tex' ? 'none' : 'tex')}
                  className={`h-8 px-3 rounded-full text-[12px] font-bold active:scale-95 ${texMode ? 'bg-[#c9a7ff] text-black' : 'border border-white/20 text-white/80'}`}>
                  {texMode ? '完成' : '紋理'}
                </button>
              </div>
            </div>
            {deleteMode && (
              <div className="mt-2 flex items-center gap-1 text-[10px] text-white/50">
                <span className="px-1 rounded-[4px] bg-[#ff7a7a] text-black font-bold leading-[12px]">刪</span>你勾選要刪除的圖形（{deleteIds.length}）
              </div>
            )}
            {texMode && (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-white/50">
                <span className="flex items-center gap-1"><span className="px-1 rounded-[4px] bg-white/15 text-white/70 font-bold leading-[12px]">紋</span>現在可以調紋理</span>
                <span className="flex items-center gap-1"><span className="px-1 rounded-[4px] bg-[#c9a7ff] text-black font-bold leading-[12px]">無紋</span>你勾選不要紋理</span>
                <span className="flex items-center gap-1"><span className="px-1 rounded-[4px] bg-[#9fd3a8] text-black font-bold leading-[12px]">恢復</span>App 已拿掉、你勾選恢復</span>
                <span>（暗掉的是本來就不能調紋理）</span>
              </div>
            )}
            {stretchMode && (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-white/50">
                <span className="flex items-center gap-1"><span className="px-1 rounded-[4px] bg-white/15 text-white/70 font-bold leading-[12px]">已可</span>本來就可以變形（不用選）</span>
                <span className="flex items-center gap-1"><span className="px-1 rounded-[4px] bg-[#f2c46d] text-black font-bold leading-[12px]">改</span>你勾選要改成可以變形（{stretchIds.length}）</span>
              </div>
            )}
          </div>
        )}
        {tab === 'shape' && <div className="mt-3 text-[10px] text-white/35">圖形是創意拼圖與跨頁拼圖共用的</div>}
        {tab === 'frame' && (
          <FrameLab photo={photo} onPickPhoto={setPhoto} picked={framePicks} ranges={frameRanges}
            onRange={(id, v) => setFrameRanges(r => ({ ...r, [id]: v }))}
            onTogglePick={id => { setFramePicks(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]); flash(framePicks.includes(id) ? '已取消' : '已勾選：想加進去'); }} />
        )}
        {tab === 'burst' && (
          <StarBurstLab photo={photo} onPickPhoto={setPhoto} picked={bursts} onChanged={() => setBurstTick(t => t + 1)}
            onTogglePick={id => { setBursts(b => b.includes(id) ? b.filter(x => x !== id) : [...b, id]); flash(bursts.includes(id) ? '已取消' : '已勾選：想加進去'); }} />
        )}
        {tab === 'size' && (() => {
          const cur = sizeOf(sizeSel), app = patternDefaultSize(sizeSel);
          return (
            <>
              <div className="mt-4 rounded-[12px] border border-white/10 bg-white/[0.04] p-3">
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 shrink-0 rounded-[8px] bg-white/5 border border-white/10 overflow-hidden flex items-center justify-center">
                    {photoUrl ? <img src={photoUrl} alt="" className="w-full h-full object-cover" /> : <span className="text-[10px] text-white/35">示範照</span>}
                  </div>
                  <div className="flex-1 min-w-0 text-[11px] text-white/55 leading-snug">
                    {photo ? '預覽會用這張照片' : '還沒導入照片，預覽會先用一張示範照'}
                    <div className="text-[10px] text-white/30 mt-0.5">照片只在這個頁面裡用，不會上傳、不會存起來</div>
                  </div>
                  <button onClick={() => photoInput.current?.click()} className="shrink-0 h-8 px-3 rounded-full bg-white text-black text-[12px] font-bold active:scale-95">{photo ? '換照片' : '導入照片'}</button>
                  <input ref={photoInput} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) setPhoto(f); e.target.value = ''; }} />
                </div>
              </div>
              <div className="mt-4 rounded-[12px] border border-white/15 bg-white/[0.06] p-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 shrink-0 rounded-[10px] border border-white/20 bg-white/5 flex items-center justify-center"><PatternIcon s={sizeSel} /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[12px] font-bold text-white/80">起始大小</span>
                      <span className="text-[18px] font-bold tabular-nums">{cur}</span>
                    </div>
                    <div className="text-[10px] text-white/40">{cur === app ? `跟 App 一樣（${app}）` : `App 目前是 ${app}`}</div>
                  </div>
                </div>
                <input type="range" min={0} max={100} step={1} value={cur} onChange={e => setSize(sizeSel, Number(e.target.value))}
                  className="w-full mt-3 accent-white" style={{ touchAction: 'pan-y' }} aria-label="起始大小" />
                <div className="mt-2 flex gap-2">
                  <button onClick={() => setSize(sizeSel, app)} disabled={cur === app}
                    className="h-9 px-3 rounded-full border border-white/15 text-[12px] text-white/70 disabled:opacity-30 active:scale-95">還原</button>
                  <button onClick={() => openPreview(sizeSel)} className="flex-1 h-9 rounded-full bg-[#7ab8ff] text-black text-[13px] font-bold active:scale-95">預覽實際效果</button>
                </div>
                <div className="mt-2 text-[10px] text-white/35 leading-snug">預覽是真正的創意拼圖。在裡面換圖案會用這裡調的大小；直接拖「大小」滑桿（沒選中單一圖案時），那個圖案的起始大小也會跟著記下來。按左上角返回就回到這裡。</div>
              </div>
              <section className="mt-5">
                <div className="flex items-baseline justify-between mb-2">
                  <div className="text-[11px] font-bold text-white/50 tracking-widest">點一個圖案來調整</div>
                  {Object.keys(sizes).length > 0 && <div className="text-[10px] text-[#7ab8ff]">已調整 {Object.keys(sizes).length} 個</div>}
                </div>
                <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
                  {sizeList.map(it => {
                    const tuned = it.id in sizes, on = it.id === sizeSel;
                    return (
                      <button key={it.id} data-size-cell={it.id} onClick={() => setSizeSel(it.id)} title={it.id}
                        className={`relative h-12 rounded-[10px] border flex items-center justify-center text-white/85 ${on ? 'border-white bg-white/15' : tuned ? 'border-[#7ab8ff]/70 bg-[#7ab8ff]/10' : 'border-white/10 bg-white/5'}`}>
                        <span className="pointer-events-none flex items-center justify-center"><PatternIcon s={it.id} /></span>
                        <span className={`pointer-events-none absolute right-1 bottom-0.5 text-[9px] tabular-nums font-bold ${tuned ? 'text-[#7ab8ff]' : 'text-white/35'}`}>{sizeOf(it.id)}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            </>
          );
        })()}
        {shown.map(g => (
          <section key={g.key} className="mt-5">
            <div className="flex items-baseline justify-between mb-2">
              <div className="text-[11px] font-bold text-white/50 tracking-widest">{g.label}</div>
              {changed(g) && <div className="text-[10px] text-[#9fd3a8]">已調整</div>}
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${g.cols}, minmax(0, 1fr))` }}>
              {g.items.map((it, i) => {
                const lifted = drag?.group === g.key && drag.id === it.id;
                return (
                  <div key={it.id} data-cell={it.id} data-group={g.key}
                    onPointerDown={e => { if (!((addMode || stretchMode || deleteMode || texMode) && g.key !== 'pattern')) onDown(e, g.key, it.id); }} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
                    onClick={() => { if (g.key === 'pattern' || dragRef.current) return; if (addMode) toggleAsPattern(it); else if (stretchMode) toggleStretch(it); else if (deleteMode) toggleDelete(it); else if (texMode) toggleTex(it); }}
                    onContextMenu={e => e.preventDefault()}
                    title={it.label || it.id}
                    className={`relative h-12 rounded-[10px] border flex items-center justify-center text-white/85 transition-[opacity,border-color] duration-150 ${lifted ? 'opacity-25 border-dashed border-white/40' : texMode && g.key !== 'pattern' ? (!TEX_POSSIBLE(it) ? 'border-white/5 bg-white/[0.02] opacity-35' : texIds.includes(it.id) ? 'border-[#c9a7ff]/80 bg-[#c9a7ff]/10' : 'border-white/10 bg-white/5') : g.key !== 'pattern' && deleteIds.includes(it.id) ? 'border-[#ff7a7a]/80 bg-[#ff7a7a]/10' : stretchMode && g.key !== 'pattern' ? (CAN_STRETCH(it) ? 'border-white/5 bg-white/[0.02] opacity-45' : stretchIds.includes(it.id) ? 'border-[#f2c46d]/80 bg-[#f2c46d]/10' : 'border-white/10 bg-white/5') : g.key !== 'pattern' && patternIds.has(ADD_PREFIX + it.id) ? 'border-[#9fd3a8]/70 bg-[#9fd3a8]/10' : 'border-white/10 bg-white/5'}`}
                    style={{ touchAction: drag ? 'none' : 'manipulation' }}>
                    <span className="pointer-events-none flex items-center justify-center"><Icon it={it} /></span>
                    <span className="pointer-events-none absolute left-1 top-0.5 text-[8px] text-white/30 tabular-nums">{i + 1}</span>
                    {NEW_IDS.has(it.id) && <span className="pointer-events-none absolute right-1 top-1 w-1.5 h-1.5 rounded-full bg-[#9fd3a8]" />}
                    {g.key !== 'pattern' && deleteIds.includes(it.id) && <span className="pointer-events-none absolute left-0.5 bottom-0.5 px-1 rounded-[4px] bg-[#ff7a7a] text-black text-[8px] font-bold leading-[12px]">刪</span>}
                    {texMode && g.key !== 'pattern' && TEX_POSSIBLE(it) && (() => {
                      const want = texWanted(it), flip = texIds.includes(it.id);
                      const [txt, cls] = !flip ? (want ? ['紋', 'bg-white/15 text-white/70'] : ['已無', 'bg-white/10 text-white/45'])
                        : want ? ['恢復', 'bg-[#9fd3a8] text-black'] : ['無紋', 'bg-[#c9a7ff] text-black'];
                      return <span className={`pointer-events-none absolute right-0.5 bottom-0.5 px-1 rounded-[4px] text-[8px] font-bold leading-[12px] ${cls}`}>{txt}</span>;
                    })()}
                    {stretchMode && g.key !== 'pattern' && CAN_STRETCH(it) && <span className="pointer-events-none absolute right-0.5 bottom-0.5 px-1 rounded-[4px] bg-white/15 text-white/70 text-[8px] font-bold leading-[12px]">已可</span>}
                    {stretchMode && g.key !== 'pattern' && stretchIds.includes(it.id) && <span className="pointer-events-none absolute right-0.5 bottom-0.5 px-1 rounded-[4px] bg-[#f2c46d] text-black text-[8px] font-bold leading-[12px]">改</span>}
                    {!stretchMode && !texMode && g.key !== 'pattern' && patternIds.has(ADD_PREFIX + it.id) && <span className="pointer-events-none absolute right-0.5 bottom-0.5 px-1 rounded-[4px] bg-[#9fd3a8] text-black text-[8px] font-bold leading-[12px]">圖案</span>}
                    {it.fromShape && <span className="pointer-events-none absolute right-0.5 bottom-0.5 px-1 rounded-[4px] bg-white/15 text-white/70 text-[8px] font-bold leading-[12px]">圖形</span>}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        <details className="mt-8 text-[11px] text-white/40">
          <summary className="cursor-pointer">要複製的文字（按鈕不能用時，長按這裡複製）</summary>
          <pre className="mt-2 whitespace-pre-wrap break-all select-text p-3 rounded-lg bg-white/5" style={{ WebkitUserSelect: 'text', userSelect: 'text' }}>{text()}</pre>
        </details>
      </div>
      {drag && dragged && (
        <div className="fixed z-50 pointer-events-none rounded-[10px] border border-white bg-[#222] flex items-center justify-center text-white shadow-[0_10px_30px_rgba(0,0,0,0.6)]"
          style={{ left: 0, top: 0, width: drag.w, height: drag.h, transform: `translate3d(${drag.x - drag.dx}px, ${drag.y - drag.dy}px, 0) scale(1.12)` }}>
          <Icon it={dragged} />
        </div>
      )}
      {toast && <div className="fixed left-1/2 -translate-x-1/2 bottom-8 z-50 px-4 py-2 rounded-full bg-white text-black text-[13px] font-bold">{toast}</div>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<OrderTool />);
