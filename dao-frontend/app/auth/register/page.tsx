'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabaseBrowser } from '../../../lib/supabase-browser';
import { Button, Card, Input } from '../../../components/ui';
import { invitationReturn, projectApi } from '../../../lib/collaboration';

type InvitationRegistration = {
  expected_role: 'client' | 'contractor';
  recipient_email: string | null;
  recipient_name: string | null;
};

export default function Register() {
  const router = useRouter();
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<InvitationRegistration | null>(null);
  const [checkingInvitation, setCheckingInvitation] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [accountType, setAccountType] = useState<'client' | 'contractor' | ''>('');
  const [businessName, setBusinessName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const target = invitationReturn(window.location.search);
    setReturnTo(target);
    if (!target) {
      setCheckingInvitation(false);
      return;
    }
    const token = target.slice('/invite/'.length);
    void projectApi<InvitationRegistration | null>('/api/projects/invitations/registration-context', { token }, true)
      .then(summary => {
        if (!summary) return;
        setInvitation(summary);
        setAccountType(summary.expected_role);
        if (summary.recipient_email) setEmail(summary.recipient_email);
        if (summary.recipient_name) setName(summary.recipient_name);
      })
      .catch(() => {
        // The invitation page remains the authority. If its preview is no
        // longer available, registration falls back to the ordinary flow.
      })
      .finally(() => setCheckingInvitation(false));
  }, []);

  const guided = Boolean(invitation);
  const effectiveBusinessName = accountType === 'contractor'
    ? (guided ? name.trim() : businessName.trim())
    : '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!accountType) {
      setError('Choisissez un type de compte pour continuer.');
      return;
    }
    if (accountType === 'contractor' && !effectiveBusinessName) {
      setError(guided ? 'Renseignez votre nom pour continuer.' : 'Le nom de l’activité ou de l’entreprise est obligatoire.');
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
          phone_e164: guided ? null : (phone || null),
          account_type: accountType,
          business_name: accountType === 'contractor' ? effectiveBusinessName : null,
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

  const expectedLabel = accountType === 'contractor' ? 'Artisan / Entreprise' : 'Client';
  const emailLocked = Boolean(invitation?.recipient_email);

  return <main className="flex min-h-screen items-center justify-center px-5">
    <Card className="w-full max-w-md">
      <p className="text-sm font-semibold text-teal">D.A.O</p><h1 className="mt-2 text-3xl font-bold">Créer votre espace</h1>
      {checkingInvitation ? <p className="mt-8 text-sm text-black/55" role="status">Préparation de votre inscription…</p> : <form onSubmit={submit} className="mt-8 space-y-4">
        <Input placeholder="Nom complet" value={name} onChange={event => setName(event.target.value)} required maxLength={160} />
        {!guided && <Input placeholder="Téléphone tunisien (optionnel)" value={phone} onChange={event => setPhone(event.target.value)} pattern="\\+216[0-9]{8}" />}
        {guided ? <div className="rounded-xl border border-teal/30 bg-teal/5 p-4" aria-label="Type de compte défini par l’invitation">
          <p className="text-xs font-semibold uppercase tracking-wide text-black/45">Type de compte</p>
          <p className="mt-1 font-semibold">{expectedLabel}</p>
          <p className="mt-1 text-sm text-black/55">Ce type est défini par l’invitation et ne peut pas être modifié.</p>
        </div> : <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-ink">Type de compte <span className="text-red-600">(obligatoire)</span></legend>
          <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${accountType === 'client' ? 'border-teal bg-teal/5' : 'border-black/15 hover:border-teal/50'}`}>
            <input className="mt-1 accent-teal" type="radio" name="account_type" value="client" checked={accountType === 'client'} onChange={() => setAccountType('client')} required />
            <span><span className="block font-semibold">Client</span><span className="mt-1 block text-sm text-black/60">Je cherche un artisan ou une entreprise pour mes travaux</span></span>
          </label>
          <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${accountType === 'contractor' ? 'border-teal bg-teal/5' : 'border-black/15 hover:border-teal/50'}`}>
            <input className="mt-1 accent-teal" type="radio" name="account_type" value="contractor" checked={accountType === 'contractor'} onChange={() => setAccountType('contractor')} required />
            <span><span className="block font-semibold">Artisan / Entreprise</span><span className="mt-1 block text-sm text-black/60">Je souhaite répondre aux appels d’offres et proposer mes services</span></span>
          </label>
        </fieldset>}
        {!guided && accountType === 'contractor' && <Input placeholder="Nom de l’activité / entreprise" value={businessName} onChange={event => setBusinessName(event.target.value)} required maxLength={160} />}
        <Input type="email" placeholder="Email" value={email} onChange={event => setEmail(event.target.value)} readOnly={emailLocked} required />
        {emailLocked && <p className="-mt-2 text-xs text-black/50">L’adresse est définie par l’invitation.</p>}
        <Input type="password" placeholder="Mot de passe" minLength={8} value={password} onChange={event => setPassword(event.target.value)} required />
        {guided && <p className="text-xs text-black/50">Votre nom est prérempli par l’invitant et reste modifiable avant validation.</p>}
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <Button className="w-full" disabled={saving || !accountType || !name.trim() || !email.trim() || (accountType === 'contractor' && !effectiveBusinessName)}>{saving ? 'Création…' : 'Créer mon compte'}</Button>
      </form>}
      <p className="mt-5 text-sm text-black/60">Déjà inscrit ? <Link className="font-semibold text-teal" href={returnTo ? `/auth/login?returnTo=${encodeURIComponent(returnTo)}` : "/auth/login"}>Se connecter</Link></p>
    </Card>
  </main>;
}
