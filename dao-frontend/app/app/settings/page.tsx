'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowRight, LockKeyhole, UserRound } from 'lucide-react';
import { Card } from '../../../components/ui';
import CounterOfferPreference from '../../../components/artisan/CounterOfferPreference';
import MyOptions from '../../../components/settings/MyOptions';
import { useMySettings } from '../../../lib/settings';
import { supabaseBrowser } from '../../../lib/supabase-browser';
import { type AppRole } from '../../../lib/roles';

export default function SettingsPage() {
  const router = useRouter();
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const settings = useMySettings(ready && (roles.includes('client') || roles.includes('contractor')) ? null : undefined);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const supabase = supabaseBrowser();
      const { data, error: userError } = await supabase.auth.getUser();
      if (!active) return;
      if (userError || !data.user) { router.replace('/auth/login'); return; }
      const result = await supabase.from('user_roles').select('role').eq('user_id', data.user.id);
      if (!active) return;
      if (result.error) setError('Vos raccourcis ne peuvent pas être chargés. Réessayez en actualisant la page.');
      else setRoles((result.data ?? []).map((row: { role: AppRole }) => row.role));
      setReady(true);
    };
    void load().catch(() => {
      if (active) setError('Impossible de charger vos paramètres. Réessayez en actualisant la page.');
    });
    return () => { active = false; };
  }, [router]);

  if (!ready) return error ? <p role="alert">{error}</p> : <p role="status">Chargement des paramètres…</p>;

  return <section className="mx-auto max-w-5xl space-y-6" aria-labelledby="settings-title">
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal">Mon espace</p>
      <h1 id="settings-title" className="mt-2 text-3xl font-bold tracking-tight">Paramètres</h1>
      <p className="mt-2 text-sm text-black/55">Un seul compte personnel pour tous vos espaces D.A.O.</p>
    </div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    <div className="grid gap-4 sm:grid-cols-2">
      {[
        { href: '/app/profile#identity', title: 'Mon compte et coordonnées', description: 'Consulter votre email et modifier votre nom affiché ou votre téléphone.', icon: UserRound },
        { href: '/app/profile#security', title: 'Sécurité du compte', description: 'Changer votre mot de passe et gérer votre connexion.', icon: LockKeyhole },
      ].map(({ href, title, description, icon: Icon }) => <Link key={href} href={href} className="rounded-2xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal/30">
        <Card className="h-full transition hover:border-teal/40">
          <Icon size={22} className="text-teal" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-bold">{title}</h2>
          <p className="mt-2 text-sm text-black/55">{description}</p>
          <ArrowRight size={18} className="mt-5 text-teal" aria-hidden="true" />
        </Card>
      </Link>)}
    </div>
    {roles.includes('contractor') && <CounterOfferPreference />}
    <MyOptions settings={settings} />
    {/* Spaces (dashboard, chantiers, dossier professionnel, Admin settings) live in the menu only: no duplicate shortcuts here. */}
    {roles.includes('client') && roles.includes('contractor') && <p className="text-sm text-black/55">Utilisez les boutons Client et Artisan du menu pour choisir votre espace. Vos coordonnées et votre mot de passe restent les mêmes.</p>}
  </section>;
}
