'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { Button, Card, Input } from './ui';
import { supabaseBrowser } from '../lib/supabase-browser';
import { paymentLabels, projectApi, stageLabels } from '../lib/collaboration';
import InvitationEmailButton, { PreparedInvitation } from './InvitationEmailButton';

export default function CollaborativeProjectForm({ contractor }: { contractor: boolean }) {
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState(''); const [description, setDescription] = useState('');
  const [governorate, setGovernorate] = useState(''); const [territories, setTerritories] = useState<{ id: string; name_fr: string }[]>([]);
  const [stage, setStage] = useState('not_started'); const [payment, setPayment] = useState('not_set');
  const [email, setEmail] = useState(''); const [privateAccess, setPrivateAccess] = useState(false);
  const [projectId, setProjectId] = useState(''); const [link, setLink] = useState('');
  const [invitation, setInvitation] = useState<PreparedInvitation | null>(null);
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false); const [copied, setCopied] = useState(false);
  useEffect(() => { void supabaseBrowser().from('governorates').select('id,name_fr').order('name_fr').then(({ data }) => setTerritories(data ?? [])); }, []);
  function next(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!title.trim() || !governorate) { setError('Renseignez le titre et la localisation du chantier.'); return; }
    setStep(value => value + 1);
  }
  async function create(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      // Keep the created id if issuing the invitation fails; retrying must
      // never create a duplicate project.
      const id = projectId || (await projectApi('/api/projects', {
        project_origin: contractor ? 'contractor_existing_client' : 'client_existing_team',
        title: title.trim(), description: description.trim(), governorate_id: governorate,
        project_stage: stage, payment_status: payment,
      })).id;
      setProjectId(id);
      const invite = await projectApi('/api/projects/invitations', {
        project_id: id, expected_role: contractor ? 'client' : 'contractor',
        recipient_email: email.trim() || null, can_view_private_details: !contractor && privateAccess,
      });
      setLink(`${window.location.origin}/invite/${invite.token}`);
      setInvitation({ id: invite.id, token: invite.token, hasEmail: Boolean(email.trim()) });
    } catch (exception: any) { setError(exception.message); } finally { setSaving(false); }
  }
  const selectClass = 'mt-2 w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm focus:border-teal focus:ring-4 focus:ring-teal/10';
  return <section className="mx-auto max-w-2xl space-y-6">
    <div><p className="text-xs font-bold uppercase tracking-wide text-teal">Nouveau chantier</p><h1 className="mt-2 text-3xl font-bold">{contractor ? 'Ajouter un chantier client' : 'Créer un chantier avec mon équipe'}</h1><p className="mt-2 text-sm text-black/55">Suivez vos travaux ensemble. Les lots, documents et autres participants se complètent ensuite.</p></div>
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">{['Chantier', 'État', contractor ? 'Client' : 'Équipe', 'Invitation'].map((label, index) => <li key={label} className={`rounded-xl border p-3 text-sm font-semibold ${step === index + 1 ? 'border-teal bg-teal/5' : 'border-black/10 bg-white'}`}>{index + 1}. {label}</li>)}</ol>
    <Card>{link ? <div className="space-y-4"><h2 className="text-xl font-bold">Invitation au chantier prête</h2><p role="status" className="text-sm text-teal">{contractor ? 'Client à confirmer' : 'Chantier créé. Votre professionnel doit accepter l’invitation.'}</p><p className="text-sm text-black/60">Envoyez ce lien à {contractor ? 'votre client' : 'votre artisan ou entreprise'}. Il expire dans sept jours et ne peut être utilisé qu’une fois.</p><label className="block text-sm font-semibold">Lien d’invitation<Input aria-label="Lien d’invitation" value={link} readOnly /></label><div className="flex flex-wrap gap-3"><Button onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setError('Sélectionnez et copiez le lien ci-dessus.'); } }}>{copied ? 'Lien copié' : 'Copier le lien'}</Button>{invitation && <InvitationEmailButton key={invitation.id} invitation={invitation} />}<Link href={`/app/projects/${projectId}?tab=team`} className="inline-flex min-h-10 items-center rounded-xl px-4 py-2 text-sm font-semibold text-teal">Ouvrir le chantier</Link></div></div> : <form onSubmit={step === 4 ? create : next} className="space-y-5">
      <p className="text-xs font-semibold text-black/45">Étape {step} sur 4</p>
      {step === 1 && <><label className="block text-sm font-semibold">Titre du chantier<Input aria-label="Titre du chantier" required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></label><label className="block text-sm font-semibold">Description courte<textarea aria-label="Description courte" className={`${selectClass} min-h-24`} value={description} onChange={event => setDescription(event.target.value)} /></label><label className="block text-sm font-semibold">Localisation<select aria-label="Localisation" className={selectClass} required value={governorate} onChange={event => setGovernorate(event.target.value)}><option value="">Choisir un gouvernorat</option>{territories.map(item => <option key={item.id} value={item.id}>{item.name_fr}</option>)}</select></label><p className="text-xs text-black/50">Seul le territoire sera affiché dans l’invitation. L’adresse exacte reste privée.</p></>}
      {step === 2 && <><fieldset className="space-y-2"><legend className="mb-3 font-semibold">Quel est l’avancement actuel du chantier ?</legend>{Object.entries(stageLabels).map(([value, label]) => <label key={value} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${stage === value ? 'border-teal bg-teal/5' : 'border-black/10'}`}><input type="radio" name="stage" value={value} checked={stage === value} onChange={() => setStage(value)} className="accent-teal" />{label}</label>)}</fieldset><label className="block text-sm font-semibold">Situation du paiement — optionnel<select aria-label="Situation du paiement — optionnel" className={selectClass} value={payment} onChange={event => setPayment(event.target.value)}>{Object.entries(paymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><p className="text-xs text-black/50">Information déclarative, sans effet sur les travaux ni sur le DAO.</p></>}
      {step === 3 && <><h2 className="text-xl font-bold">{contractor ? 'Inviter votre client' : 'Inviter un artisan ou une entreprise'}</h2><label className="block text-sm font-semibold">Email du destinataire — optionnel<Input aria-label="Email du destinataire — optionnel" type="email" value={email} onChange={event => setEmail(event.target.value)} /></label><p className="text-sm text-black/55">Avec un email, seul le compte correspondant pourra accepter. Sinon, transmettez le lien directement à la personne concernée.</p>{!contractor && <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={privateAccess} onChange={event => setPrivateAccess(event.target.checked)} className="mt-1 accent-teal" />Autoriser l’accès aux coordonnées privées du chantier</label>}</>}
      {step === 4 && <><h2 className="text-xl font-bold">Créer et préparer l’invitation</h2><dl className="space-y-3 rounded-xl bg-sand p-4 text-sm"><div><dt className="text-black/45">Chantier</dt><dd className="font-semibold">{title}</dd></div><div><dt className="text-black/45">Avancement déclaré</dt><dd>{stageLabels[stage]}</dd></div><div><dt className="text-black/45">Situation du paiement</dt><dd>{paymentLabels[payment]}</dd></div><div><dt className="text-black/45">Destinataire</dt><dd>{email || 'Lien à transmettre directement'}</dd></div></dl><p className="text-sm text-black/55">{contractor ? 'Le client confirmera le chantier avant de le rejoindre.' : 'Le professionnel rejoindra votre équipe après acceptation.'} Aucune publication DAO n’est créée automatiquement.</p></>}
      <div className="flex flex-wrap justify-between gap-3 border-t border-black/5 pt-4">{step > 1 ? <Button type="button" disabled={saving || Boolean(projectId)} className="bg-white text-ink ring-1 ring-black/10 hover:bg-sand" onClick={() => { setError(''); setStep(value => value - 1); }}>Précédent</Button> : <span />}<Button disabled={saving}>{saving ? 'Création…' : step === 4 ? 'Créer et préparer l’invitation' : 'Continuer'}</Button></div>
    </form>}{error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}</Card>
  </section>;
}
