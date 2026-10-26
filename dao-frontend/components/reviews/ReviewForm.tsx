'use client';

import { useState, type FormEvent } from 'react';
import { StarInput } from './ReviewStars';
import {
  COMMENT_MAX, COMMENT_MIN, containsContact, criteriaKeys, criteriaLabels, submitReview,
  type OwnReview, type ReviewCriteria,
} from '../../lib/reviews';

const emptyCriteria: ReviewCriteria = { quality: null, deadlines: null, budget: null, communication: null, cleanliness: null };

export default function ReviewForm({ projectId, contractorId, contractorName, existing, onSaved, onCancel }: {
  projectId: string; contractorId: string; contractorName: string; existing: OwnReview | null;
  onSaved: (status: OwnReview['status']) => void; onCancel?: () => void;
}) {
  const [rating, setRating] = useState<number | null>(existing?.rating ?? null);
  const [criteria, setCriteria] = useState<ReviewCriteria>(existing?.criteria ?? emptyCriteria);
  const [comment, setComment] = useState(existing && existing.status !== 'withdrawn' ? existing.comment : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const length = comment.trim().length;
  const contact = containsContact(comment);
  const commentId = `review-comment-${projectId}-${contractorId}`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError('');
    if (!rating) { setError('Choisissez une note globale de 1 à 5.'); return; }
    if (length < COMMENT_MIN) { setError(`Votre commentaire doit contenir au moins ${COMMENT_MIN} caractères.`); return; }
    if (contact) { setError('Retirez les coordonnées, liens ou numéros de téléphone de votre commentaire.'); return; }
    setSaving(true);
    try {
      const saved = await submitReview(projectId, contractorId, { rating, comment: comment.trim(), ...criteria });
      onSaved(saved.status);
    } catch (exception) { setError((exception as Error).message); } finally { setSaving(false); }
  }

  return <form onSubmit={(event) => void submit(event)} className="space-y-5" noValidate>
    <StarInput label="Note globale" required value={rating} onChange={setRating} size={30} />
    <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
      {criteriaKeys.map((key) => <StarInput key={key} label={criteriaLabels[key]} size={22} value={criteria[key]}
        onChange={(value) => setCriteria((current) => ({ ...current, [key]: value }))} />)}
    </div>
    <div className="space-y-1.5">
      <label htmlFor={commentId} className="text-sm font-semibold text-ink">Votre avis sur {contractorName}<span className="text-clay"> *</span></label>
      <textarea id={commentId} value={comment} onChange={(event) => setComment(event.target.value)} rows={5} maxLength={COMMENT_MAX}
        aria-describedby={`${commentId}-hint`} aria-invalid={contact || undefined}
        placeholder="Qualité du travail, respect du planning, échanges avec l’équipe…"
        className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm outline-none transition placeholder:text-black/35 focus:border-teal focus:ring-4 focus:ring-teal/10" />
      <p id={`${commentId}-hint`} className={`flex flex-wrap justify-between gap-2 text-xs ${contact ? 'text-red-700' : 'text-black/50'}`}>
        <span>{contact ? 'Pas de téléphone, email ni lien : les échanges passent par D.A.O.' : `Au moins ${COMMENT_MIN} caractères. Pas de coordonnées ni de lien.`}</span>
        <span className="tabular-nums">{length} / {COMMENT_MAX}</span>
      </p>
    </div>
    <p className="text-xs leading-relaxed text-black/50">Votre avis est publié immédiatement avec votre prénom et l’initiale de votre nom, le gouvernorat et le mois du chantier. Vous pourrez le modifier ou le retirer à tout moment.</p>
    {error && <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      {onCancel && <button type="button" onClick={onCancel} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-ink transition hover:border-teal hover:text-teal">Annuler</button>}
      <button type="submit" disabled={saving} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-teal px-5 text-sm font-semibold text-white transition hover:bg-tealdark focus:outline-none focus:ring-4 focus:ring-teal/20 disabled:opacity-60">
        {saving ? 'Publication…' : existing && existing.status !== 'withdrawn' ? 'Enregistrer les modifications' : 'Publier mon avis'}
      </button>
    </div>
  </form>;
}
