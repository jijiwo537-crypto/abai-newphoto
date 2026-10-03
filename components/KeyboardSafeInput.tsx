import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';

/** Edit low toolbar fields above the keyboard, without moving the editor itself. */
export function KeyboardSafeInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const origin = useRef({ x: 0, y: 0 });
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    const place = () => {
      if (!panel.current) return;
      const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const preview=document.querySelector('[data-creative-stage] canvas')?.parentElement?.getBoundingClientRect();
      const available=(vv?.width||window.innerWidth)-48;
      panel.current.style.width=`${Math.min(available,preview?.width?Math.max(240,preview.width-16):available)}px`;
      panel.current.style.top = `${Math.max(8, bottom - panel.current.offsetHeight - 6)}px`;
    };
    place();
    vv?.addEventListener('resize', place);
    vv?.addEventListener('scroll', place);
    window.addEventListener('resize', place);
    return () => {
      vv?.removeEventListener('resize', place);
      vv?.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
    };
  }, [open]);
  const close = () => {
    field.current?.blur();
    setOpen(false);
    window.scrollTo({ left: origin.current.x, top: origin.current.y, behavior: 'instant' });
  };
  const show = () => {
    origin.current = { x: window.scrollX, y: window.scrollY };
    flushSync(() => setOpen(true));
    field.current?.focus({ preventScroll: true });
  };
  return <>
    <input {...props} readOnly onPointerDown={e => e.preventDefault()} onClick={show}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); } }} />
    {open && createPortal(<div className="fixed inset-0 z-[1000]" role="dialog" aria-label={props['aria-label'] || props.placeholder}>
      <button className="absolute inset-0 bg-black/30" aria-label="完成" onClick={close} />
      <div ref={panel} data-keyboard-safe-panel className="absolute left-1/2 -translate-x-1/2 flex items-center gap-3 rounded-xl bg-[#242424] p-3 shadow-xl">
        <input {...props} ref={field} readOnly={false} className="min-w-0 flex-1 rounded-lg bg-black/30 px-3 py-2 text-white outline-none"
          style={{ fontSize: 16, caretColor: '#fff', border: '1px solid #fff', outline: 'none', boxShadow: 'none', accentColor: '#fff' }} onBlur={() => setOpen(false)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); close(); } }} />
        <button className="shrink-0 px-2 py-2 text-sm text-white" onPointerDown={e => e.preventDefault()} onClick={close}>完成</button>
      </div>
    </div>, document.body)}
  </>;
}
