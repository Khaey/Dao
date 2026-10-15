'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabaseBrowser } from '../../../lib/supabase-browser';
import { Button, Input } from '../../../components/ui';
import { invitationReturn } from '../../../lib/collaboration';
import { isStaffOnly, type AppRole } from '../../../lib/roles';

const focus = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';

export default function Login() {
  const [returnTo, setReturnTo] = useState<string | null>(null);
  useEffect(() => setReturnTo(invitationReturn(window.location.search)), []);
  const r = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      return;
    }
    if (returnTo) {
      r.push(returnTo);
      return;
    }
    const { data: roleRows } = await supabase.from('user_roles').select('role').eq('user_id', data.user.id);
    const roles = (roleRows ?? []).map(row => row.role as AppRole);
    r.push(isStaffOnly(roles) ? '/app/dao' : '/app');
  }

  return (
    <main className="min-h-screen bg-sand text-ink">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-5 py-6 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" aria-label="D.A.O, accueil" className={`rounded-md text-xl font-bold tracking-tight ${focus}`}>
            D.A.O<span className="text-clay" aria-hidden="true">.</span>
          </Link>
          <Link href="/" className={`rounded-lg px-3 py-2 text-sm font-semibold text-ink/70 transition hover:bg-ink/5 hover:text-ink ${focus}`}>
            Retour à l’accueil <span aria-hidden="true">↗</span>
          </Link>
        </header>

        <div className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[1.02fr_.98fr] lg:gap-16 lg:py-14">
          <section className="relative hidden min-h-[570px] overflow-hidden rounded-[2rem] bg-ink p-10 text-white shadow-[0_24px_70px_rgba(23,32,42,.13)] lg:flex lg:flex-col lg:justify-between">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[.13]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.7) 1px, transparent 1px)', backgroundSize: '36px 36px' }} />
            <div className="relative">
              <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold tracking-wide text-white/90">
                <span className="h-2 w-2 rounded-full bg-clay" aria-hidden="true" />
                Votre espace chantier
              </p>
              <h2 className="mt-10 max-w-md text-5xl font-bold leading-[1.15] tracking-tight">
                Vos projets avancent. <span className="text-[#e9a379]">Vous gardez le cap.</span>
              </h2>
              <p className="mt-6 max-w-sm text-base leading-8 text-white/70">
                Projets, offres et échanges réunis dans un espace pensé pour travailler ensemble, étape par étape.
              </p>
            </div>
            <div className="relative rounded-2xl border border-white/15 bg-white/10 p-5 backdrop-blur-sm" aria-label="Les trois étapes d’un projet D.A.O">
              <p className="mb-5 text-xs font-bold uppercase tracking-[.18em] text-white/60">Un parcours plus clair</p>
              <ol className="grid grid-cols-3 gap-3">
                {['Décrire', 'Comparer', 'Suivre'].map((step, index) => (
                  <li key={step} className="min-w-0">
                    <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 text-sm font-bold text-white">{index + 1}</span>
                    <span className="text-sm font-medium text-white/90">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section aria-labelledby="login-title" className="mx-auto w-full max-w-[440px] py-6 lg:py-0">
            <div className="mb-8">
              <p className="text-xs font-bold uppercase tracking-[.2em] text-teal">Connexion sécurisée</p>
              <h1 id="login-title" className="mt-3 text-4xl font-bold tracking-tight sm:text-[2.75rem]">Heureux de vous revoir.</h1>
              <p className="mt-4 leading-7 text-ink/65">Retrouvez votre espace D.A.O et reprenez vos projets là où vous en étiez.</p>
            </div>

            <form onSubmit={submit} className="space-y-5 rounded-[1.75rem] border border-ink/10 bg-white p-6 shadow-[0_20px_60px_rgba(23,32,42,.07)] sm:p-8">
              <div>
                <label htmlFor="dao-login-email" className="mb-2 block text-sm font-semibold text-ink">Adresse e-mail</label>
                <Input id="dao-login-email" type="email" autoComplete="email" placeholder="vous@exemple.com" value={email} onChange={e => setEmail(e.target.value)} required className="min-h-12" />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label htmlFor="dao-login-password" className="text-sm font-semibold text-ink">Mot de passe</label>
                  <Link className={`rounded-sm text-xs font-semibold text-teal hover:underline ${focus}`} href="/auth/forgot-password">Mot de passe oublié ?</Link>
                </div>
                <Input id="dao-login-password" type="password" autoComplete="current-password" placeholder="Votre mot de passe" value={password} onChange={e => setPassword(e.target.value)} required className="min-h-12" />
              </div>
              {error && <p role="alert" aria-live="polite" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
              <Button className="min-h-12 w-full text-base">Se connecter <span aria-hidden="true" className="ml-2">→</span></Button>
            </form>

            <p className="mt-7 text-center text-sm text-ink/65">
              Vous découvrez D.A.O ?{' '}
              <Link className={`font-bold text-teal hover:underline ${focus}`} href={returnTo ? `/auth/register?returnTo=${encodeURIComponent(returnTo)}` : '/auth/register'}>
                Créer un compte
              </Link>
            </p>
            <p className="mt-10 text-center text-xs leading-6 text-ink/45">D.A.O · Une meilleure façon d’organiser vos travaux.</p>
          </section>
        </div>
      </div>
    </main>
  );
}
