import React, { useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';

/** Edit low toolbar fields above the keyboard, without moving the editor itself. */
export function KeyboardSafeInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const origin = useRef({ x: 0, y: 0 });
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
      <div className="absolute left-4 right-4 flex items-center gap-3 rounded-xl bg-[#242424] p-3 shadow-xl"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 64px)' }}>
        <input {...props} ref={field} readOnly={false} className="min-w-0 flex-1 rounded-lg bg-black/30 px-3 py-2 text-white outline-none"
          style={{ fontSize: 16 }} onBlur={() => setOpen(false)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); close(); } }} />
        <button className="shrink-0 px-2 py-2 text-sm text-white" onPointerDown={e => e.preventDefault()} onClick={close}>完成</button>
      </div>
    </div>, document.body)}
  </>;
}
