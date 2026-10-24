'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser } from './supabase-browser';

type AuthenticatedUser = { ready: boolean; userId: string | null };

/**
 * Current browser identity, including account replacements broadcast by Supabase.
 * The sequence guard prevents a late initial getUser() response from restoring the
 * previous account after a SIGNED_IN/SIGNED_OUT event.
 */
export function useAuthenticatedUser(): AuthenticatedUser {
  const [state, setState] = useState<AuthenticatedUser>({ ready: false, userId: null });

  useEffect(() => {
    const supabase = supabaseBrowser();
    let active = true;
    let authSequence = 0;
    const initialSequence = authSequence;

    void supabase.auth.getUser().then(({ data }) => {
      if (active && authSequence === initialSequence) {
        setState({ ready: true, userId: data.user?.id ?? null });
      }
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      authSequence += 1;
      if (active) setState({ ready: true, userId: session?.user.id ?? null });
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return state;
}
