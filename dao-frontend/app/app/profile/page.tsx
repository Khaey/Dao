'use client';

import { FormEvent, useEffect, useState } from 'react';
import { supabaseBrowser } from '../../../lib/supabase-browser';
import { Badge, Button, Card, Input } from '../../../components/ui';

const roleLabels: Record<string, string> = {
  client: 'Client',
  contractor: 'Artisan',
  dao_reviewer: 'Relecteur DAO',
  dao_admin: 'Administrateur DAO',
};

export default function Profile() {
  const [user, setUser] = useState<any>();
  const [profile, setProfile] = useState<any>();
  const [contact, setContact] = useState<any>();
  const [roles, setRoles] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function load() {
    setLoading(true);
    const supabase = supabaseBrowser();
    const { data: userData } = await supabase.auth.getUser();
    const currentUser = userData.user;
    setUser(currentUser);
    if (!currentUser) { setLoading(false); return; }
    const [profileResult, contactResult, roleResult] = await Promise.all([
      supabase.from('profiles').select('display_name').eq('user_id', currentUser.id).maybeSingle(),
      supabase.from('profile_contacts').select('phone_e164,contact_email').eq('user_id', currentUser.id).maybeSingle(),
      supabase.from('user_roles').select('role').eq('user_id', currentUser.id),
    ]);
    setProfile(profileResult.data);
    setContact(contactResult.data);
    setName(profileResult.data?.display_name ?? currentUser.email?.split('@')[0] ?? '');
    setPhone(contactResult.data?.phone_e164 ?? '');
    setRoles((roleResult.data ?? []).map((row: { role: string }) => row.role));
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError(''); setSuccess('');
    const { data } = await supabaseBrowser().auth.getSession();
    if (!data.session) { setError('Session expirée.'); setSaving(false); return; }
    const response = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token },
      body: JSON.stringify({ display_name: name, phone_e164: phone || null }),
    });
    const body = await response.json();
    if (!response.ok) setError(body.error ?? 'Impossible de mettre à jour le profil.');
    else { setSuccess('Profil mis à jour.'); await load(); }
    setSaving(false);
  }

  if (loading) return <p>Chargement de votre espace…</p>;
  if (!user) return <p role="alert">Session expirée. Reconnectez-vous.</p>;

  return <section className="mx-auto max-w-3xl space-y-6">
    <div><p className="text-sm font-semibold text-teal">Mon espace</p><h1 className="mt-1 text-3xl font-bold">Profil et rôles</h1><p className="mt-2 text-black/60">Un seul compte peut porter plusieurs espaces D.A.O.</p></div>
    <Card>
      <p className="text-xs uppercase tracking-wide text-black/45">Compte</p>
      <p className="mt-1 font-semibold">{user.email}</p>
      <p className="mt-5 text-xs uppercase tracking-wide text-black/45">Espaces disponibles</p>
      <div className="mt-2 flex flex-wrap gap-2">{roles.map(role => <Badge key={role}>{roleLabels[role] ?? role}</Badge>)}</div>
    </Card>
    <Card>
      <h2 className="font-semibold">Informations publiques</h2>
      <form onSubmit={save} className="mt-5 space-y-4">
        <label className="block text-sm font-semibold">Nom affiché<Input aria-label="Nom affiché" value={name} onChange={event => setName(event.target.value)} required /></label>
        <label className="block text-sm font-semibold">Téléphone tunisien<Input aria-label="Téléphone tunisien" placeholder="+216XXXXXXXX" value={phone} onChange={event => setPhone(event.target.value)} pattern="\\+216[0-9]{8}" /></label>
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        {success && <p className="text-sm text-teal" role="status">{success}</p>}
        <Button disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</Button>
      </form>
    </Card>
    <p className="text-xs text-black/45">Votre email est utilisé uniquement pour la connexion et les notifications du service.</p>
  </section>;
}
