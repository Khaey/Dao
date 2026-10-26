// An expired session is not a permission refusal: send the person back to the login page with the reason and
// the page to come back to. Only in-app paths are accepted as return targets (no open redirect).
export function expiredSessionLoginUrl(path: string) {
  return `/auth/login?raison=session&retour=${encodeURIComponent(path)}`;
}

export function appReturnPath(search: string): string | null {
  const value = new URLSearchParams(search).get('retour');
  return value && /^\/app(\/|\?|$)/.test(value) && !value.includes('//') && !value.includes('\\') ? value : null;
}

export function redirectToLoginAfterExpiry() {
  window.location.replace(expiredSessionLoginUrl(window.location.pathname + window.location.search));
}

// « Se déconnecter » (menu or profile) is deliberate: the login page must not then claim the session expired.
let deliberateSignOut = false;
export function noteDeliberateSignOut() { deliberateSignOut = true; }
export function wasDeliberateSignOut() { return deliberateSignOut; }
