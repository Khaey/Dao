'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
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
  return <main className="min-h-screen px-5 py-10 sm:py-16"><div className="mx-auto max-w-2xl space-y-6"><Link href="/" className="text-xl font-bold">D.A.O<span className="text-clay">.</span></Link><Card>
    <p className="text-xs font-bold uppercase tracking-wide text-teal">Invitation au chantier</p>
    {loading ? <p className="mt-5" role="status">Chargement de l’invitation…</p> : declined ? <><h1 className="mt-3 text-2xl font-bold">Invitation refusée</h1><p role="status" className="mt-4 text-sm text-black/60">Vous n’avez pas rejoint ce chantier.</p><Link href="/app/projects" className="mt-5 inline-flex min-h-10 items-center font-semibold text-teal">Mes chantiers</Link></> : !preview ? <><h1 className="mt-3 text-2xl font-bold">Invitation indisponible</h1><p className="mt-4 text-sm text-black/60">Ce lien est invalide, expiré, révoqué ou a déjà été utilisé. Demandez une nouvelle invitation à l’initiateur du chantier.</p></> : <>
      <h1 className="mt-3 text-3xl font-bold">{preview.title}</h1><Badge>{expectedLabel}</Badge><dl className="mt-6 space-y-4 text-sm"><div><dt className="text-black/45">Entreprise / artisan ou initiateur</dt><dd className="mt-1 font-semibold">{preview.inviter_name}</dd></div><div><dt className="text-black/45">Localisation</dt><dd className="mt-1 font-semibold">{preview.location || 'À préciser'}</dd></div><div><dt className="text-black/45">Avancement déclaré</dt><dd className="mt-1 font-semibold">{stageLabels[preview.project_stage]}</dd></div>{preview.payment_status !== 'not_set' && <div><dt className="text-black/45">Situation du paiement</dt><dd className="mt-1 font-semibold">{paymentLabels[preview.payment_status]}</dd></div>}</dl>{preview.description && <p className="mt-5 whitespace-pre-wrap text-sm text-black/60">{preview.description}</p>}{preview.lots.length > 0 && <div className="mt-5"><h2 className="font-semibold">Lots / travaux</h2><ul className="mt-3 space-y-2">{preview.lots.map((lot, index) => <li key={index} className="rounded-xl bg-sand p-3 text-sm"><p className="font-semibold">{lot.title}</p><p className="mt-1 whitespace-pre-wrap text-black/60">{lot.scope}</p></li>)}</ul></div>}
      {!signedIn ? <div className="mt-6 space-y-3"><p className="text-sm text-black/55">Connectez-vous avec un compte {expectedLabel} pour confirmer cette invitation.</p><div className="flex flex-wrap gap-3"><Link href={`/auth/login${authQuery}`} className="inline-flex min-h-10 items-center rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white">Se connecter</Link><Link href={`/auth/register${authQuery}`} className="inline-flex min-h-10 items-center rounded-xl px-4 py-2.5 text-sm font-semibold text-teal">Créer un compte</Link></div></div> : !roles.includes(preview.expected_role) ? <div className="mt-6 rounded-xl bg-amber-50 p-4"><p role="alert" className="text-sm text-amber-900">Cette invitation nécessite un compte {expectedLabel}. Votre compte actuel n’a pas ce type. Aucun rôle ne sera modifié.</p><Button className="mt-4" onClick={async () => { await supabaseBrowser().auth.signOut(); router.push(`/auth/login${authQuery}`); }}>Se connecter avec un autre compte</Button></div> : <div className="mt-6 flex flex-wrap gap-3"><Button disabled={saving} onClick={() => void respond(true)}>{saving ? 'Confirmation…' : 'Confirmer et rejoindre le chantier'}</Button><Button disabled={saving} className="bg-white text-ink ring-1 ring-black/10 hover:bg-sand" onClick={() => void respond(false)}>Refuser</Button></div>}
    </>}{error && <p role="alert" className="mt-5 text-sm text-red-700">{error}</p>}
  </Card></div></main>;
}
