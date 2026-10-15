'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabaseBrowser } from '../../../lib/supabase-browser';
import { Button, Input } from '../../../components/ui';
import { invitationReturn } from '../../../lib/collaboration';
import { isStaffOnly, type AppRole } from '../../../lib/roles';

const focus = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
const focusDark = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';

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
          <Link href="/" className={`rounded-lg px-3 py-2 text-sm font-semibold text-ink/75 transition hover:bg-ink/5 hover:text-ink motion-reduce:transition-none ${focus}`}>
            Retour à l’accueil <span aria-hidden="true">↗</span>
          </Link>
        </header>

        <div className="grid flex-1 items-center gap-10 py-8 lg:grid-cols-[1.02fr_.98fr] lg:gap-16 lg:py-14">
          {/* Panneau de marque (desktop) : même langage que le hero de l’accueil (teal, grille de plan, lots). */}
          <section className="relative hidden min-h-[570px] overflow-hidden rounded-[2rem] bg-teal p-10 text-white shadow-[0_24px_70px_rgba(15,118,110,.22)] lg:flex lg:flex-col lg:justify-between">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-20" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.7) 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
            <div className="relative">
              <p className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-4 py-2 text-xs font-semibold tracking-wide text-white">
                <span className="h-2 w-2 rounded-full bg-white" aria-hidden="true" />
                Votre espace chantier
              </p>
              <h2 className="mt-10 max-w-md text-5xl font-bold leading-[1.15] tracking-tight">
                Vos projets avancent. <span className="text-[#ffd9c2]">Vous gardez le cap.</span>
              </h2>
              <p className="mt-6 max-w-sm text-base leading-8 text-white/90">
                Projets, offres et échanges réunis dans un espace pensé pour travailler ensemble, étape par étape.
              </p>
            </div>
            <div className="relative rounded-2xl border border-white/25 bg-white/10 p-5" aria-label="Les trois étapes d’un projet D.A.O">
              <p className="mb-5 text-xs font-bold uppercase tracking-[.18em] text-white/85">Un parcours plus clair</p>
              <ol className="grid grid-cols-3 gap-3">
                {['Décrire', 'Comparer', 'Suivre'].map((step, index) => (
                  <li key={step} className="min-w-0">
                    <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-white text-sm font-bold text-teal">{index + 1}</span>
                    <span className="text-sm font-semibold text-white">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section aria-labelledby="login-title" className="mx-auto w-full max-w-[440px] py-2 lg:py-0">
            {/* Bandeau de marque (mobile et tablette) : le panneau ci-dessus est masqué sous lg. */}
            <div className="relative mb-8 overflow-hidden rounded-2xl bg-teal px-5 py-4 text-white lg:hidden">
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-20" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.7) 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
              <p className="relative text-xs font-semibold uppercase tracking-[.18em] text-white/90">Votre espace chantier</p>
              <p className="relative mt-1 text-base font-semibold leading-snug">Décrire, comparer, suivre : tout au même endroit.</p>
            </div>

            <div className="mb-8">
              <p className="text-xs font-bold uppercase tracking-[.2em] text-teal">Connexion</p>
              <h1 id="login-title" className="mt-3 text-4xl font-bold tracking-tight sm:text-[2.75rem]">Heureux de vous revoir.</h1>
              <p className="mt-4 leading-7 text-ink/70">Retrouvez votre espace D.A.O et reprenez vos projets là où vous en étiez. Clients, artisans et entreprises se connectent ici.</p>
            </div>

            <form onSubmit={submit} className="space-y-5 rounded-[1.75rem] border border-ink/10 border-t-4 border-t-teal bg-white p-6 shadow-[0_20px_60px_rgba(23,32,42,.07)] sm:p-8">
              <div>
                <label htmlFor="dao-login-email" className="mb-2 block text-sm font-semibold text-ink">Adresse e-mail</label>
                <Input id="dao-login-email" type="email" autoComplete="email" placeholder="Votre email" value={email} onChange={e => setEmail(e.target.value)} required className="min-h-12" />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label htmlFor="dao-login-password" className="text-sm font-semibold text-ink">Mot de passe</label>
                  <Link className={`rounded-sm text-xs font-semibold text-teal underline-offset-2 hover:underline ${focus}`} href="/auth/forgot-password">Mot de passe oublié ?</Link>
                </div>
                <Input id="dao-login-password" type="password" autoComplete="current-password" placeholder="Mot de passe" value={password} onChange={e => setPassword(e.target.value)} required className="min-h-12" />
              </div>
              {error && <p role="alert" aria-live="polite" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{error}</p>}
              <Button className="min-h-12 w-full text-base">Se connecter <span aria-hidden="true" className="ml-2">→</span></Button>
            </form>

            <p className="mt-7 text-center text-sm text-ink/70">
              Vous découvrez D.A.O ?{' '}
              <Link className={`font-bold text-teal underline-offset-2 hover:underline ${focus}`} href={returnTo ? `/auth/register?returnTo=${encodeURIComponent(returnTo)}` : '/auth/register'}>
                Créer un compte
              </Link>
            </p>
            <p className="mt-10 text-center text-xs leading-6 text-ink/65">D.A.O · Une meilleure façon d’organiser vos travaux.</p>
          </section>
        </div>
      </div>
    </main>
  );
}
