'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabaseBrowser } from '../../../lib/supabase-browser';
import { Button, Card, Input } from '../../../components/ui';

export default function Register() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(''); setSaving(true);
    const supabase = supabaseBrowser();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: name } },
    });
    if (signUpError) {
      setError(signUpError.message);
      setSaving(false);
      return;
    }
    if (data.session) {
      await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token },
        body: JSON.stringify({ display_name: name, phone_e164: phone || null }),
      });
      router.push('/app/projects');
    } else {
      setError('Votre inscription est enregistrée. Vérifiez votre email pour continuer.');
      setSaving(false);
    }
  }

  return <main className="flex min-h-screen items-center justify-center px-5">
    <Card className="w-full max-w-md">
      <p className="text-sm font-semibold text-teal">D.A.O</p><h1 className="mt-2 text-3xl font-bold">Créer votre espace</h1>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <Input placeholder="Nom complet" value={name} onChange={event => setName(event.target.value)} required />
        <Input placeholder="Téléphone tunisien (optionnel)" value={phone} onChange={event => setPhone(event.target.value)} pattern="\\+216[0-9]{8}" />
        <Input type="email" placeholder="Email" value={email} onChange={event => setEmail(event.target.value)} required />
        <Input type="password" placeholder="Mot de passe" minLength={8} value={password} onChange={event => setPassword(event.target.value)} required />
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <Button className="w-full" disabled={saving}>{saving ? 'Création…' : 'Créer mon compte'}</Button>
      </form>
      <p className="mt-5 text-sm text-black/60">Déjà inscrit ? <Link className="font-semibold text-teal" href="/auth/login">Se connecter</Link></p>
    </Card>
  </main>;
}
