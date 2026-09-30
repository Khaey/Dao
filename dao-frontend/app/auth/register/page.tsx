'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabaseBrowser } from '../../../lib/supabase-browser';
import { Button, Card, Input } from '../../../components/ui';

import { invitationReturn } from '../../../lib/collaboration';

export default function Register() {
  const [returnTo, setReturnTo] = useState<string | null>(null);
  useEffect(() => setReturnTo(invitationReturn(window.location.search)), []);
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [accountType, setAccountType] = useState<'client' | 'contractor' | ''>('');
  const [businessName, setBusinessName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!accountType) {
      setError('Choisissez un type de compte pour continuer.');
      return;
    }
    if (accountType === 'contractor' && !businessName.trim()) {
      setError('Le nom de l’activité ou de l’entreprise est obligatoire.');
      return;
    }
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
      const profileResponse = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token },
        body: JSON.stringify({
          display_name: name,
          phone_e164: phone || null,
          account_type: accountType,
          business_name: accountType === 'contractor' ? businessName.trim() : null,
        }),
      });
      const profileResult = await profileResponse.json().catch(() => ({}));
      if (!profileResponse.ok) {
        setError(profileResult.error || 'Impossible de finaliser la création du compte.');
        setSaving(false);
        return;
      }
      router.push(returnTo || (accountType === 'contractor' ? '/app/artisan' : '/app/projects'));
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
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-ink">Type de compte <span className="text-red-600">(obligatoire)</span></legend>
          <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${accountType === 'client' ? 'border-teal bg-teal/5' : 'border-black/15 hover:border-teal/50'}`}>
            <input className="mt-1 accent-teal" type="radio" name="account_type" value="client" checked={accountType === 'client'} onChange={() => setAccountType('client')} required />
            <span><span className="block font-semibold">Client</span><span className="mt-1 block text-sm text-black/60">Je cherche un artisan ou une entreprise pour mes travaux</span></span>
          </label>
          <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${accountType === 'contractor' ? 'border-teal bg-teal/5' : 'border-black/15 hover:border-teal/50'}`}>
            <input className="mt-1 accent-teal" type="radio" name="account_type" value="contractor" checked={accountType === 'contractor'} onChange={() => setAccountType('contractor')} required />
            <span><span className="block font-semibold">Artisan / Entreprise</span><span className="mt-1 block text-sm text-black/60">Je souhaite répondre aux appels d’offres et proposer mes services</span></span>
          </label>
        </fieldset>
        {accountType === 'contractor' && <Input placeholder="Nom de l’activité / entreprise" value={businessName} onChange={event => setBusinessName(event.target.value)} required maxLength={160} />}
        <Input type="email" placeholder="Email" value={email} onChange={event => setEmail(event.target.value)} required />
        <Input type="password" placeholder="Mot de passe" minLength={8} value={password} onChange={event => setPassword(event.target.value)} required />
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <Button className="w-full" disabled={saving || !accountType || (accountType === 'contractor' && !businessName.trim())}>{saving ? 'Création…' : 'Créer mon compte'}</Button>
      </form>
      <p className="mt-5 text-sm text-black/60">Déjà inscrit ? <Link className="font-semibold text-teal" href={returnTo ? `/auth/login?returnTo=${encodeURIComponent(returnTo)}` : "/auth/login"}>Se connecter</Link></p>
    </Card>
  </main>;
}
