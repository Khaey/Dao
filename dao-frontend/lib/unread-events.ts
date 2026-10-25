'use client';

// Signal local « un compteur non lu a changé » (#462) : la cloche, le menu et la page
// Notifications se rafraîchissent aussitôt, sans attendre un changement de route ni le focus.
// Aucun contenu ne transite : chaque abonné relit son propre compteur JWT côté serveur.
export const UNREAD_CHANGED_EVENT = 'dao:unread-changed';

export function notifyUnreadChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(UNREAD_CHANGED_EVENT));
}

export function onUnreadChanged(listener: () => void) {
  window.addEventListener(UNREAD_CHANGED_EVENT, listener);
  return () => window.removeEventListener(UNREAD_CHANGED_EVENT, listener);
}
