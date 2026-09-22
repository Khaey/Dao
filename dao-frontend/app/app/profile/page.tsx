'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '../../../lib/supabase-browser';
import { Badge, Button, Card, Input } from '../../../components/ui';

type RoleRow = { role: string };
type ProjectRow = { status: string | null };

const roleLabels: Record<string, string> = {
  client: 'Espace client',
  contractor: 'Espace artisan',
  dao_reviewer: 'Revue DAO',
  dao_admin: 'Administration DAO',
};

const roleDescriptions: Record<string, string> = {
  client: 'Préparez vos projets et suivez vos demandes de travaux.',
  contractor: 'Consultez les DAO accessibles et envoyez vos offres.',
  dao_reviewer: 'Contrôlez les dossiers avant leur publication.',
  dao_admin: 'Gérez la plateforme et les accès DAO.',
};

const roleOrder = ['client', 'contractor', 'dao_reviewer', 'dao_admin'];

function readError(body: unknown, fallback: string) {
  return body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
    ? body.error
    : fallback;
}

export default function Profile() {
  const router = useRouter();
  const [user, setUser] = useState<{ email?: string | null } | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [error, setError] = useState('');
  const [activityError, setActivityError] = useState('');
  const [success, setSuccess] = useState('');
  const [securityMessage, setSecurityMessage] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    const supabase = supabaseBrowser();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setUser(null);
      setLoading(false);
      return;
    }

    const currentUser = userData.user;
    setUser(currentUser);

    const [profileResult, contactResult, roleResult, projectResult] = await Promise.all([
      supabase.from('profiles').select('display_name').eq('user_id', currentUser.id).maybeSingle(),
      supabase.from('profile_contacts').select('phone_e164,contact_email').eq('user_id', currentUser.id).maybeSingle(),
      supabase.from('user_roles').select('role').eq('user_id', currentUser.id),
      supabase.from('projects').select('status').order('created_at', { ascending: false }),
    ]);

    if (profileResult.error || contactResult.error || roleResult.error) {
      setError('Impossible de charger toutes les informations de votre espace.');
    }
    setActivityError(projectResult.error ? 'Votre activité sera disponible dès que la session sera actualisée.' : '');
    setName(profileResult.data?.display_name ?? currentUser.email?.split('@')[0] ?? '');
    setPhone(contactResult.data?.phone_e164 ?? '');
    setRoles((roleResult.data ?? []).map((row: RoleRow) => row.role));
    setProjects(projectResult.data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    const { data } = await supabaseBrowser().auth.getSession();
    if (!data.session) {
      setError('Session expirée. Reconnectez-vous.');
      setSaving(false);
      return;
    }

    const response = await fetch('/api/profile', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + data.session.access_token,
      },
      body: JSON.stringify({ display_name: name.trim(), phone_e164: phone.trim() || null }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(readError(body, 'Impossible de mettre à jour le profil.'));
    } else {
      setSuccess('Profil mis à jour.');
      await load();
    }
    setSaving(false);
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setSecurityMessage('');
    setError('');
    if (password.length < 8) {
      setError('Le nouveau mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    if (password !== passwordConfirmation) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }

    setPasswordSaving(true);
    const { error: updateError } = await supabaseBrowser().auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message || 'Impossible de changer le mot de passe.');
    } else {
      setPassword('');
      setPasswordConfirmation('');
      setSecurityMessage('Mot de passe mis à jour.');
    }
    setPasswordSaving(false);
  }

  async function signOut() {
    const { error: signOutError } = await supabaseBrowser().auth.signOut();
    if (signOutError) {
      setError('Impossible de vous déconnecter. Réessayez.');
      return;
    }
    router.replace('/auth/login');
  }

  const activity = useMemo(() => {
    const count = (statuses: string[]) => projects.filter(project => project.status && statuses.includes(project.status)).length;
    return {
      total: projects.length,
      drafts: count(['draft']),
      review: count(['client_review', 'dao_review']),
      published: count(['open', 'published']),
      archived: count(['archived', 'closed']),
    };
  }, [projects]);

  const completion = useMemo(() => {
    const fields = [
      Boolean(user?.email),
      Boolean(name.trim()),
      Boolean(phone.match(/^\+216[0-9]{8}$/)),
      roles.length > 0,
    ];
    return Math.round((fields.filter(Boolean).length / fields.length) * 100);
  }, [name, phone, roles, user?.email]);

  if (loading) return <p>Chargement de votre espace…</p>;
  if (!user) return <p role="alert">Session expirée. Reconnectez-vous.</p>;

  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-sm font-semibold text-teal">Mon espace</p>
        <h1 className="mt-1 text-3xl font-bold">Votre espace D.A.O</h1>
        <p className="mt-2 max-w-2xl text-black/60">Retrouvez votre identité, vos espaces et les raccourcis utiles au quotidien.</p>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>}
      {success && <p className="rounded-xl bg-teal/10 px-4 py-3 text-sm text-teal" role="status">{success}</p>}

      <div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-black/45">Identité</p>
              <h2 className="mt-1 text-xl font-semibold">{name || 'Votre profil'}</h2>
              <p className="mt-1 text-sm text-black/60">{user.email}</p>
            </div>
            <div className="rounded-2xl bg-teal/10 px-3 py-2 text-right">
              <p className="text-xs text-teal">Profil complété</p>
              <p className="text-2xl font-bold text-teal">{completion}%</p>
            </div>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-sand/70 p-3">
              <p className="text-xs text-black/45">Nom affiché</p>
              <p className="mt-1 font-medium">{name || 'À compléter'}</p>
            </div>
            <div className="rounded-xl bg-sand/70 p-3">
              <p className="text-xs text-black/45">Téléphone</p>
              <p className="mt-1 font-medium">{phone || 'À compléter'}</p>
            </div>
          </div>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-black/5" aria-label="Complétude du profil">
            <div className="h-full rounded-full bg-teal transition-all" style={{ width: completion + '%' }} />
          </div>
        </Card>

        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-black/45">Espaces disponibles</p>
          <div className="mt-4 space-y-3">
            {roleOrder.filter(role => roles.includes(role)).map(role => (
              <div key={role} className="flex items-start gap-3 rounded-xl border border-black/5 p-3">
                <Badge>{roleLabels[role] ?? role}</Badge>
                <p className="text-sm text-black/60">{roleDescriptions[role] ?? 'Espace D.A.O disponible.'}</p>
              </div>
            ))}
            {roles.length === 0 && <p className="text-sm text-black/50">Aucun espace n’est encore attribué.</p>}
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-black/45">Accès rapides</p>
            <h2 className="mt-1 text-xl font-semibold">Continuer votre parcours</h2>
          </div>
          <span className="text-xs text-black/45">{roles.length} espace{roles.length > 1 ? 's' : ''} actif{roles.length > 1 ? 's' : ''}</span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {roles.includes('client') && <Link href="/app/projects" className="rounded-xl border border-black/10 p-4 transition hover:-translate-y-0.5 hover:border-teal"><p className="font-semibold">Mes projets</p><p className="mt-1 text-sm text-black/55">Suivre vos chantiers et vos lots.</p></Link>}
          {roles.includes('client') && <Link href="/app/projects/new" className="rounded-xl border border-black/10 p-4 transition hover:-translate-y-0.5 hover:border-teal"><p className="font-semibold">Nouveau projet</p><p className="mt-1 text-sm text-black/55">Préparer un nouveau DAO.</p></Link>}
          {roles.includes('contractor') && <Link href="/app/artisan" className="rounded-xl border border-black/10 p-4 transition hover:-translate-y-0.5 hover:border-teal"><p className="font-semibold">Espace artisan</p><p className="mt-1 text-sm text-black/55">Voir les DAO qui vous concernent.</p></Link>}
          {(roles.includes('dao_reviewer') || roles.includes('dao_admin')) && <Link href="/app/dao/review" className="rounded-xl border border-black/10 p-4 transition hover:-translate-y-0.5 hover:border-teal"><p className="font-semibold">Revue DAO</p><p className="mt-1 text-sm text-black/55">Traiter les dossiers à contrôler.</p></Link>}
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-black/45">Activité client</p>
            <h2 className="mt-1 text-xl font-semibold">Vos projets en un coup d’œil</h2>
          </div>
          <Link href="/app/projects" className="text-sm font-semibold text-teal">Voir tous les projets</Link>
        </div>
        {activityError ? <p className="mt-4 text-sm text-black/50">{activityError}</p> : <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            ['Projets', activity.total],
            ['Brouillons', activity.drafts],
            ['En revue', activity.review],
            ['Publiés / ouverts', activity.published],
            ['Archivés', activity.archived],
          ].map(([label, value]) => <div key={label} className="rounded-xl bg-sand/70 p-3"><p className="text-xs text-black/45">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></div>)}
        </div>}
      </Card>

      <Card>
        <p className="text-xs font-semibold uppercase tracking-wide text-black/45">Modifier vos informations</p>
        <h2 className="mt-1 text-xl font-semibold">Identité publique</h2>
        <form onSubmit={save} className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold">Nom affiché<Input aria-label="Nom affiché" value={name} onChange={event => setName(event.target.value)} required /></label>
          <label className="block text-sm font-semibold">Téléphone tunisien<Input aria-label="Téléphone tunisien" placeholder="+216XXXXXXXX" value={phone} onChange={event => setPhone(event.target.value)} pattern="\\+216[0-9]{8}" /></label>
          <div className="sm:col-span-2"><Button disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer les informations'}</Button></div>
        </form>
      </Card>

      <Card>
        <p className="text-xs font-semibold uppercase tracking-wide text-black/45">Sécurité</p>
        <h2 className="mt-1 text-xl font-semibold">Protéger votre compte</h2>
        <form onSubmit={changePassword} className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold">Nouveau mot de passe<Input aria-label="Nouveau mot de passe" type="password" minLength={8} value={password} onChange={event => setPassword(event.target.value)} required /></label>
          <label className="block text-sm font-semibold">Confirmer le mot de passe<Input aria-label="Confirmer le mot de passe" type="password" minLength={8} value={passwordConfirmation} onChange={event => setPasswordConfirmation(event.target.value)} required /></label>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button disabled={passwordSaving}>{passwordSaving ? 'Mise à jour…' : 'Changer le mot de passe'}</Button>
            <Button type="button" className="bg-white text-ink ring-1 ring-black/10 hover:bg-sand" onClick={() => void signOut()}>Se déconnecter</Button>
            {securityMessage && <p className="text-sm text-teal" role="status">{securityMessage}</p>}
          </div>
        </form>
        <p className="mt-4 text-xs text-black/45">Déconnectez-vous après une utilisation sur un appareil partagé.</p>
      </Card>
    </section>
  );
}
