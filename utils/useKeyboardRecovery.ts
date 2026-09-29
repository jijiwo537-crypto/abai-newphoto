import { useEffect } from 'react';

/** Undo only the document pan introduced by the software keyboard, not panel scrolling. */
export function useKeyboardRecovery() {
  useEffect(() => {
    let origin: { x: number; y: number; height: number } | null = null;
    let timer = 0;
    const editable = (el: EventTarget | null) => el instanceof HTMLElement &&
      (el.matches('input:not([type=range]):not([type=file]):not([type=color]), textarea') || el.isContentEditable);
    const restore = () => {
      if (!origin || editable(document.activeElement)) return;
      const vv = window.visualViewport;
      if (vv && vv.height < origin.height - 80) return;
      window.scrollTo({ left: origin.x, top: origin.y, behavior: 'instant' });
      origin = null;
    };
    const focus = (e: FocusEvent) => {
      if (!editable(e.target)) return;
      clearTimeout(timer);
      origin ||= { x: window.scrollX, y: window.scrollY, height: window.visualViewport?.height || window.innerHeight };
    };
    const blur = () => { clearTimeout(timer); timer = window.setTimeout(restore, 350); };
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', blur);
    window.visualViewport?.addEventListener('resize', restore);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', blur);
      window.visualViewport?.removeEventListener('resize', restore);
    };
  }, []);
}
