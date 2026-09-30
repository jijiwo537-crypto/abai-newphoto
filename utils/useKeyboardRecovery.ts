import { useEffect } from 'react';

/** Keep the tool's layout viewport stable while iOS pans its visual viewport. */
export function useKeyboardRecovery() {
  useEffect(() => {
    let origin: { x: number; y: number; height: number } | null = null;
    let timer = 0;
    let pinned: { el: HTMLElement; height: string; heightPriority: string; maxHeight: string; maxPriority: string; translate: string }[] = [];
    const release = () => {
      for (const p of pinned) {
        p.el.style.setProperty('height', p.height, p.heightPriority);
        p.el.style.setProperty('max-height', p.maxHeight, p.maxPriority);
        p.el.style.translate = p.translate;
      }
      pinned = [];
    };
    const editable = (el: EventTarget | null) => el instanceof HTMLElement &&
      (el.matches('input:not([type=range]):not([type=file]):not([type=color]), textarea') || el.isContentEditable);
    const restore = () => {
      if (!origin || editable(document.activeElement)) return;
      const vv = window.visualViewport;
      if (vv && vv.height < origin.height - 80) return;
      window.scrollTo({ left: origin.x, top: origin.y, behavior: 'instant' });
      release();
      origin = null;
    };
    const focus = (e: FocusEvent) => {
      if (!editable(e.target)) return;
      clearTimeout(timer);
      origin ||= { x: window.scrollX, y: window.scrollY, height: window.visualViewport?.height || window.innerHeight };
      if (!pinned.length) {
        pinned = Array.from(document.querySelectorAll<HTMLElement>('.safe-top')).map(el => {
          const p = { el, height: el.style.getPropertyValue('height'), heightPriority: el.style.getPropertyPriority('height'), maxHeight: el.style.getPropertyValue('max-height'), maxPriority: el.style.getPropertyPriority('max-height'), translate: el.style.translate };
          const height = `${el.getBoundingClientRect().height}px`;
          el.style.setProperty('height', height, 'important');
          el.style.setProperty('max-height', height, 'important');
          return p;
        });
      }
    };
    const viewport = () => {
      if (!origin) return;
      const dy = window.scrollY - origin.y + (window.visualViewport?.offsetTop || 0);
      for (const p of pinned) p.el.style.translate = `0 ${dy}px`;
      restore();
    };
    const blur = () => { clearTimeout(timer); timer = window.setTimeout(restore, 350); };
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', blur);
    window.visualViewport?.addEventListener('resize', viewport);
    window.visualViewport?.addEventListener('scroll', viewport);
    window.addEventListener('scroll', viewport);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', blur);
      window.visualViewport?.removeEventListener('resize', viewport);
      window.visualViewport?.removeEventListener('scroll', viewport);
      window.removeEventListener('scroll', viewport);
      release();
    };
  }, []);
}
