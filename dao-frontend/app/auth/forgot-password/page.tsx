'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { Button, Card, Input } from '../../../components/ui';
import { supabaseBrowser } from '../../../lib/supabase-browser';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    setError('');
    try {
      const { error: recoveryError } = await supabaseBrowser().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: new URL('/auth/reset-password', window.location.origin).href,
      });
      if (recoveryError) {
        setError('Impossible d’envoyer le lien pour le moment. Réessayez plus tard.');
      } else {
        setSent(true);
      }
    } catch {
      setError('Impossible d’envoyer le lien pour le moment. Vérifiez votre connexion et réessayez.');
    } finally {
      setSending(false);
    }
  }

  return <main className="flex min-h-screen items-center justify-center px-5 py-8">
    <Card className="w-full max-w-md">
      <p className="text-sm font-semibold text-teal">D.A.O</p>
      <h1 className="mt-2 text-3xl font-bold">Mot de passe oublié</h1>
      {sent ? <p role="status" className="mt-6 text-sm text-black/70">
        Si un compte correspond à cette adresse, vous recevrez un email contenant un lien de réinitialisation.
        Ouvrez-le dans ce même navigateur. Pensez à vérifier vos courriers indésirables.
      </p> : <>
        <p className="mt-3 text-sm text-black/60">Indiquez l’adresse email de votre compte pour recevoir un lien de réinitialisation.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-sm font-medium" htmlFor="recovery-email">Adresse email</label>
          <Input id="recovery-email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required disabled={sending} />
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <Button className="w-full" disabled={sending}>{sending ? 'Envoi en cours…' : 'Envoyer le lien de réinitialisation'}</Button>
        </form>
      </>}
      <Link className="mt-5 inline-flex min-h-10 items-center text-sm font-semibold text-teal hover:underline" href="/auth/login">Retour à la connexion</Link>
    </Card>
  </main>;
}
