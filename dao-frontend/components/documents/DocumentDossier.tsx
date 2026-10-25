'use client';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Eye, FileText, FolderInput, History, Pencil, Search, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { cn } from '../../lib/utils';
import { projectApi } from '../../lib/collaboration';
import { ErrorPanel, fieldClass, Pill, primaryAction, secondaryAction } from '../../app/app/projects/_components/ProjectUi';
import DocumentPreview from './DocumentPreview';
import {
  categoryLabels, currentRevision, Dossier, dossierCommand, DossierFamily, eventLabels, formatDateTime, loadDossier, mimeLabels,
  ReviewAction, reviewLabels, reviewTones, roleLabels, signedDocumentUrl, uploadPrivateFile, Visibility, visibilityLabels, type Category,
} from './dossier-model';

export type LegacyDocument = { id: string; owner_id: string; share_scope: string; original_name: string; mime_type: string; size_bytes?: number; status: string; created_at?: string };

const iconButton = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-black/10 bg-white text-ink/65 transition hover:border-teal/40 hover:text-teal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal disabled:opacity-50';
const dangerIconButton = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-red-100 bg-white text-red-600 transition hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-50';
const linkButton = 'inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-teal hover:bg-sand focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal disabled:opacity-50';
const fileLabels: Record<string, string> = { approved: 'Validé', rejected: 'Refusé', quarantined: 'En attente de contrôle' };
const fileTones: Record<string, 'teal' | 'red' | 'clay'> = { approved: 'teal', rejected: 'red', quarantined: 'clay' };

type ClassifyDraft = { title: string; category: string; visibility: Visibility; lots: string[]; note: string };

/**
 * Dossier documentaire V2 (#456) : familles de documents versionnées, rattachement facultatif aux lots,
 * statut de revue technique et historique. Une revue technique n’est ni un visa juridique, ni une réception,
 * ni une signature, ni un déclencheur de paiement. Les droits restent vérifiés par la base (RPC + RLS).
 */
export default function DocumentDossier({ projectId, userId, mode = 'project', legacyDocuments, canUpload = false, onLegacyChanged, onMessage }: {
  projectId: string; userId: string; mode?: 'project' | 'lot'; legacyDocuments?: LegacyDocument[]; canUpload?: boolean;
  onLegacyChanged?: () => Promise<void> | void; onMessage?: (message: { error?: string; success?: string }) => void;
}) {
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; originalName: string; mimeType: string } | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [lot, setLot] = useState('');
  const [sort, setSort] = useState<'recent' | 'title'>('recent');
  const [classifying, setClassifying] = useState<LegacyDocument | null>(null);
  const notify = useCallback((message: { error?: string; success?: string }) => onMessage?.(message), [onMessage]);

  const refresh = useCallback(async () => {
    try { setDossier(await loadDossier(projectId)); setLoadError(''); }
    catch (exception: any) { setLoadError(exception.message ?? 'Dossier documentaire indisponible.'); }
  }, [projectId]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('request_id');
    if (requested && /^[0-9a-f-]{36}$/i.test(requested)) setLot(requested);
  }, []);

  async function run(label: string, action: () => Promise<unknown>, success: string) {
    setBusy(label); notify({});
    try { await action(); await refresh(); await onLegacyChanged?.(); notify({ success }); return true; }
    catch (exception: any) { notify({ error: exception.message ?? 'Action refusée.' }); await refresh(); return false; }
    finally { setBusy(null); }
  }

  const versionedIds = useMemo(() => new Set((dossier?.families ?? []).flatMap(family => family.revisions.map(revision => revision.document?.id).filter(Boolean) as string[])), [dossier]);
  const unclassified = (legacyDocuments ?? []).filter(document => !versionedIds.has(document.id));
  const lots = dossier?.lots ?? [];
  const families = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('fr');
    const list = (dossier?.families ?? []).filter(family =>
      (!category || family.category === category || (category === 'none' && !family.category))
      && (!lot || family.lots.some(link => link.requestId === lot))
      && (!needle || family.title.toLocaleLowerCase('fr').includes(needle)
        || family.revisions.some(revision => revision.document?.originalName.toLocaleLowerCase('fr').includes(needle))));
    return sort === 'title' ? [...list].sort((a, b) => a.title.localeCompare(b.title, 'fr')) : list;
  }, [dossier, query, category, lot, sort]);

  if (loadError && !dossier) return <div className="mt-5"><ErrorPanel title="Dossier documentaire indisponible" message={loadError} onRetry={() => void refresh()} /></div>;
  if (!dossier) return <p className="mt-5 text-sm text-ink/65" role="status">Chargement du dossier documentaire…</p>;

  const nothing = dossier.families.length === 0 && unclassified.length === 0;
  return <div className="mt-5 space-y-5">
    {preview && <DocumentPreview document={preview} onClose={() => setPreview(null)} />}
    {loadError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{loadError}</p>}
    {nothing ? <div className="rounded-xl border border-dashed border-black/15 px-6 py-10 text-center">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-sand text-ink/55"><FileText size={20} aria-hidden="true" /></span>
      <p className="mt-3 font-semibold text-ink">{mode === 'lot' ? 'Aucun plan partagé pour vos lots.' : 'Aucun document ajouté.'}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-ink/65">{mode === 'lot' ? 'Les plans et pièces techniques rattachés à vos lots apparaîtront ici dans leur version applicable.' : canUpload ? 'Ajoutez vos plans, photos ou devis : ils restent privés pendant le contrôle.' : 'Les documents partagés avec vous apparaîtront ici.'}</p>
    </div> : <>
      {dossier.families.length > 0 && <section aria-label="Plans et documents classés" className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
          <label className="relative block"><span className="sr-only">Rechercher un document</span><Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/45" /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Rechercher un plan…" className={cn(fieldClass, 'pl-9')} /></label>
          <select aria-label="Filtrer par catégorie" value={category} onChange={event => setCategory(event.target.value)} className={cn(fieldClass, 'sm:w-auto')}><option value="">Toutes catégories</option>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option value="none">Non précisée</option></select>
          {lots.length > 0 && <select aria-label="Filtrer par lot" value={lot} onChange={event => setLot(event.target.value)} className={cn(fieldClass, 'sm:w-auto')}><option value="">Tous les lots</option>{lots.map(item => <option key={item.id} value={item.id}>{item.title ?? 'Lot'}</option>)}</select>}
          <select aria-label="Trier les documents" value={sort} onChange={event => setSort(event.target.value as 'recent' | 'title')} className={cn(fieldClass, 'sm:w-auto')}><option value="recent">Plus récents</option><option value="title">Par intitulé</option></select>
        </div>
        {families.length === 0 ? <p className="rounded-xl bg-sand p-4 text-sm text-ink/70">Aucun document ne correspond à ces filtres.</p>
          : <ul className="space-y-3">{families.map(family => <FamilyCard key={family.id} family={family} dossier={dossier} userId={userId} projectId={projectId} busy={busy} run={run} onPreview={setPreview} />)}</ul>}
      </section>}
      {mode === 'project' && unclassified.length > 0 && <section aria-label="Documents non classés">
        {dossier.families.length > 0 && <h3 className="text-sm font-bold text-ink">Documents non classés</h3>}
        <ul className="mt-2 divide-y divide-black/[0.06]">{unclassified.map(document => <li key={document.id} data-testid="project-document-row" className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sand text-ink/60"><FileText size={18} aria-hidden="true" /></span><div className="min-w-0"><p className="break-all font-semibold text-ink">{document.original_name}</p><p className="mt-1 text-xs text-ink/65">{document.share_scope === 'project_members' ? 'Membres du chantier' : 'Moi uniquement'} · {mimeLabels[document.mime_type] ?? 'Fichier'}</p><Pill tone={fileTones[document.status] ?? 'clay'} className="mt-2">{fileLabels[document.status] ?? 'En attente de contrôle'}</Pill></div></div>
          <div className="flex flex-wrap items-center gap-2 pl-[3.25rem] sm:shrink-0 sm:pl-0">
            {document.owner_id === userId && <select aria-label={`Partage de ${document.original_name}`} className={cn(fieldClass, 'w-auto py-2 text-xs')} value={document.share_scope} onChange={event => void run('share-' + document.id, () => projectApi('/api/documents/project/sharing', { document_id: document.id, share_scope: event.target.value }), 'Partage mis à jour.')}><option value="owner_only">Moi uniquement</option><option value="project_members">Membres du chantier</option></select>}
            {document.owner_id === userId && canUpload && document.status !== 'rejected' && <button type="button" onClick={() => setClassifying(document)} className={linkButton}><FolderInput size={15} aria-hidden="true" />Classer</button>}
            {dossier.actor.canControlFiles && document.status === 'quarantined' && <FileControl documentId={document.id} name={document.original_name} busy={busy} run={run} />}
            <button type="button" aria-label="Consulter" title="Consulter" onClick={() => void signedDocumentUrl(document.id).then(url => window.open(url, '_blank', 'noopener,noreferrer')).catch(exception => notify({ error: exception.message }))} className={cn(iconButton, 'text-teal')}><Eye size={16} aria-hidden="true" /></button>
            {document.owner_id === userId && <button type="button" aria-label="Retirer" title="Retirer" onClick={() => { if (window.confirm('Retirer ce document ?')) void run('delete-' + document.id, () => projectApi('/api/documents/project/delete', { document_id: document.id }), 'Document retiré.'); }} className={dangerIconButton}><Trash2 size={16} aria-hidden="true" /></button>}
          </div>
          {classifying?.id === document.id && <ClassifyForm document={document} lots={lots} busy={busy === 'classify'} onCancel={() => setClassifying(null)} onSubmit={async draft => {
            const ok = await run('classify', () => dossierCommand({ action: 'create_family', project_id: projectId, document_id: document.id, title: draft.title, category: draft.category || null, visibility: draft.visibility, request_ids: draft.visibility === 'lots' ? draft.lots : [], note: draft.note || null }), 'Document classé : version V1 enregistrée.');
            if (ok) setClassifying(null);
          }} />}
        </li>)}</ul>
      </section>}
    </>}
    {dossier.families.length > 0 && <p className="text-xs text-ink/55">Une revue technique D.A.O. est une information de suivi : elle ne vaut ni visa juridique, ni réception, ni acceptation contractuelle, ni paiement.</p>}
  </div>;
}

function ClassifyForm({ document, lots, busy, onCancel, onSubmit, initial, submitLabel = 'Classer en V1' }: {
  document?: LegacyDocument; lots: Dossier['lots']; busy: boolean; onCancel: () => void; onSubmit: (draft: ClassifyDraft) => void; initial?: ClassifyDraft; submitLabel?: string;
}) {
  const sharedWithMembers = document?.share_scope === 'project_members';
  const [draft, setDraft] = useState<ClassifyDraft>(initial ?? { title: (document?.original_name ?? '').replace(/\.[a-z0-9]+$/i, ''), category: '', visibility: sharedWithMembers ? 'project' : 'private', lots: [], note: '' });
  function submit(event: FormEvent) { event.preventDefault(); onSubmit(draft); }
  return <form onSubmit={submit} aria-label="Classer le document" className="w-full space-y-3 rounded-xl bg-sand p-4 sm:basis-full">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm font-semibold text-ink">Intitulé<input required maxLength={160} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} className={cn(fieldClass, 'mt-1')} /></label>
      <label className="block text-sm font-semibold text-ink">Catégorie (facultative)<select value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value })} className={cn(fieldClass, 'mt-1')}><option value="">Non précisée</option>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="block text-sm font-semibold text-ink">Visibilité<select value={draft.visibility} disabled={sharedWithMembers} onChange={event => setDraft({ ...draft, visibility: event.target.value as Visibility })} className={cn(fieldClass, 'mt-1 disabled:bg-white/60')}>{Object.entries(visibilityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{sharedWithMembers && <span className="mt-1 block text-xs font-normal text-ink/65">Déjà partagé avec les membres : la visibilité ne peut pas être réduite.</span>}</label>
      {!initial && <label className="block text-sm font-semibold text-ink">Note (facultative)<input maxLength={1000} value={draft.note} onChange={event => setDraft({ ...draft, note: event.target.value })} className={cn(fieldClass, 'mt-1')} /></label>}
    </div>
    {draft.visibility === 'lots' && <fieldset><legend className="text-sm font-semibold text-ink">Lots concernés</legend>
      {lots.length === 0 ? <p className="mt-1 text-xs text-ink/65">Aucun lot disponible.</p> : <div className="mt-2 flex flex-wrap gap-2">{lots.map(item => <label key={item.id} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-3 text-sm"><input type="checkbox" checked={draft.lots.includes(item.id)} onChange={event => setDraft({ ...draft, lots: event.target.checked ? [...draft.lots, item.id] : draft.lots.filter(id => id !== item.id) })} />{item.title ?? 'Lot'}</label>)}</div>}
      <p className="mt-1 text-xs text-ink/65">Visible par le Client et par le titulaire actif de chaque lot coché, seulement après contrôle du fichier.</p>
    </fieldset>}
    <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy || !draft.title.trim() || (draft.visibility === 'lots' && draft.lots.length === 0)} className={primaryAction}>{busy ? 'Enregistrement…' : submitLabel}</button><button type="button" onClick={onCancel} className={secondaryAction}>Annuler</button></div>
  </form>;
}

function FileControl({ documentId, name, busy, run }: { documentId: string; name: string; busy: string | null; run: (label: string, action: () => Promise<unknown>, success: string) => Promise<boolean> }) {
  return <span className="inline-flex flex-wrap gap-1">
    <button type="button" disabled={busy !== null} aria-label={`Valider le fichier ${name}`} onClick={() => void run('control', () => dossierCommand({ action: 'control_file', document_id: documentId, decision: 'approved' }), 'Fichier contrôlé : il devient consultable selon son partage.')} className={linkButton}><ShieldCheck size={15} aria-hidden="true" />Valider le fichier</button>
    <button type="button" disabled={busy !== null} aria-label={`Refuser le fichier ${name}`} onClick={() => { const reason = window.prompt('Motif du refus du fichier'); if (reason?.trim()) void run('control', () => dossierCommand({ action: 'control_file', document_id: documentId, decision: 'rejected', note: reason }), 'Fichier refusé.'); }} className={cn(linkButton, 'text-red-700')}>Refuser</button>
  </span>;
}

function FamilyCard({ family, dossier, userId, projectId, busy, run, onPreview }: {
  family: DossierFamily; dossier: Dossier; userId: string; projectId: string; busy: string | null;
  run: (label: string, action: () => Promise<unknown>, success: string) => Promise<boolean>;
  onPreview: (document: { id: string; originalName: string; mimeType: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const current = currentRevision(family);
  // The newest revision may still be in file control: readers keep the latest controlled one.
  const applicable = family.revisions.find(revision => revision.document?.status === 'approved' || (revision.document && revision.isCurrent)) ?? null;
  // Never a self-review; a visa only applies to the current, controlled file.
  const reviewable = dossier.actor.canReview && current.createdBy !== userId && current.document?.status === 'approved';
  const lotNames = family.lots.map(link => link.title ?? 'Lot').join(', ');
  async function review(action: ReviewAction, success: string) {
    const ok = await run('review-' + family.id, () => dossierCommand({ action, revision_id: current.id, note: reviewNote.trim() || null }), success);
    if (ok) setReviewNote('');
  }
  async function addRevision(file: File) {
    await run('revision-' + family.id, async () => {
      const document = await uploadPrivateFile(projectId, file);
      await dossierCommand({ action: 'add_revision', family_id: family.id, document_id: document.id, expected_revision_id: family.currentRevisionId });
    }, `Version V${family.currentRevisionNo + 1} déposée : elle remplace la précédente après contrôle du fichier.`);
  }
  return <li data-testid="document-family" className="rounded-xl border border-black/[0.08] bg-white p-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sand text-ink/60"><FileText size={18} aria-hidden="true" /></span>
        <div className="min-w-0">
          <p className="break-words font-semibold text-ink">{family.title}</p>
          <p className="mt-1 text-xs text-ink/65">{family.category ? categoryLabels[family.category as Category] : 'Catégorie non précisée'} · {visibilityLabels[family.visibility]}{lotNames ? ` · ${lotNames}` : ''}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Pill tone="neutral">V{current.revisionNo} courante</Pill>
            <Pill tone={reviewTones[current.reviewStatus]}>{reviewLabels[current.reviewStatus]}</Pill>
            {current.correctionRequested && current.isCurrent && <Pill tone="red">Correction demandée</Pill>}
            {current.fileStatus !== 'approved' && <Pill tone={fileTones[current.fileStatus] ?? 'clay'}>{current.fileStatus === 'rejected' ? 'Fichier refusé' : 'Fichier en contrôle'}</Pill>}
          </div>
          <p className="mt-2 text-xs text-ink/55">Dernière modification {formatDateTime(family.updatedAt)}{current.createdByName ? ` · V${current.revisionNo} par ${current.createdByName}` : ''}</p>
          {applicable && !applicable.isCurrent && <p className="mt-1 text-xs text-amber-800">La version V{current.revisionNo} est en contrôle : la V{applicable.revisionNo} reste affichée, marquée « Remplacé ».</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-[3.25rem] sm:shrink-0 sm:pl-0">
        {applicable?.document && <button type="button" aria-label={`Consulter ${family.title}`} title="Consulter" onClick={() => onPreview(applicable.document!)} className={cn(iconButton, 'text-teal')}><Eye size={16} aria-hidden="true" /></button>}
        {family.canAddRevision && <label className={cn(secondaryAction, 'cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-teal')}><Upload size={15} aria-hidden="true" />{busy === 'revision-' + family.id ? 'Envoi…' : 'Nouvelle version'}<input aria-label={`Nouvelle version de ${family.title}`} className="sr-only" type="file" accept=".pdf,image/jpeg,image/png,image/webp" disabled={busy !== null} onChange={event => { const file = event.target.files?.[0]; if (file) void addRevision(file); event.currentTarget.value = ''; }} /></label>}
        {family.isMine && family.canAddRevision && <button type="button" aria-label={`Modifier le classement de ${family.title}`} onClick={() => setEditing(!editing)} className={iconButton}><Pencil size={15} aria-hidden="true" /></button>}
      </div>
    </div>
    {editing && <div className="mt-3"><ClassifyForm lots={dossier.lots} busy={busy === 'edit-' + family.id} submitLabel="Enregistrer le classement" onCancel={() => setEditing(false)}
      initial={{ title: family.title, category: family.category ?? '', visibility: family.visibility, lots: family.lots.map(link => link.requestId), note: '' }}
      onSubmit={async draft => { const ok = await run('edit-' + family.id, () => dossierCommand({ action: 'update_family', family_id: family.id, expected_version: family.version, title: draft.title, category: draft.category || null, visibility: draft.visibility, request_ids: draft.visibility === 'lots' ? draft.lots : [] }), 'Classement mis à jour.'); if (ok) setEditing(false); }} /></div>}
    {dossier.actor.canControlFiles && current.fileStatus === 'quarantined' && current.document && <div className="mt-3"><FileControl documentId={current.document.id} name={current.document.originalName} busy={busy} run={run} /></div>}
    <div className="mt-3 space-y-2 rounded-xl bg-sand/70 p-3">
      <label className="block text-xs font-semibold text-ink">{reviewable ? 'Observation ou commentaire sur la version courante' : 'Commentaire sur la version courante'}<textarea value={reviewNote} maxLength={2000} rows={2} onChange={event => setReviewNote(event.target.value)} className={cn(fieldClass, 'mt-1 min-h-0 text-sm')} /></label>
      <div className="flex flex-wrap gap-1">
        <button type="button" disabled={busy !== null || !reviewNote.trim()} onClick={() => void review('comment', 'Commentaire ajouté.')} className={linkButton}>Commenter</button>
        {reviewable && <>
          {current.reviewStatus === 'to_review' && <button type="button" disabled={busy !== null} onClick={() => void review('start_review', 'Revue démarrée.')} className={linkButton}>Démarrer la revue</button>}
          <button type="button" disabled={busy !== null || !reviewNote.trim()} onClick={() => void review('observations', 'Observations émises.')} className={linkButton}>Émettre des observations</button>
          <button type="button" disabled={busy !== null || !reviewNote.trim()} onClick={() => void review('correction_requested', 'Nouvelle version demandée.')} className={linkButton}>Demander une correction</button>
          <button type="button" disabled={busy !== null} onClick={() => void review('reviewed', 'Version revue techniquement (sans effet juridique).')} className={linkButton}>Marquer « Revu techniquement »</button>
        </>}
      </div>
    </div>
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={cn(linkButton, 'mt-2 px-0')}><History size={15} aria-hidden="true" />Versions et historique ({family.revisions.length})<ChevronDown size={15} aria-hidden="true" className={open ? 'rotate-180' : ''} /></button>
    {open && <div className="mt-2 grid gap-4 border-t border-black/5 pt-3 lg:grid-cols-2">
      <ol aria-label={`Versions de ${family.title}`} className="space-y-2">{family.revisions.map(revision => <li key={revision.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-sand/60 px-3 py-2 text-sm">
        <span className="min-w-0"><strong>V{revision.revisionNo}</strong> · {revision.document?.originalName ?? 'Fichier non consultable'}<span className="block text-xs text-ink/60">{formatDateTime(revision.createdAt)}{revision.createdByName ? ` · ${revision.createdByName}` : ''}{revision.note ? ` · ${revision.note}` : ''}</span></span>
        <span className="flex items-center gap-1.5"><Pill tone={reviewTones[revision.reviewStatus]}>{reviewLabels[revision.reviewStatus]}</Pill>{revision.document && <button type="button" aria-label={`Consulter V${revision.revisionNo} de ${family.title}`} onClick={() => onPreview(revision.document!)} className={cn(iconButton, 'h-9 w-9 text-teal')}><Eye size={14} aria-hidden="true" /></button>}</span>
      </li>)}</ol>
      <ol aria-label={`Historique de ${family.title}`} className="space-y-2">{family.events.map(event => {
        const revision = family.revisions.find(item => item.id === event.revisionId);
        return <li key={event.id} className="rounded-lg border border-black/5 px-3 py-2 text-sm"><p className="font-semibold text-ink">{eventLabels[event.kind] ?? 'Événement'}{revision ? ` · V${revision.revisionNo}` : ''}</p><p className="text-xs text-ink/60">{formatDateTime(event.createdAt)} · {event.actorName ?? roleLabels[event.actorRole] ?? 'Participant'} ({roleLabels[event.actorRole] ?? event.actorRole})</p>{event.note && <p className="mt-1 whitespace-pre-line text-ink/80">{event.note}</p>}</li>;
      })}</ol>
    </div>}
  </li>;
}
