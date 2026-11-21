/* 暫時的佈局偵錯工具（跨頁拼圖）：主人在手機上重現問題時錄下每一格的幾何資料，按「複製」貼給 Claude。
   只量、不改任何東西。錄製中每一格（requestAnimationFrame）記錄：
     ‧ 選中框（data-layout-chrome-box）、佈局本體（data-layout-content-wrapper）在畫面上的範圍
     ‧ 佈局裡每一個看得到的元素（照片畫布、格子、虛線層…）的範圍、顯示狀態、transform、裁切
     ‧ 每個元素超出選中框幾個像素（上下左右）
     ‧ 頁面範圍、預覽倍率、裝置像素比 */

type R = [number, number, number, number];
const rr = (r: DOMRect): R => [r.left, r.top, r.right, r.bottom].map(v => Math.round(v * 100) / 100) as R;
const over = (a: R, f: R) => ({ l: +(f[0] - a[0]).toFixed(2), t: +(f[1] - a[1]).toFixed(2), r: +(a[2] - f[2]).toFixed(2), b: +(a[3] - f[3]).toFixed(2) });
const maxOver = (o: { l: number; t: number; r: number; b: number }) => Math.max(o.l, o.t, o.r, o.b);
const short = (s: string | null | undefined, n = 140) => (s || '').length > n ? (s || '').slice(0, n) + '…' : (s || '');

const describe = (el: Element) => {
  const h = el as HTMLElement;
  const a = (k: string) => el.getAttribute(k);
  const tag = el.tagName.toLowerCase();
  const keys = ['data-layout-base', 'data-layout-photo-surface', 'data-layout-photo-clip', 'data-layout-overlay', 'data-layout-grid-lines',
    'data-layout-empty-prompts', 'data-cell-id', 'data-layout-motion', 'data-layout-wave', 'data-dim-overlay', 'data-layout-photo-plane'];
  const k = keys.find(x => el.hasAttribute(x));
  return `${tag}${k ? `[${k}${a(k) ? '=' + a(k) : ''}]` : ''}${h.className && typeof h.className === 'string' ? '.' + h.className.split(' ').slice(0, 2).join('.') : ''}`;
};

/* 外層的裁切（clip-path: inset(...)、overflow 非 visible）會把超出的部分切掉 —— 量「真正看得到的範圍」 */
const insetOf = (cp: string): [number, number, number, number] | null => {
  const m = /^inset\(([^)]*)\)/.exec(cp || ''); if (!m) return null;
  const v = m[1].split(/\s+/).filter(x => x && !x.startsWith('round')).map(x => parseFloat(x));
  if (!v.length || v.some(x => !Number.isFinite(x))) return null;
  const [t, r = t, b = t, l = r] = v; return [t, r, b, l];
};
const visibleRect = (el: Element, stop: Element): R | null => {
  const b = el.getBoundingClientRect();
  let x0 = b.left, y0 = b.top, x1 = b.right, y1 = b.bottom;
  let a: Element | null = el.parentElement;
  while (a) {
    const cs = getComputedStyle(a);
    const ar = a.getBoundingClientRect();
    const ins = cs.clipPath && cs.clipPath !== 'none' ? insetOf(cs.clipPath) : null;
    if (ins) { x0 = Math.max(x0, ar.left + ins[3]); y0 = Math.max(y0, ar.top + ins[0]); x1 = Math.min(x1, ar.right - ins[1]); y1 = Math.min(y1, ar.bottom - ins[2]); }
    if (cs.overflow !== 'visible' && cs.overflow !== '') { x0 = Math.max(x0, ar.left); y0 = Math.max(y0, ar.top); x1 = Math.min(x1, ar.right); y1 = Math.min(y1, ar.bottom); }
    if (a === stop) break;
    a = a.parentElement;
  }
  if (x1 - x0 < .5 || y1 - y0 < .5) return null;
  return [x0, y0, x1, y1].map(v => Math.round(v * 100) / 100) as R;
};

let samples: any[] = [];
let recording = false, raf = 0, t0 = 0;
let panel: HTMLDivElement | null = null;
let statusEl: HTMLSpanElement | null = null;

const sample = () => {
  const frameEl = document.querySelector<HTMLElement>('[data-layout-chrome-box]');
  const id = frameEl?.getAttribute('data-layout-id') || null;
  const wrapper = id ? document.querySelector<HTMLElement>(`[data-layout-content-wrapper][data-layout-id="${id}"]`) : null;
  const s: any = { t: Math.round(performance.now() - t0) };
  if (!frameEl || !wrapper) { s.note = frameEl ? 'no wrapper' : 'no selected layout frame'; return s; }
  const f = rr(frameEl.getBoundingClientRect());
  const w = rr(wrapper.getBoundingClientRect());
  s.frame = f; s.wrapper = w; s.wrapperOver = over(w, f);
  // 選中框所在那一層的 CSS zoom（Safari 對 zoom 底下元素回報座標的方式可能不同，留著對照）
  let z: HTMLElement | null = frameEl; while (z && !(z.style as any).zoom) z = z.parentElement;
  s.chromeZoom = z ? (z.style as any).zoom : null;
  s.frameStyle = `${frameEl.style.left}|${frameEl.style.top}|${frameEl.style.width}|${frameEl.style.height}`;
  s.wrapperTransform = short(wrapper.style.transform, 120); s.willChange = wrapper.style.willChange || '';
  const page = wrapper.closest('[data-page-id]') as HTMLElement | null;
  if (page) s.page = rr(page.getBoundingClientRect());
  // 佈局裡每一個看得到的東西：超出選中框最多的前幾名
  const items: any[] = [];
  wrapper.querySelectorAll('*').forEach(el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const r = visibleRect(el, document.body);
    if (!r) return;
    const o = over(r, f), m = maxOver(o);
    if (m > 0.5) items.push({ el: describe(el), vis: r, raw: rr(el.getBoundingClientRect()), over: o, max: m, op: cs.opacity !== '1' ? cs.opacity : undefined,
      clip: cs.clipPath !== 'none' ? short(cs.clipPath, 60) : undefined, tf: (el as HTMLElement).style?.transform ? short((el as HTMLElement).style.transform, 70) : undefined,
      cw: el instanceof HTMLCanvasElement ? `${el.width}x${el.height}` : undefined });
  });
  items.sort((a, b) => b.max - a.max);
  s.overflow = items.slice(0, 3);
  s.maxOver = items.length ? items[0].max : 0;
  // 照片畫布的狀態（就算沒超出也記，方便對照）
  s.canvases = Array.from(wrapper.querySelectorAll('canvas')).map(c => {
    const cs = getComputedStyle(c);
    return { el: describe(c), size: `${c.width}x${c.height}`, disp: cs.display, vis: cs.visibility, rect: rr(c.getBoundingClientRect()),
      clip: cs.clipPath !== 'none' ? short(cs.clipPath, 60) : '' };
  });
  const clipHost = wrapper.querySelector<HTMLElement>('[data-layout-photo-clip]');
  if (clipHost) s.photoClip = clipHost.style.clipPath;
  return s;
};

const loop = () => {
  if (!recording) return;
  samples.push(sample());
  if (samples.length > 600) samples.splice(0, samples.length - 600);
  if (statusEl) {
    const worst = samples.reduce((m, x) => Math.max(m, x.maxOver || 0), 0);
    statusEl.textContent = `錄製中 ${samples.length} 格・最多超出 ${worst.toFixed(1)}px`;
  }
  raf = requestAnimationFrame(loop);
};

const report = () => {
  const withOver = samples.filter(x => (x.maxOver || 0) > 0.5);
  const worst = samples.reduce((m, x) => (x.maxOver || 0) > (m?.maxOver || 0) ? x : m, null as any);
  // 精簡（貼得進對話）：有超出的格最多留 30 格（平均挑），其他每 15 格留一格；照片畫布的細節只留在最嚴重那格
  const ov = samples.filter(x => (x.maxOver || 0) > 0.5);
  const pick = ov.filter((_, i) => i % Math.max(1, Math.ceil(ov.length / 30)) === 0);
  const keep = samples.filter((x, i) => pick.includes(x) || i % 15 === 0).map(x => x === worst ? x : { ...x, canvases: undefined });
  const env = {
    ua: navigator.userAgent, dpr: devicePixelRatio, vw: innerWidth, vh: innerHeight,
    previewScale: (document.querySelector('[style*="--preview-scale"]') as HTMLElement | null)?.style.getPropertyValue('--preview-scale') || null,
    toggles: { noPromote: !!(window as any).__dbgNoPromote, noGrow: !!(window as any).__dbgNoGrow },
    app: (document.querySelector('meta[name="abai-build"]') as HTMLMetaElement | null)?.content || location.search,
  };
  return JSON.stringify({ tool: 'layout-debug v1', env, frames: samples.length, framesWithOverflow: withOver.length, worst, samples: keep });
};

const copy = async (text: string) => {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;left:0;top:0;opacity:0'; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove(); return ok;
  }
};

const btn = (label: string, onClick: () => void) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = 'height:30px;padding:0 10px;border-radius:15px;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.75);color:#fff;font:600 12px -apple-system,sans-serif;';
  b.addEventListener('click', e => { e.stopPropagation(); onClick(); });
  b.addEventListener('pointerdown', e => e.stopPropagation());
  b.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
  return b;
};

/** 掛上偵錯工具。回傳拆掉的函式。 */
export function mountLayoutDebug(): () => void {
  if (typeof document === 'undefined' || panel) return () => {};
  panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;left:8px;top:calc(env(safe-area-inset-top) + 64px);z-index:2147483000;display:flex;flex-wrap:wrap;gap:6px;align-items:center;max-width:calc(100vw - 16px);pointer-events:auto;';
  statusEl = document.createElement('span');
  statusEl.style.cssText = 'color:#fff;background:rgba(0,0,0,.75);border-radius:10px;padding:4px 8px;font:600 11px -apple-system,sans-serif;';
  statusEl.textContent = '佈局偵錯';
  const rec = btn('錄製', () => {
    if (!recording) { samples = []; recording = true; t0 = performance.now(); rec.textContent = '停止'; raf = requestAnimationFrame(loop); }
    else { recording = false; cancelAnimationFrame(raf); rec.textContent = '錄製'; if (statusEl) statusEl.textContent = `已錄 ${samples.length} 格，按複製`; }
  });
  const cp = btn('複製', async () => {
    if (!samples.length) { if (statusEl) statusEl.textContent = '還沒有錄到東西'; return; }
    const ok = await copy(report());
    if (statusEl) statusEl.textContent = ok ? '已複製，貼給 Claude' : '複製失敗';
  });
  // 二分法用的開關：分別關掉兩個可疑的機制，看問題會不會消失（開關狀態也會寫進複製的資料）
  const tog = (label: string, key: string) => { const b = btn(`${label}：關`, () => { const w = window as any; w[key] = !w[key]; b.textContent = `${label}：${w[key] ? '開' : '關'}`; b.style.background = w[key] ? 'rgba(10,132,255,.9)' : 'rgba(0,0,0,.75)'; }); return b; };
  const ta = tog('A 不升圖層', '__dbgNoPromote'), tb = tog('B 不多畫邊', '__dbgNoGrow');
  const hide = btn('×', () => { panel?.remove(); panel = null; recording = false; cancelAnimationFrame(raf); });
  // 平常只顯示一顆小按鈕，點開才展開（不擋住畫面上的操作）
  const body = document.createElement('div');
  body.style.cssText = 'display:none;flex-wrap:wrap;gap:6px;align-items:center;';
  body.append(statusEl, rec, cp, ta, tb, hide);
  const toggle = btn('偵錯', () => { const open = body.style.display === 'none'; body.style.display = open ? 'flex' : 'none'; toggle.textContent = open ? '收起' : '偵錯'; });
  panel.append(toggle, body);
  document.body.appendChild(panel);
  return () => { recording = false; cancelAnimationFrame(raf); panel?.remove(); panel = null; };
}
