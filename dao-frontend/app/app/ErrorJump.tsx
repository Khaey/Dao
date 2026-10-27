'use client';

import { useEffect, useState } from 'react';

/** Give errors immediate visibility, even when the action happens at the bottom of a long page. */
export default function ErrorJump() {
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const seen = new WeakMap<HTMLElement, string>();
    const root = document.querySelector('main') ?? document.body;
    const alerts = () => root.querySelectorAll<HTMLElement>('[role="alert"]');
    alerts().forEach(el => seen.set(el, el.textContent?.trim() ?? ''));
    let frame = 0;
    let toastTimer: ReturnType<typeof setTimeout> | undefined;
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
      const message = target.textContent?.trim() ?? '';
      if (message) {
        setToast(message);
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => setToast(null), 5500);
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!target.isConnected || !target.getClientRects().length) return;
        target.setAttribute('tabindex', '-1');
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        target.focus({ preventScroll: true });
      });
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      if (toastTimer) clearTimeout(toastTimer);
    };
  }, []);

  return toast ? (
    <div
      aria-hidden="true"
      data-testid="error-toast"
      className="pointer-events-none fixed right-4 top-20 z-[120] w-[calc(100vw-2rem)] max-w-md sm:right-6 lg:top-6"
    >
      <div className="overflow-hidden rounded-xl border border-red-200 bg-white shadow-xl ring-1 ring-red-100">
        <div className="h-1 bg-red-500" />
        <div className="px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-wide text-red-700">À corriger</p>
          <p className="mt-1 text-sm leading-relaxed text-ink">{toast}</p>
        </div>
      </div>
    </div>
  ) : null;
}
