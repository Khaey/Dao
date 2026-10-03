'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { Button, Card, Input } from './ui';
import { supabaseBrowser } from '../lib/supabase-browser';
import { paymentLabels, projectApi, stageLabels } from '../lib/collaboration';
import InvitationEmailButton, { PreparedInvitation } from './InvitationEmailButton';

type Trade = { id: string; name_fr: string };
type ArtisanDraft = {
  key: number;
  recipientName: string;
  email: string;
  tradeId: string;
  lotTitle: string;
  budget: string;
};
type TeamInvitation = PreparedInvitation & {
  recipientName: string;
  email: string;
  lotTitle: string;
  requestId: string;
  link: string;
};

const moneyToMillimes = (value: string) => value.trim() === '' ? null : Math.round(Number(value) * 1000);

export default function CollaborativeProjectForm({ contractor }: { contractor: boolean }) {
  const nextArtisanKey = useRef(2);
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState(''); const [description, setDescription] = useState('');
  const [governorate, setGovernorate] = useState(''); const [territories, setTerritories] = useState<{ id: string; name_fr: string }[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stage, setStage] = useState('not_started'); const [payment, setPayment] = useState('not_set');
  const [recipientName, setRecipientName] = useState(''); const [email, setEmail] = useState(''); const [privateAccess, setPrivateAccess] = useState(false);
  const [artisans, setArtisans] = useState<ArtisanDraft[]>([{ key: 1, recipientName: '', email: '', tradeId: '', lotTitle: '', budget: '' }]);
  const [projectId, setProjectId] = useState(''); const [link, setLink] = useState('');
  const [invitation, setInvitation] = useState<PreparedInvitation | null>(null);
  const [teamInvitations, setTeamInvitations] = useState<TeamInvitation[]>([]);
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false); const [copiedInvitationId, setCopiedInvitationId] = useState('');

  useEffect(() => {
    const supabase = supabaseBrowser();
    void Promise.all([
      supabase.from('governorates').select('id,name_fr').order('name_fr'),
      supabase.from('trades').select('id,name_fr').eq('active', true).order('name_fr'),
    ]).then(([territoryResult, tradeResult]) => {
      setTerritories(territoryResult.data ?? []);
      setTrades(tradeResult.data ?? []);
    });
  }, []);

  function updateArtisan(key: number, patch: Partial<ArtisanDraft>) {
    setArtisans(current => current.map(item => item.key === key ? { ...item, ...patch } : item));
  }

  function addArtisan() {
    setArtisans(current => [...current, {
      key: nextArtisanKey.current++,
      recipientName: '',
      email: '',
      tradeId: '',
      lotTitle: '',
      budget: '',
    }]);
  }

  function removeArtisan(key: number) {
    setArtisans(current => current.length === 1 ? current : current.filter(item => item.key !== key));
  }

  function validateTeam() {
    if (artisans.length < 1) return 'Ajoutez au moins un artisan et son lot principal.';
    const emails = new Set<string>();
    for (const [index, artisan] of artisans.entries()) {
      const number = index + 1;
      if (!artisan.recipientName.trim()) return `Renseignez le nom de l’artisan ${number}.`;
      if (!artisan.email.trim()) return `Renseignez l’email de l’artisan ${number}.`;
      if (!artisan.tradeId) return `Choisissez le métier de l’artisan ${number}.`;
      if (!artisan.lotTitle.trim()) return `Renseignez le titre du lot principal de l’artisan ${number}.`;
      if (artisan.budget.trim() && (!Number.isFinite(Number(artisan.budget)) || Number(artisan.budget) < 0)) {
        return `Le budget du lot ${number} est invalide.`;
      }
      const normalizedEmail = artisan.email.trim().toLowerCase();
      if (emails.has(normalizedEmail)) return 'Chaque artisan doit avoir une adresse e-mail différente. Pour une entreprise multi-lots, invitez-la sur son lot principal puis ajoutez les autres lots après son acceptation.';
      emails.add(normalizedEmail);
    }
    return '';
  }

  function next(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!title.trim() || !governorate) { setError('Renseignez le titre et la localisation du chantier.'); return; }
    if (step === 3) {
      if (contractor) {
        if (!recipientName.trim()) { setError('Renseignez le nom du client.'); return; }
        if (email.trim() && !recipientName.trim()) { setError('Renseignez le nom du destinataire avec son email.'); return; }
      } else {
        const teamError = validateTeam();
        if (teamError) { setError(teamError); return; }
      }
    }
    setStep(value => value + 1);
  }

  async function create(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setCopied(false); setCopiedInvitationId('');
    try {
      if (!contractor) {
        const teamError = validateTeam();
        if (teamError) throw new Error(teamError);
        const result = await projectApi<{ id: string; invitations: any[] }>('/api/projects', {
          project_origin: 'client_existing_team',
          title: title.trim(),
          description: description.trim(),
          governorate_id: governorate,
          project_stage: stage,
          payment_status: payment,
          team: artisans.map(item => ({
            recipient_name: item.recipientName.trim(),
            recipient_email: item.email.trim().toLowerCase(),
            trade_id: item.tradeId,
            lot_title: item.lotTitle.trim(),
            budget_millimes: moneyToMillimes(item.budget),
            can_view_private_details: privateAccess,
          })),
        });
        setProjectId(result.id);
        setTeamInvitations((result.invitations ?? []).map(item => ({
          id: item.id,
          token: item.token,
          hasEmail: true,
          recipientName: item.recipient_name,
          email: item.recipient_email,
          lotTitle: item.lot_title,
          requestId: item.request_id,
          link: `${window.location.origin}/invite/${item.token}`,
        })));
        return;
      }

      // Keep the created id if issuing the client invitation fails; retrying
      // must never create a duplicate contractor-created project.
      const id = projectId || (await projectApi('/api/projects', {
        project_origin: 'contractor_existing_client',
        title: title.trim(), description: description.trim(), governorate_id: governorate,
        project_stage: stage, payment_status: payment,
      })).id;
      setProjectId(id);
      const invite = await projectApi('/api/projects/invitations', {
        project_id: id,
        expected_role: 'client',
        recipient_email: email.trim() || null,
        recipient_name: recipientName.trim() || null,
        can_view_private_details: true,
      });
      setLink(`${window.location.origin}/invite/${invite.token}`);
      setInvitation({ id: invite.id, token: invite.token, hasEmail: Boolean(email.trim()) });
    } catch (exception: any) {
      setError(exception.message);
    } finally {
      setSaving(false);
    }
  }

  const selectClass = 'mt-2 w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm focus:border-teal focus:ring-4 focus:ring-teal/10';
  const completed = contractor ? Boolean(link) : teamInvitations.length > 0;

  return <section className="mx-auto max-w-3xl space-y-6">
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-teal">Nouveau chantier</p>
      <h1 className="mt-2 text-3xl font-bold">{contractor ? 'Ajouter un chantier client' : 'Créer un chantier avec mon équipe'}</h1>
      <p className="mt-2 text-sm text-black/55">{contractor ? 'Créez le chantier puis invitez votre client à le confirmer.' : 'Préparez en une fois le chantier, les lots principaux et les invitations de votre équipe.'}</p>
    </div>

    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {['Chantier', 'État', contractor ? 'Client' : 'Artisans + lots', 'Récapitulatif'].map((label, index) => <li key={label} className={`rounded-xl border p-3 text-sm font-semibold ${step === index + 1 ? 'border-teal bg-teal/5' : 'border-black/10 bg-white'}`}>{index + 1}. {label}</li>)}
    </ol>

    <Card>
      {completed ? contractor ? <div className="space-y-4">
        <h2 className="text-xl font-bold">Invitation au chantier prête</h2>
        <p role="status" className="text-sm text-teal">Client à confirmer</p>
        <p className="text-sm text-black/60">Envoyez ce lien à votre client. Il expire dans sept jours et ne peut être utilisé qu’une fois.</p>
        <label className="block text-sm font-semibold">Lien d’invitation<Input aria-label="Lien d’invitation" value={link} readOnly /></label>
        <div className="flex flex-wrap gap-3">
          <Button onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setError('Sélectionnez et copiez le lien ci-dessus.'); } }}>{copied ? 'Lien copié' : 'Copier le lien'}</Button>
          {invitation && <InvitationEmailButton key={invitation.id} invitation={invitation} />}
          <Link href={`/app/projects/${projectId}?tab=team`} className="inline-flex min-h-10 items-center rounded-xl px-4 py-2 text-sm font-semibold text-teal">Ouvrir le chantier</Link>
        </div>
      </div> : <div className="space-y-5">
        <div>
          <h2 className="text-xl font-bold">Chantier et invitations prêts</h2>
          <p role="status" className="mt-1 text-sm text-teal">{teamInvitations.length} artisan{teamInvitations.length > 1 ? 's' : ''} · {teamInvitations.length} lot{teamInvitations.length > 1 ? 's' : ''} principal{teamInvitations.length > 1 ? 'aux' : ''}</p>
          <p className="mt-2 text-sm text-black/60">Chaque artisan rejoindra automatiquement son lot principal après acceptation. Vous pourrez ensuite lui rattacher d’autres lots depuis le chantier.</p>
        </div>
        <div className="space-y-4">
          {teamInvitations.map((item, index) => <article key={item.id} className="rounded-2xl border border-black/10 bg-sand/50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-teal">Artisan {index + 1}</p>
                <h3 className="mt-1 font-bold">{item.recipientName}</h3>
                <p className="text-sm text-black/55">{item.email}</p>
                <p className="mt-2 text-sm"><span className="text-black/45">Lot principal :</span> <strong>{item.lotTitle}</strong></p>
              </div>
              <InvitationEmailButton invitation={{ id: item.id, token: item.token, hasEmail: true }} />
            </div>
            <label className="mt-4 block text-xs font-semibold text-black/55">Lien d’invitation<Input aria-label={`Lien d’invitation de ${item.recipientName}`} value={item.link} readOnly /></label>
            <Button className="mt-3 bg-white text-ink ring-1 ring-black/10 hover:bg-white" onClick={async () => { try { await navigator.clipboard.writeText(item.link); setCopiedInvitationId(item.id); } catch { setError('Sélectionnez et copiez le lien ci-dessus.'); } }}>{copiedInvitationId === item.id ? 'Lien copié' : 'Copier le lien'}</Button>
          </article>)}
        </div>
        <Link href={`/app/projects/${projectId}?tab=team`} className="inline-flex min-h-10 items-center rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white">Ouvrir le chantier</Link>
      </div> : <form onSubmit={step === 4 ? create : next} className="space-y-5">
        <p className="text-xs font-semibold text-black/45">Étape {step} sur 4</p>

        {step === 1 && <>
          <label className="block text-sm font-semibold">Titre du chantier<Input aria-label="Titre du chantier" required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></label>
          <label className="block text-sm font-semibold">Description courte<textarea aria-label="Description courte" className={`${selectClass} min-h-24`} value={description} onChange={event => setDescription(event.target.value)} /></label>
          <label className="block text-sm font-semibold">Localisation<select aria-label="Localisation" className={selectClass} required value={governorate} onChange={event => setGovernorate(event.target.value)}><option value="">Choisir un gouvernorat</option>{territories.map(item => <option key={item.id} value={item.id}>{item.name_fr}</option>)}</select></label>
          <p className="text-xs text-black/50">Seul le territoire sera affiché dans l’invitation. L’adresse exacte reste privée.</p>
        </>}

        {step === 2 && <>
          <fieldset className="space-y-2"><legend className="mb-3 font-semibold">Quel est l’avancement actuel du chantier ?</legend>{Object.entries(stageLabels).map(([value, label]) => <label key={value} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${stage === value ? 'border-teal bg-teal/5' : 'border-black/10'}`}><input type="radio" name="stage" value={value} checked={stage === value} onChange={() => setStage(value)} className="accent-teal" />{label}</label>)}</fieldset>
          <label className="block text-sm font-semibold">Situation du paiement — optionnel<select aria-label="Situation du paiement — optionnel" className={selectClass} value={payment} onChange={event => setPayment(event.target.value)}>{Object.entries(paymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <p className="text-xs text-black/50">Information déclarative, sans effet sur les travaux ni sur le DAO.</p>
        </>}

        {step === 3 && contractor ? <>
          <h2 className="text-xl font-bold">Inviter votre client</h2>
          <label className="block text-sm font-semibold">Nom du client<Input aria-label="Nom du destinataire" value={recipientName} onChange={event => setRecipientName(event.target.value)} maxLength={160} required /></label>
          <label className="block text-sm font-semibold">Email du destinataire — optionnel<Input aria-label="Email du destinataire — optionnel" type="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
          <p className="text-sm text-black/55">Avec un email, le nom prépare l’inscription et seul le compte correspondant pourra accepter.</p>
        </> : step === 3 ? <>
          <div>
            <h2 className="text-xl font-bold">Votre équipe et ses lots principaux</h2>
            <p className="mt-2 text-sm text-black/55"><strong>1 artisan = 1 lot principal.</strong> Si une entreprise réalise plusieurs lots, indiquez ici son lot principal puis rattachez-lui les autres lots après son acceptation.</p>
          </div>

          <div className="space-y-4">
            {artisans.map((artisan, index) => <article key={artisan.key} className="rounded-2xl border border-black/10 p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div><p className="text-xs font-bold uppercase tracking-wide text-teal">Artisan {index + 1}</p><p className="mt-1 text-sm text-black/50">Coordonnées + lot principal</p></div>
                {artisans.length > 1 && <button type="button" className="text-sm font-semibold text-red-600" onClick={() => removeArtisan(artisan.key)}>Retirer</button>}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-semibold">Nom de l’artisan / entreprise<Input aria-label={`Nom de l’artisan ${index + 1}`} value={artisan.recipientName} onChange={event => updateArtisan(artisan.key, { recipientName: event.target.value })} maxLength={160} required /></label>
                <label className="block text-sm font-semibold">Email<Input aria-label={`Email de l’artisan ${index + 1}`} type="email" value={artisan.email} onChange={event => updateArtisan(artisan.key, { email: event.target.value })} required /></label>
                <label className="block text-sm font-semibold">Métier<select aria-label={`Métier de l’artisan ${index + 1}`} className={selectClass} value={artisan.tradeId} onChange={event => updateArtisan(artisan.key, { tradeId: event.target.value })} required><option value="">Choisir un métier</option>{trades.map(item => <option key={item.id} value={item.id}>{item.name_fr}</option>)}</select></label>
                <label className="block text-sm font-semibold">Titre du lot principal<Input aria-label={`Titre du lot de l’artisan ${index + 1}`} placeholder="Ex. Plomberie sanitaire" value={artisan.lotTitle} onChange={event => updateArtisan(artisan.key, { lotTitle: event.target.value })} maxLength={200} required /></label>
                <label className="block text-sm font-semibold sm:col-span-2">Budget indicatif du lot (TND) — optionnel<Input aria-label={`Budget du lot de l’artisan ${index + 1}`} type="number" min="0" step="0.001" value={artisan.budget} onChange={event => updateArtisan(artisan.key, { budget: event.target.value })} /></label>
              </div>
            </article>)}
          </div>

          <Button type="button" className="bg-white text-ink ring-1 ring-black/10 hover:bg-sand" onClick={addArtisan}>+ Ajouter un autre artisan</Button>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={privateAccess} onChange={event => setPrivateAccess(event.target.checked)} className="mt-1 accent-teal" />Autoriser les professionnels invités à accéder aux coordonnées privées du chantier après acceptation</label>
        </> : null}

        {step === 4 && <>
          <h2 className="text-xl font-bold">{contractor ? 'Créer et préparer l’invitation' : 'Vérifier avant de créer le chantier'}</h2>
          <dl className="space-y-3 rounded-xl bg-sand p-4 text-sm">
            <div><dt className="text-black/45">Chantier</dt><dd className="font-semibold">{title}</dd></div>
            <div><dt className="text-black/45">Avancement déclaré</dt><dd>{stageLabels[stage]}</dd></div>
            <div><dt className="text-black/45">Situation du paiement</dt><dd>{paymentLabels[payment]}</dd></div>
            {contractor ? <div><dt className="text-black/45">Client</dt><dd>{recipientName}{email ? ` · ${email}` : ''}</dd></div> : <div><dt className="text-black/45">Équipe préparée</dt><dd className="mt-2 space-y-2">{artisans.map((artisan, index) => <span key={artisan.key} className="block rounded-lg bg-white/70 p-3"><strong>{index + 1}. {artisan.recipientName}</strong> · {trades.find(item => item.id === artisan.tradeId)?.name_fr || 'Métier'}<br/><span className="text-black/55">{artisan.lotTitle}{artisan.budget ? ` · ${artisan.budget} TND` : ''}</span></span>)}</dd></div>}
          </dl>
          <p className="text-sm text-black/55">{contractor ? 'Le client confirmera le chantier avant de le rejoindre.' : 'La création est atomique : le chantier, les lots principaux et les invitations sont préparés ensemble. Aucun DAO n’est publié automatiquement.'}</p>
        </>}

        <div className="flex flex-wrap justify-between gap-3 border-t border-black/5 pt-4">
          {step > 1 ? <Button type="button" disabled={saving || Boolean(projectId)} className="bg-white text-ink ring-1 ring-black/10 hover:bg-sand" onClick={() => { setError(''); setStep(value => value - 1); }}>Précédent</Button> : <span />}
          <Button disabled={saving}>{saving ? 'Création…' : step === 4 ? (contractor ? 'Créer et préparer l’invitation' : 'Créer le chantier et préparer les invitations') : 'Continuer'}</Button>
        </div>
      </form>}

      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </Card>
  </section>;
}
