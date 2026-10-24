'use client';

import { useEffect } from 'react';

/** Give errors immediate visibility, even when the action happens at the bottom of a long page. */
export default function ErrorJump() {
  useEffect(() => {
    const seen = new WeakMap<HTMLElement, string>();
    const root = document.querySelector('main') ?? document.body;
    const alerts = () => root.querySelectorAll<HTMLElement>('[role="alert"]');
    alerts().forEach(el => seen.set(el, el.textContent?.trim() ?? ''));
    let frame = 0;
    const observer = new MutationObserver(records => {
      let candidate: HTMLElement | null = null;
      const check = (el: HTMLElement) => {
        const message = el.textContent?.trim() ?? '';
        if (!message || seen.get(el) === message) return;
        seen.set(el, message);
        candidate = el;
      };
      for (const change of records) {
        if (change.target instanceof Element) {
          const parent = change.target.closest<HTMLElement>('[role="alert"]');
          if (parent) check(parent);
        } else if (change.target.parentElement) {
          const parent = change.target.parentElement.closest<HTMLElement>('[role="alert"]');
          if (parent) check(parent);
        }
        for (const node of change.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.matches('[role="alert"]')) check(node);
          node.querySelectorAll<HTMLElement>('[role="alert"]').forEach(check);
        }
      }
      if (!candidate) return;
      const target: HTMLElement = candidate;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!target.isConnected || !target.getClientRects().length) return;
        target.setAttribute('tabindex', '-1');
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        target.focus({ preventScroll: true });
      });
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  return null;
}
