'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button, Card, Input } from '../../../components/ui';
import { supabaseBrowser } from '../../../lib/supabase-browser';

const invalidLink = 'Ce lien est invalide ou a expiré. Demandez un nouveau lien et ouvrez-le dans le navigateur utilisé pour la demande.';

export default function ResetPassword() {
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const recoveryUser = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = supabaseBrowser();
    // The existing browser client exchanges the PKCE code automatically.
    // An ordinary signed-in session must not enable the recovery form.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY' && session) {
        recoveryUser.current = session.user.id;
        setReady(true);
        setChecking(false);
        setError('');
      } else if (event === 'SIGNED_OUT') {
        recoveryUser.current = null;
        setReady(false);
        setChecking(false);
        setError(invalidLink);
      }
    });
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError || !data.session || !recoveryUser.current) {
        setReady(false);
        setError(invalidLink);
      }
      setChecking(false);
    }).catch(() => {
      if (active) {
        setError('Impossible de vérifier le lien. Vérifiez votre connexion et rouvrez le lien reçu par email.');
        setChecking(false);
      }
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || saving) return;
    setError('');
    if (password.length < 8) { setError('Le mot de passe doit contenir au moins 8 caractères.'); return; }
    if (password !== confirmation) { setError('Les deux mots de passe ne correspondent pas.'); return; }
    setSaving(true);
    try {
      const supabase = supabaseBrowser();
      const { data, error: userError } = await supabase.auth.getUser();
      if (userError || !data.user || data.user.id !== recoveryUser.current) {
        setReady(false);
        setError(invalidLink);
        return;
      }
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError('Impossible de modifier le mot de passe. Vérifiez les critères demandés ou demandez un nouveau lien.');
        return;
      }
      setPassword('');
      setConfirmation('');
      setSaved(true);
      setReady(false);
      // End this browser's recovery session; the user signs in with the new password.
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      setError('Impossible de terminer la demande. Vérifiez votre connexion et réessayez.');
    } finally {
      setSaving(false);
    }
  }

  return <main className="flex min-h-screen items-center justify-center px-5 py-8">
    <Card className="w-full max-w-md">
      <p className="text-sm font-semibold text-teal">D.A.O</p>
      <h1 className="mt-2 text-3xl font-bold">Nouveau mot de passe</h1>
      {saved ? <p role="status" className="mt-6 text-sm text-black/70">Votre mot de passe a été mis à jour. Vous pouvez vous connecter avec votre nouveau mot de passe.</p> : checking ? <p role="status" className="mt-6 text-sm text-black/60">Vérification du lien…</p> : <>
        {error && <p role="alert" className="mt-5 text-sm text-red-600">{error}</p>}
        {ready && <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-sm font-medium" htmlFor="new-password">Nouveau mot de passe</label>
          <Input id="new-password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={event => setPassword(event.target.value)} required disabled={saving} />
          <p className="text-xs text-black/60">Au moins 8 caractères.</p>
          <label className="block text-sm font-medium" htmlFor="confirm-password">Confirmer le mot de passe</label>
          <Input id="confirm-password" type="password" autoComplete="new-password" minLength={8} value={confirmation} onChange={event => setConfirmation(event.target.value)} required disabled={saving} />
          <Button className="w-full" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer le nouveau mot de passe'}</Button>
        </form>}
        {!ready && <Link className="mt-5 inline-flex min-h-10 items-center text-sm font-semibold text-teal hover:underline" href="/auth/forgot-password">Demander un nouveau lien</Link>}
      </>}
      <Link className="mt-5 inline-flex min-h-10 items-center text-sm font-semibold text-teal hover:underline" href="/auth/login">Retour à la connexion</Link>
    </Card>
  </main>;
}
