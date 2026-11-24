/* 「動畫時長」面板上方的情境預覽：手機大小的畫面裡，照 App 的版面重現每個過場（照片從格子飛進編輯器、
   相機相簿開關、返回滑走、首頁的彈出視窗…），用的就是面板上目前的時長與曲線，看到的節奏跟 App 裡一樣。 */
import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { MOTION_ITEMS, ms } from '../utils/motionTimings';

export const STAGE_W = 216, STAGE_H = 468;
const W = STAGE_W, H = STAGE_H;
/* 跟 App 一樣的編輯器版面（縮到這個畫面的比例）：照片上緣、左右、下方留給工具列的高度 */
const K = W / 390;
const EDIT = { top: 72 * K + 14, side: 16 * K, bottom: 262 * K };

/** 用程式畫的範例照片（天空、山、太陽、湖），每一張配色不同 */
function makePhoto(seed: number, w = 360, h = 480) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d')!;
  const pal = [
    ['#ffb37a', '#ff6f61', '#3b2a4f', '#24324f'], ['#9fd3ff', '#5aa0e6', '#2f6b4f', '#1d3b2e'],
    ['#ffe3a3', '#f2a65a', '#6b4a3a', '#2c2a35'], ['#c9b6ff', '#7a6cf0', '#2c3f6b', '#141c33'],
    ['#b8f0e0', '#5cc9b0', '#3d6e5a', '#1f3a33'], ['#ffd0e0', '#f58fb0', '#5a3a5f', '#2a1f35'],
  ][seed % 6];
  const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, pal[0]); g.addColorStop(0.55, pal[1]); g.addColorStop(1, pal[3]);
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  x.fillStyle = 'rgba(255,255,240,0.9)'; x.beginPath(); x.arc(w * (0.3 + (seed % 3) * 0.2), h * 0.34, w * 0.09, 0, Math.PI * 2); x.fill();
  for (let k = 0; k < 2; k++) {
    x.fillStyle = k ? pal[3] : pal[2]; x.beginPath(); x.moveTo(0, h);
    for (let i = 0; i <= 12; i++) x.lineTo(w * i / 12, h * (0.55 + k * 0.12) - Math.sin(i * 0.9 + seed + k) * h * 0.07 - (i % 3) * 6);
    x.lineTo(w, h); x.fill();
  }
  x.fillStyle = 'rgba(255,255,255,0.08)'; x.fillRect(0, h * 0.82, w, 2);
  return c.toDataURL('image/jpeg', 0.85);
}

const abs = (s: Partial<CSSStyleDeclaration>): React.CSSProperties => ({ position: 'absolute', ...(s as any) });
type Scene = 'home' | 'editor' | 'gallery' | 'viewer' | 'camera' | 'homeDialog' | 'homeSheet' | 'account' | 'contact';

export interface MotionStageApi { play(id: string): void }

export const MotionStage = forwardRef<MotionStageApi, { slow: number }>(({ slow }, ref) => {
  const photos = useMemo(() => Array.from({ length: 12 }, (_, i) => makePhoto(i)), []);
  const root = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<Scene>('home');
  const [label, setLabel] = useState('按下面任一項的「預覽」');
  const q = (sel: string) => root.current?.querySelector(sel) as HTMLElement | null;
  const d = (id: string) => ms(id) * slow;
  const ease = (id: string) => MOTION_ITEMS.find(m => m.id === id)?.easing ?? 'ease';
  const tick = () => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  const wait = (t: number) => new Promise(r => setTimeout(r, t));
  const token = useRef(0);

  /* 飛行的替身（跟 App 的 importHero 一樣：一張圖從格子放大到工具裡照片的位置） */
  const ghost = (src: string) => {
    const g = document.createElement('div');
    Object.assign(g.style, { position: 'absolute', overflow: 'hidden', zIndex: '50', transformOrigin: '0 0', borderRadius: '0px' });
    const im = document.createElement('img'); im.src = src;
    Object.assign(im.style, { width: '100%', height: '100%', objectFit: 'contain', display: 'block' });
    g.appendChild(im); root.current!.appendChild(g);
    return g;
  };
  const cellRect = (i: number) => {
    const el = q(`[data-cell="${i}"]`), r0 = root.current!.getBoundingClientRect();
    const r = el!.getBoundingClientRect();
    return { x: r.left - r0.left, y: r.top - r0.top, w: r.width, h: r.height };
  };

  useImperativeHandle(ref, () => ({
    async play(id: string) {
      const my = ++token.current;
      root.current?.querySelectorAll('[data-ghost]').forEach(n => n.remove());
      const item = MOTION_ITEMS.find(m => m.id === id);
      setLabel(`${item?.group}／${item?.label}：${Math.round(d(id) / slow)} ms${slow > 1 ? `（慢動作 ×${slow}）` : ''}`);
      const alive = () => my === token.current;

      if (id === 'importFly' || id === 'importUpgrade' || id === 'importLand') {
        setScene('home'); await tick(); await wait(250); if (!alive()) return;
        /* 首頁的相簿格子 → 編輯器 */
        const C = cellRect(4);
        const ar = 3 / 4, bw = W - EDIT.side * 2, bh = H - EDIT.top - EDIT.bottom;
        let ew = bw, eh = bw / ar; if (eh > bh) { eh = bh; ew = bh * ar; }
        const E = { x: (W - ew) / 2, y: EDIT.top + (bh - eh) / 2, w: ew, h: eh };
        const g = ghost(photos[4]); g.dataset.ghost = '';
        Object.assign(g.style, { left: `${E.x}px`, top: `${E.y}px`, width: `${E.w}px`, height: `${E.h}px` });
        (g.firstChild as HTMLImageElement).style.filter = 'blur(2px)';
        const k = Math.min(C.w / E.w, C.h / E.h);
        const sx = C.x + (C.w - E.w * k) / 2, sy = C.y + (C.h - E.h * k) / 2;
        setScene('editor');
        const fly = g.animate([{ transform: `translate(${sx - E.x}px, ${sy - E.y}px) scale(${k})` }, { transform: 'none' }], { duration: d('importFly'), easing: ease('importFly'), fill: 'forwards' });
        /* 飛到一半換成清楚的圖 */
        setTimeout(() => { if (!alive()) return; const im2 = (g.firstChild as HTMLImageElement).cloneNode() as HTMLImageElement; im2.style.filter = 'none'; Object.assign(im2.style, { position: 'absolute', inset: '0' }); g.appendChild(im2); im2.animate([{ opacity: 0 }, { opacity: 1 }], { duration: d('importUpgrade'), easing: ease('importUpgrade'), fill: 'forwards' }); }, d('importFly') * 0.35);
        await fly.finished.catch(() => {}); if (!alive()) return;
        await wait(120 * slow);
        q('[data-editor-photo]')!.style.opacity = '1';
        await g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: d('importLand'), easing: ease('importLand'), fill: 'forwards' }).finished.catch(() => {});
        g.remove();
        return;
      }
      if (id === 'pageBack') {
        setScene('editor'); await tick(); q('[data-editor-photo]')!.style.opacity = '1'; await wait(300); if (!alive()) return;
        /* 編輯器往右滑走，底下的首頁從左邊一點點、稍暗跟著回來（跟 App 的返回一樣） */
        const top = q('[data-layer="editor"]')!, under = q('[data-layer="home"]')!;
        under.style.display = 'block';
        const o = { duration: d('pageBack'), easing: ease('pageBack'), fill: 'forwards' as FillMode };
        under.animate([{ transform: 'translateX(-28%)', filter: 'brightness(0.72)' }, { transform: 'none', filter: 'brightness(1)' }], o);
        await top.animate([{ transform: 'none' }, { transform: 'translateX(100%)' }], o).finished.catch(() => {});
        if (!alive()) return;
        setScene('home'); top.getAnimations().forEach(a => a.cancel()); under.getAnimations().forEach(a => a.cancel());
        return;
      }
      if (id === 'camGalleryOpen' || id === 'camGalleryOpenFade') {
        setScene('gallery'); await tick(); await wait(250); if (!alive()) return;
        const C = cellRect(7);
        const ar = 3 / 4; const w = W, h = W / ar; const B = { x: 0, y: (H - h) / 2, w, h };
        const bg = q('[data-viewer-bg]')!; const g = ghost(photos[7]); g.dataset.ghost = '';
        Object.assign(g.style, { left: `${B.x}px`, top: `${B.y}px`, width: `${B.w}px`, height: `${B.h}px`, transformOrigin: 'center' });
        const k = Math.max(C.w / w, C.h / h);
        const ix = Math.max(0, (w - C.w / k) / 2), iy = Math.max(0, (h - C.h / k) / 2);
        const tx = C.x + C.w / 2 - (B.x + w / 2), ty = C.y + C.h / 2 - (B.y + h / 2);
        bg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: d('camGalleryOpen') * 0.7, easing: 'ease-out', fill: 'forwards' });
        await g.animate([{ transform: `translate(${tx}px,${ty}px) scale(${k})`, clipPath: `inset(${iy}px ${ix}px)` }, { transform: 'none', clipPath: 'inset(0px)' }], { duration: d('camGalleryOpen'), easing: ease('camGalleryOpen'), fill: 'forwards' }).finished.catch(() => {});
        if (!alive()) return;
        setScene('viewer'); await tick();
        await g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: d('camGalleryOpenFade'), easing: 'ease-out', fill: 'forwards' }).finished.catch(() => {});
        g.remove();
        return;
      }
      if (id === 'camGalleryClose' || id === 'camGalleryBounce') {
        setScene('viewer'); await tick(); await wait(250); if (!alive()) return;
        const img = q('[data-viewer-img]')!, bg = q('[data-viewer-bg]')!;
        /* 手指往下拉的那一段（示意） */
        const pull = id === 'camGalleryBounce' ? 46 : 120, s = id === 'camGalleryBounce' ? 0.93 : 0.82;
        await img.animate([{ transform: 'none' }, { transform: `translate(0px, ${pull}px) scale(${s})` }], { duration: 260 * slow, easing: 'ease-out', fill: 'forwards' }).finished.catch(() => {});
        if (!alive()) return;
        if (id === 'camGalleryBounce') {
          await img.animate([{ transform: `translate(0px, ${pull}px) scale(${s})` }, { transform: 'none' }], { duration: d('camGalleryBounce'), easing: ease('camGalleryBounce'), fill: 'forwards' }).finished.catch(() => {});
          img.getAnimations().forEach(a => a.cancel());
          return;
        }
        /* 放手：縮回相簿裡那一格，黑底同時淡掉 */
        setScene('gallery'); await tick();
        const C = cellRect(7), r0 = root.current!.getBoundingClientRect();
        const g = ghost(photos[7]); g.dataset.ghost = '';
        const w = W * s, h = (W / 0.75) * s; const B = { x: (W - w) / 2, y: (H - W / 0.75) / 2 + pull + (W / 0.75 - h) / 2, w, h };
        Object.assign(g.style, { left: `${B.x}px`, top: `${B.y}px`, width: `${w}px`, height: `${h}px`, transformOrigin: 'center' });
        const k = Math.max(C.w / w, C.h / h);
        const ix = Math.max(0, (w - C.w / k) / 2), iy = Math.max(0, (h - C.h / k) / 2);
        const tx = C.x + C.w / 2 - (B.x + w / 2), ty = C.y + C.h / 2 - (B.y + h / 2);
        const cover = document.createElement('div'); cover.dataset.ghost = '';
        Object.assign(cover.style, { position: 'absolute', inset: '0', background: '#000', zIndex: '40' }); root.current!.appendChild(cover);
        cover.animate([{ opacity: 1 }, { opacity: 0 }], { duration: d('camGalleryClose') * 0.85, easing: 'ease-out', fill: 'forwards' });
        await g.animate([{ transform: 'none', clipPath: 'inset(0px)' }, { transform: `translate(${tx}px,${ty}px) scale(${k})`, clipPath: `inset(${iy}px ${ix}px)` }], { duration: d('camGalleryClose'), easing: ease('camGalleryClose'), fill: 'forwards' }).finished.catch(() => {});
        g.remove(); cover.remove(); void r0;
        return;
      }
      if (id === 'shutterDown' || id === 'shutterUp') {
        setScene('camera'); await tick(); await wait(250); if (!alive()) return;
        const b = q('[data-shutter]')!;
        await b.animate([{ transform: 'scale(1)' }, { transform: 'scale(0.86)' }], { duration: d('shutterDown'), easing: ease('shutterDown'), fill: 'forwards' }).finished.catch(() => {});
        await wait(160 * slow); if (!alive()) return;
        const flash = q('[data-flash]')!; flash.animate([{ opacity: 0.8 }, { opacity: 0 }], { duration: 220 * slow, easing: 'ease-out' });
        await b.animate([{ transform: 'scale(0.86)' }, { transform: 'scale(1)' }], { duration: d('shutterUp'), easing: ease('shutterUp'), fill: 'forwards' }).finished.catch(() => {});
        return;
      }
      if (id === 'homeBackdrop' || id === 'homeDialog') {
        setScene('homeDialog'); await tick();
        q('[data-backdrop]')!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: d('homeBackdrop'), easing: 'ease-out', fill: 'both' });
        q('[data-dialog]')!.animate([{ opacity: 0, transform: 'scale(0.94)' }, { opacity: 1, transform: 'scale(1)' }], { duration: d('homeDialog'), easing: ease('homeDialog'), fill: 'both' });
        return;
      }
      if (id === 'homeLoginSheet') {
        setScene('homeSheet'); await tick();
        q('[data-backdrop]')!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: d('homeBackdrop'), easing: 'ease-out', fill: 'both' });
        q('[data-sheet]')!.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: d('homeLoginSheet'), easing: ease('homeLoginSheet'), fill: 'both' });
        return;
      }
      if (id === 'homeAccountPage') {
        setScene('account'); await tick();
        q('[data-account]')!.animate([{ transform: 'translateX(100%)' }, { transform: 'none' }], { duration: d('homeAccountPage'), easing: ease('homeAccountPage'), fill: 'both' });
        return;
      }
      if (id === 'homeSettingsBackdrop' || id === 'homeContact' || id === 'homeToast') {
        setScene('contact'); await tick();
        q('[data-backdrop]')!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: d('homeSettingsBackdrop'), easing: 'ease-out', fill: 'both' });
        q('[data-dialog]')!.animate([{ opacity: 0, transform: 'scale(0.96) translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: d('homeContact'), easing: ease('homeContact'), fill: 'both' });
        const t = q('[data-toast]')!; t.style.opacity = '0';
        await wait(d('homeContact') + 250 * slow); if (!alive()) return;
        t.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: d('homeToast'), easing: ease('homeToast'), fill: 'both' });
        return;
      }
      if (id === 'editorPanel' || id === 'editorMerge') {
        setScene('editor'); await tick(); q('[data-editor-photo]')!.style.opacity = '1';
        const p = q('[data-panel]')!, m = q('[data-merge]')!;
        p.style.opacity = '0'; await wait(250); if (!alive()) return;
        if (id === 'editorPanel') {
          p.animate([{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], { duration: d('editorPanel'), easing: ease('editorPanel'), fill: 'both' });
        } else {
          const top = m.querySelector('[data-merge-top]') as HTMLElement;
          top.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(5px)', offset: 0.45 }, { transform: 'translateY(0)' }], { duration: d('editorMerge'), easing: ease('editorMerge') });
        }
      }
    },
  }));

  /* ── 各個畫面（照 App 的版面，縮小） ── */
  const grid = (cols: number, gap: number, top: number) => (
    <div style={abs({ left: '0', right: '0', top: `${top}px`, display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: `${gap}px`, padding: `0 ${gap}px` } as any)}>
      {photos.map((p, i) => <div key={i} data-cell={i} style={{ aspectRatio: '1', overflow: 'hidden', background: '#222' }}><img src={p} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /></div>)}
    </div>
  );
  const home = (
    <div data-layer="home" style={abs({ inset: '0', background: '#0b0b0b' } as any)}>
      <div style={abs({ left: '14px', top: '30px', color: '#fff', fontWeight: '900', fontSize: '28px', letterSpacing: '-1px' } as any)}>Abai</div>
      <div style={abs({ left: '14px', right: '14px', top: '78px', display: 'flex', gap: '6px' } as any)}>
        {['編輯', '人像', '仿色', '拼圖'].map(t => <div key={t} style={{ flex: 1, height: '30px', borderRadius: '10px', background: '#1d1d1d', color: '#ddd', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{t}</div>)}
      </div>
      <div style={abs({ left: '14px', top: '122px', color: '#888', fontSize: '10px' } as any)}>從相簿選一張</div>
      {grid(3, 2, 140)}
    </div>
  );
  const editor = (
    <div data-layer="editor" style={abs({ inset: '0', background: '#000', zIndex: '2' } as any)}>
      <div style={abs({ left: '10px', right: '10px', top: '16px', height: '26px', display: 'flex', justifyContent: 'space-between', color: '#fff', fontSize: '12px' } as any)}><span>‹</span><span style={{ background: '#fff', color: '#000', borderRadius: '99px', padding: '2px 10px', fontSize: '10px' }}>儲存</span></div>
      {(() => {
        const bw = W - EDIT.side * 2, bh = H - EDIT.top - EDIT.bottom; let ew = bw, eh = bw / 0.75; if (eh > bh) { eh = bh; ew = bh * 0.75; }
        return <img data-editor-photo src={photos[4]} style={abs({ left: `${(W - ew) / 2}px`, top: `${EDIT.top + (bh - eh) / 2}px`, width: `${ew}px`, height: `${eh}px`, opacity: '0' } as any)} />;
      })()}
      <div data-panel style={abs({ left: '12px', right: '12px', bottom: `${EDIT.bottom - 6}px`, height: '44px', borderRadius: '12px', background: 'rgba(30,30,30,.92)', opacity: '0', color: '#bbb', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-around' } as any)}>
        {['紅', '橙', '黃', '綠', '青', '藍'].map(t => <span key={t}>{t}</span>)}
      </div>
      <div data-merge style={abs({ right: '14px', bottom: `${EDIT.bottom + 8}px`, width: '30px', height: '30px', borderRadius: '99px', background: 'rgba(255,255,255,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center' } as any)}>
        <div style={{ position: 'relative', width: '14px', height: '14px' }}>
          <div style={abs({ inset: '6px 0 0 0', border: '1.5px solid #fff', transform: 'rotate(45deg) scale(.7)' } as any)} />
          <div data-merge-top style={abs({ inset: '0 0 6px 0', background: '#fff', transform: 'rotate(45deg) scale(.7)' } as any)} />
        </div>
      </div>
      <div style={abs({ left: '0', right: '0', bottom: '0', height: `${EDIT.bottom - 50}px`, borderTop: '1px solid #1b1b1b' } as any)}>
        <div style={{ display: 'flex', gap: '6px', padding: '10px 10px 0' }}>{photos.slice(0, 5).map((p, i) => <img key={i} src={p} style={{ width: '34px', height: '34px', objectFit: 'cover', borderRadius: '4px', outline: i === 1 ? '1.5px solid #fff' : 'none' }} />)}</div>
        <div style={{ display: 'flex', justifyContent: 'space-around', color: '#888', fontSize: '10px', position: 'absolute', bottom: '14px', left: 0, right: 0 }}>{['濾鏡', '特效', '調整', '遮色片', '構圖'].map(t => <span key={t} style={{ color: t === '濾鏡' ? '#fff' : undefined }}>{t}</span>)}</div>
      </div>
    </div>
  );
  const gallery = (
    <div style={abs({ inset: '0', background: '#000' } as any)}>
      <div style={abs({ left: '0', right: '0', top: '16px', textAlign: 'center', color: '#fff', fontSize: '12px', fontWeight: '600' } as any)}>相簿</div>
      {grid(3, 1, 44)}
      <div data-viewer-bg style={abs({ inset: '0', background: '#000', opacity: '0', zIndex: '30' } as any)} />
    </div>
  );
  const viewer = (
    <div style={abs({ inset: '0', zIndex: '35' } as any)}>
      <div data-viewer-bg style={abs({ inset: '0', background: '#000' } as any)} />
      <img data-viewer-img src={photos[7]} style={abs({ left: '0', width: `${W}px`, top: `${(H - W / 0.75) / 2}px`, height: `${W / 0.75}px`, objectFit: 'contain' } as any)} />
      <div style={abs({ left: '0', right: '0', bottom: '18px', display: 'flex', justifyContent: 'space-around' } as any)}>{['↑', '♡', '✎', '🗑'].map(t => <div key={t} style={{ width: '30px', height: '30px', borderRadius: '99px', background: 'rgba(255,255,255,.14)', color: '#fff', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{t}</div>)}</div>
    </div>
  );
  const camera = (
    <div style={abs({ inset: '0', background: '#000' } as any)}>
      <img src={photos[2]} style={abs({ left: '6px', right: '6px', top: '40px', width: `${W - 12}px`, height: `${(W - 12) / 0.75}px`, objectFit: 'cover', borderRadius: '14px' } as any)} />
      <div data-flash style={abs({ left: '6px', right: '6px', top: '40px', height: `${(W - 12) / 0.75}px`, background: '#000', opacity: '0', borderRadius: '14px' } as any)} />
      <div data-shutter style={abs({ left: `${W / 2 - 30}px`, bottom: '34px', width: '60px', height: '60px', borderRadius: '99px', border: '3px solid #fff', padding: '3px' } as any)}><div style={{ width: '100%', height: '100%', borderRadius: '99px', background: '#fff' }} /></div>
      <img src={photos[9]} style={abs({ left: '22px', bottom: '46px', width: '36px', height: '36px', objectFit: 'cover', borderRadius: '8px' } as any)} />
    </div>
  );
  const backdrop = <div data-backdrop style={abs({ inset: '0', background: 'rgba(0,0,0,.6)', zIndex: '20' } as any)} />;
  const homeDialog = (<>{home}{backdrop}
    <div data-dialog style={abs({ left: '24px', right: '24px', top: `${H / 2 - 70}px`, height: '140px', borderRadius: '22px', background: '#161616', border: '1px solid rgba(255,255,255,.1)', zIndex: '21', color: '#fff', fontSize: '12px', fontWeight: '800', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px' } as any)}>
      確定要登出嗎？
      <div style={{ display: 'flex', gap: '8px' }}><span style={{ background: '#fff', color: '#000', borderRadius: '99px', padding: '6px 16px', fontSize: '11px' }}>登出</span><span style={{ border: '1px solid #444', borderRadius: '99px', padding: '6px 16px', fontSize: '11px', color: '#aaa' }}>取消</span></div>
    </div></>);
  const homeSheet = (<>{home}{backdrop}
    <div data-sheet style={abs({ left: '0', right: '0', bottom: '0', height: `${H * 0.6}px`, borderRadius: '22px 22px 0 0', background: '#161616', zIndex: '21', color: '#fff', padding: '20px', fontSize: '14px', fontWeight: '800' } as any)}>
      登入<div style={{ marginTop: '16px', height: '38px', borderRadius: '12px', background: '#fff' }} /><div style={{ marginTop: '8px', height: '38px', borderRadius: '12px', background: '#262626' }} />
    </div></>);
  const account = (<>{home}
    <div data-account style={abs({ inset: '0', background: '#0e0e0e', zIndex: '21', color: '#fff', padding: '20px', fontSize: '14px', fontWeight: '800' } as any)}>
      ‹ 帳號<div style={{ marginTop: '18px', width: '56px', height: '56px', borderRadius: '99px', background: '#333' }} />
      {[0, 1, 2].map(i => <div key={i} style={{ marginTop: '10px', height: '36px', borderRadius: '12px', background: '#1c1c1c' }} />)}
    </div></>);
  const contact = (<>{home}{backdrop}
    <div data-dialog style={abs({ left: '20px', right: '20px', top: `${H / 2 - 90}px`, height: '180px', borderRadius: '24px', background: 'rgba(40,40,40,.85)', border: '1px solid rgba(255,255,255,.15)', zIndex: '21', color: '#fff', padding: '16px', fontSize: '12px', fontWeight: '700' } as any)}>
      聯絡我們<div style={{ marginTop: '12px', height: '34px', borderRadius: '10px', background: 'rgba(255,255,255,.08)', color: '#ccc', fontSize: '10px', display: 'flex', alignItems: 'center', padding: '0 10px' }}>hello@abai.app　複製</div>
    </div>
    <div data-toast style={abs({ left: `${W / 2 - 40}px`, top: `${H / 2 - 120}px`, width: '80px', height: '24px', borderRadius: '99px', background: '#fff', color: '#000', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '22', opacity: '0' } as any)}>已複製</div></>);

  return (
    <div className="flex flex-col items-center">
      <div ref={root} style={{ position: 'relative', width: W, height: H, borderRadius: 30, overflow: 'hidden', background: '#000', boxShadow: '0 0 0 6px #2a2a2a, 0 10px 40px rgba(0,0,0,.6)' }}>
        {scene === 'home' && home}
        {scene === 'editor' && <>{home}{editor}</>}
        {scene === 'gallery' && gallery}
        {scene === 'viewer' && <>{gallery}{viewer}</>}
        {scene === 'camera' && camera}
        {scene === 'homeDialog' && homeDialog}
        {scene === 'homeSheet' && homeSheet}
        {scene === 'account' && account}
        {scene === 'contact' && contact}
      </div>
      <p className="text-white/60 text-[11px] mt-2 h-4 text-center">{label}</p>
    </div>
  );
});
