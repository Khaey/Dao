'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Building2, CheckCircle2, CircleSlash, Layers, MapPin, Wallet, Gauge } from 'lucide-react';
import { Badge, Button, Card } from '../../../components/ui';
import { paymentLabels, projectApi, stageLabels } from '../../../lib/collaboration';
import { supabaseBrowser } from '../../../lib/supabase-browser';

type Preview = { project_id: string; title: string; description: string; inviter_name: string; location: string; expected_role: 'client' | 'contractor'; project_stage: string; payment_status: string; lots: { title: string; scope: string }[] };
export default function ProjectInvitation() {
  const { token } = useParams<{ token: string }>(); const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null); const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false); const [roles, setRoles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [declined, setDeclined] = useState(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const summary = /^[a-f0-9]{64}$/.test(token) ? await projectApi<Preview | null>('/api/projects/invitations/preview', { token }, true) : null;
        const { data } = await supabaseBrowser().auth.getSession();
        const roleRows = data.session ? await supabaseBrowser().from('user_roles').select('role').eq('user_id', data.session.user.id) : null;
        if (active) { setPreview(summary); setSignedIn(Boolean(data.session)); setRoles((roleRows?.data ?? []).map(row => row.role)); }
      } catch { if (active) setError('Impossible de charger cette invitation.'); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [token]);
  async function respond(accept: boolean) {
    setSaving(true); setError('');
    try {
      const id = await projectApi<string>('/api/projects/invitations/respond', { token, accept });
      if (accept) router.push(`/app/projects/${id}`); else setDeclined(true);
    } catch (exception: any) { setError(exception.message); } finally { setSaving(false); }
  }
  const returnTo = `/invite/${token}`;
  const authQuery = `?returnTo=${encodeURIComponent(returnTo)}`;
  const expectedLabel = preview?.expected_role === 'client' ? 'Client' : 'Artisan / Entreprise';
  const fact = (Icon: typeof MapPin, label: string, value: string) => <div className="flex gap-3 rounded-2xl bg-sand/70 p-4">
    <Icon aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-teal" />
    <div className="min-w-0"><dt className="text-xs font-semibold uppercase tracking-wide text-black/45">{label}</dt><dd className="mt-1 break-words font-semibold text-ink">{value}</dd></div>
  </div>;
  return <main className="min-h-screen bg-gradient-to-b from-sand/60 to-transparent px-4 py-8 sm:py-14"><div className="mx-auto max-w-2xl space-y-6">
    <Link href="/" className="inline-block text-xl font-bold">D.A.O<span className="text-clay">.</span></Link>
    <Card className="p-6 sm:p-9">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal">Invitation au chantier</p>
      {loading ? <div className="mt-5 space-y-3" role="status" aria-label="Chargement de l’invitation"><div className="h-8 w-2/3 animate-pulse rounded-xl bg-black/5" /><div className="h-24 animate-pulse rounded-2xl bg-black/5" /><span className="sr-only">Chargement de l’invitation…</span></div>
      : declined ? <div className="mt-4 space-y-3"><CircleSlash aria-hidden="true" size={28} className="text-black/30" /><h1 className="text-2xl font-bold tracking-tight">Invitation refusée</h1><p role="status" className="text-sm text-black/60">Vous n’avez pas rejoint ce chantier.</p><Link href="/app/projects" className="inline-flex min-h-11 items-center font-semibold text-teal">Mes chantiers</Link></div>
      : !preview ? <div className="mt-4 space-y-3"><CircleSlash aria-hidden="true" size={28} className="text-black/30" /><h1 className="text-2xl font-bold tracking-tight">Invitation indisponible</h1><p className="text-sm leading-relaxed text-black/60">Ce lien est invalide, expiré, révoqué ou a déjà été utilisé. Demandez une nouvelle invitation à l’initiateur du chantier.</p></div>
      : <>
        <h1 className="mt-3 break-words text-3xl font-bold tracking-tight sm:text-4xl">{preview.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2"><Badge tone="teal">{expectedLabel}</Badge><span className="text-sm text-black/55">Invité par <b className="font-semibold text-ink">{preview.inviter_name}</b></span></div>
        <dl className="mt-7 grid gap-3 sm:grid-cols-2">
          {fact(Building2, 'Entreprise / artisan ou initiateur', preview.inviter_name)}
          {fact(MapPin, 'Localisation', preview.location || 'À préciser')}
          {fact(Gauge, 'Avancement déclaré', stageLabels[preview.project_stage] ?? preview.project_stage)}
          {preview.payment_status !== 'not_set' && fact(Wallet, 'Situation du paiement', paymentLabels[preview.payment_status] ?? preview.payment_status)}
        </dl>
        {preview.description && <p className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-black/65">{preview.description}</p>}
        {preview.lots.length > 0 && <div className="mt-7"><h2 className="flex items-center gap-2 font-bold"><Layers aria-hidden="true" size={17} className="text-teal" />Lots / travaux</h2><ul className="mt-3 space-y-2">{preview.lots.map((lot, index) => <li key={index} className="rounded-2xl border border-black/5 p-4 text-sm"><p className="font-semibold text-ink">{lot.title}</p><p className="mt-1 whitespace-pre-wrap text-black/60">{lot.scope}</p></li>)}</ul></div>}
        <div className="mt-8 border-t border-black/5 pt-6">
        {!signedIn ? <div className="space-y-4"><p className="text-sm text-black/60">Connectez-vous avec un compte {expectedLabel} pour confirmer cette invitation.</p><div className="flex flex-col gap-2 sm:flex-row"><Link href={`/auth/login${authQuery}`} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-ink px-5 text-sm font-semibold text-white transition hover:bg-teal">Se connecter</Link><Link href={`/auth/register${authQuery}`} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-black/10 px-5 text-sm font-semibold text-teal transition hover:border-teal">Créer un compte</Link></div></div>
        : !roles.includes(preview.expected_role) ? <div className="rounded-2xl bg-amber-50 p-4"><p role="alert" className="text-sm text-amber-900">Cette invitation nécessite un compte {expectedLabel}. Votre compte actuel n’a pas ce type. Aucun rôle ne sera modifié.</p><Button className="mt-4 min-h-11" onClick={async () => { await supabaseBrowser().auth.signOut(); router.push(`/auth/login${authQuery}`); }}>Se connecter avec un autre compte</Button></div>
        : <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start"><Button className="min-h-11 gap-2 px-5" disabled={saving} onClick={() => void respond(true)}><CheckCircle2 aria-hidden="true" size={17} />{saving ? 'Confirmation…' : 'Confirmer et rejoindre le chantier'}</Button><Button disabled={saving} className="min-h-11 bg-white text-ink ring-1 ring-black/10 hover:bg-sand" onClick={() => void respond(false)}>Refuser</Button></div>}
        </div>
      </>}
      {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    </Card>
  </div></main>;
}
