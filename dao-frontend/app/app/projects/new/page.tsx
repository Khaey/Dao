'use client';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '../../../../lib/supabase-browser';
import { Button, Card, Input } from '../../../../components/ui';

export default function NewProject() {
  const router = useRouter();
  const [type, setType] = useState('renovation');
  const [surface, setSurface] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('');
    const supabase = supabaseBrowser();
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) { router.push('/auth/login'); return; }
    const governorate = await supabase.from('governorates').select('id').limit(1).single();
    if (governorate.error) { setError('Territoire indisponible.'); setSaving(false); return; }
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ project_type: type, surface_m2: surface ? Number(surface) : null, desired_start_date: date || null, governorate_id: governorate.data.id }),
    });
    const { data, error: responseError } = await response.json();
    if (!response.ok || !data?.id) { setError(responseError || 'Impossible de créer le projet.'); setSaving(false); return; }
    router.push(`/app/projects/${data.id}`);
  }

  return <section className="mx-auto max-w-2xl"><p className="text-sm font-semibold text-teal">Nouveau projet</p><h1 className="mt-1 text-3xl font-bold">Décrivons votre chantier</h1><Card className="mt-8"><form onSubmit={submit} className="space-y-5"><label className="block text-sm font-semibold">Type de projet<select className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3.5 py-3" value={type} onChange={(event) => setType(event.target.value)}><option value="renovation">Rénovation</option><option value="construction">Construction</option><option value="repair">Réparation</option><option value="extension">Extension</option></select></label><label className="block text-sm font-semibold">Surface (m²)<Input type="number" min="1" value={surface} onChange={(event) => setSurface(event.target.value)} placeholder="Ex. 180" /></label><label className="block text-sm font-semibold">Date souhaitée<Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>{error && <p className="text-sm text-red-600" role="alert">{error}</p>}<Button disabled={saving}>{saving ? 'Enregistrement…' : 'Continuer vers les demandes'}</Button></form></Card></section>;
}
