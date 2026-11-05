// #568 — Projection partagée du parcours chantier : situation réelle et prochaine action par rôle.
// Module pur (aucune dépendance) importable côté navigateur, comme `btp-takeoff-ui/presentation.ts`.
// Il ne stocke ni ne crée aucun état : il lit les états existants (projet, dernière version, lots
// publiés, attributions actives par lot, avancement des travaux) et les rend lisibles. Il n'autorise
// rien : une action « à vous » n'est proposée que si le serveur l'autorise déjà pour ce rôle
// (publication réservée au staff affecté ou Admin, attribution réservée au Client propriétaire, etc.).

export type JourneyRole = 'client' | 'staff' | 'staff_readonly' | 'participant';

export type JourneyPhase =
  | 'archived' | 'draft' | 'rejected' | 'client_review' | 'dao_review' | 'approved'
  | 'published' | 'closed' | 'partially_awarded' | 'awarded' | 'works' | 'completed';

export type JourneyInput = {
  /** `projects.status` (draft, open, published, closed, suspended, archived). */
  projectStatus: string;
  /** Statut de la dernière version (draft, client_review, dao_review, approved, rejected). */
  versionStatus?: string | null;
  /** `projects.project_stage` (not_started, started, in_progress, completed). */
  stage?: string | null;
  /** Lots mis en concurrence (publiés, non retirés). `null` = inconnu. */
  lots?: number | null;
  /** Lots ayant une attribution active. `null` = inconnu : aucune attribution n'est alors affirmée. */
  awardedLots?: number | null;
  /** Offres soumises sur au moins un lot encore sans Artisan (lecture Client uniquement). */
  offersToCompare?: boolean;
  /** Un Gestionnaire est affecté au dossier. `undefined` = inconnu. */
  hasManager?: boolean;
  /** Lots de la version approuvée ni publiés ni attribués (lecture staff). */
  lotsToPublish?: number | null;
};

export type JourneyTone = 'neutral' | 'clay' | 'teal' | 'red';
export type JourneyStep = { text: string; owner: 'you' | 'dao' | 'client' | 'none' };

const PUBLISHED_LIKE = ['open', 'published', 'closed', 'suspended'];
const DOSSIER = ['draft', 'rejected', 'client_review', 'dao_review', 'approved'];

export const isPublishedLike = (projectStatus: string) => PUBLISHED_LIKE.includes(projectStatus);
const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? 's' : ''}`;

/** Situation du chantier, sans état fictif : l'attribution vient des lots réellement attribués. */
export function journeyPhase(input: JourneyInput): JourneyPhase {
  if (input.projectStatus === 'archived') return 'archived';
  if (!isPublishedLike(input.projectStatus)) {
    const status = input.versionStatus ?? 'draft';
    return (DOSSIER.includes(status) ? status : 'draft') as JourneyPhase;
  }
  const awarded = input.awardedLots ?? 0;
  if (awarded > 0 && input.stage === 'completed') return 'completed';
  if (awarded > 0 && (input.stage === 'in_progress' || input.stage === 'started')) return 'works';
  if (awarded > 0) return input.lots != null && awarded >= input.lots ? 'awarded' : 'partially_awarded';
  return input.projectStatus === 'closed' ? 'closed' : 'published';
}

/** Libellé unique d'une attribution partielle, partagé par toutes les listes et fiches (« 1 lot sur 2 attribué »). */
export function awardedLotsLabel(awarded: number, lots: number): string {
  return `${awarded} lot${awarded > 1 ? 's' : ''} sur ${lots} attribué${awarded > 1 ? 's' : ''}`;
}

/** Libellé court de la situation (pastille). */
export function phaseLabel(input: JourneyInput): string {
  const phase = journeyPhase(input);
  switch (phase) {
    case 'archived': return 'Archivé';
    case 'draft': return 'Brouillon';
    case 'rejected': return 'Corrections demandées';
    case 'client_review': return 'En attente de validation D.A.O.';
    case 'dao_review': return 'Revue D.A.O.';
    case 'approved': return 'Prêt à publier';
    case 'published': return 'Publié';
    case 'closed': return 'Publication clôturée';
    case 'partially_awarded': return input.lots != null ? awardedLotsLabel(input.awardedLots ?? 0, input.lots) : 'Partiellement attribué';
    case 'awarded': return input.lots === 1 ? 'Artisan choisi' : 'Tous les lots attribués';
    case 'works': return 'Travaux en cours';
    case 'completed': return 'Travaux terminés';
  }
}

export function phaseTone(phase: JourneyPhase): JourneyTone {
  if (phase === 'rejected') return 'red';
  if (phase === 'client_review' || phase === 'dao_review' || phase === 'partially_awarded') return 'clay';
  if (phase === 'approved' || phase === 'awarded' || phase === 'works' || phase === 'completed') return 'teal';
  return 'neutral';
}

/** Une publication ne se prépare que pour une version approuvée ayant encore des lots ni publiés ni attribués. */
export function canPreparePublication(input: Pick<JourneyInput, 'projectStatus' | 'versionStatus' | 'lotsToPublish'>): boolean {
  return input.projectStatus !== 'archived' && input.versionStatus === 'approved' && (input.lotsToPublish ?? 0) > 0;
}

/** Prochaine action lisible pour le rôle, avec qui doit agir. Jamais d'action promise à un rôle qui ne la possède pas. */
export function nextStep(role: JourneyRole, input: JourneyInput): JourneyStep {
  const phase = journeyPhase(input);
  const remaining = input.lots != null && input.awardedLots != null ? Math.max(0, input.lots - input.awardedLots) : null;
  if (phase === 'archived') return { text: 'Chantier archivé : consultation uniquement.', owner: 'none' };

  if (role === 'client') {
    switch (phase) {
      case 'draft': return { text: 'Finalisez vos lots et vos dates, puis demandez la revue D.A.O.', owner: 'you' };
      case 'rejected': return { text: 'Consultez les corrections demandées, puis corrigez le dossier.', owner: 'you' };
      case 'client_review': return input.hasManager === false
        ? { text: 'Dossier transmis : il attend sa prise en charge par un Gestionnaire D.A.O.', owner: 'dao' }
        : { text: 'Dossier transmis : un Gestionnaire D.A.O. l’examine.', owner: 'dao' };
      case 'dao_review': return { text: 'Le Gestionnaire D.A.O. termine la revue de votre dossier.', owner: 'dao' };
      case 'approved': return { text: 'Dossier approuvé : l’équipe D.A.O. prépare sa publication. Aucune action de votre part.', owner: 'dao' };
      case 'published': return input.offersToCompare
        ? { text: 'Comparez les offres reçues et attribuez lot par lot.', owner: 'you' }
        : { text: 'Publication en ligne : en attente d’offres des Artisans.', owner: 'none' };
      case 'closed': return { text: 'Publication clôturée sans lot attribué.', owner: 'none' };
      case 'partially_awarded': return input.offersToCompare
        ? { text: `Comparez les offres des lots restants${remaining != null ? ` (${plural(remaining, 'lot')})` : ''} et attribuez-les ; convenez des conditions avec les Artisans retenus.`, owner: 'you' }
        : { text: `${remaining != null ? `${plural(remaining, 'lot')} sans Artisan, en attente d’offres` : 'Lots restants en attente d’offres'} ; convenez des conditions avec les Artisans retenus.`, owner: 'you' };
      case 'awarded': return { text: 'Convenez des conditions avec les Artisans retenus, puis suivez le chantier.', owner: 'you' };
      case 'works': return { text: 'Suivez l’avancement dans le suivi du chantier.', owner: 'you' };
      case 'completed': return { text: 'Travaux terminés : le suivi et les documents restent consultables.', owner: 'none' };
    }
  }

  if (role === 'staff' || role === 'staff_readonly') {
    const mine = (text: string): JourneyStep => role === 'staff'
      ? { text, owner: 'you' }
      : { text: `${text} Réservé au Gestionnaire affecté ou à un Admin : lecture seule pour vous.`, owner: 'dao' };
    const toPublish = input.lotsToPublish ?? 0;
    switch (phase) {
      case 'draft': return { text: 'Le Client prépare son dossier.', owner: 'client' };
      case 'rejected': return { text: 'En attente des corrections du Client.', owner: 'client' };
      case 'client_review': return input.hasManager === false ? mine('Prendre en charge le dossier.') : mine('Examiner le dossier et le passer en revue D.A.O.');
      case 'dao_review': return mine('Approuver le dossier ou demander des corrections.');
      case 'approved': return toPublish > 0 ? mine('Préparer la publication des lots approuvés.') : { text: 'Version approuvée sans lot à publier.', owner: 'none' };
      case 'published':
      case 'closed':
      case 'partially_awarded':
        if (toPublish > 0 && input.versionStatus === 'approved') return mine(`Publier ${plural(toPublish, 'lot')} approuvé${toPublish > 1 ? 's' : ''} non encore publié${toPublish > 1 ? 's' : ''}.`);
        if (phase === 'closed') return { text: 'Publication clôturée sans lot attribué.', owner: 'none' };
        return { text: phase === 'partially_awarded' ? 'Le Client compare les offres des lots restants et attribue.' : 'Publication en ligne : le Client compare les offres et attribue.', owner: 'client' };
      case 'awarded': return { text: 'Tous les lots sont attribués : le Client et les Artisans conviennent des conditions.', owner: 'client' };
      case 'works': return { text: 'Travaux en cours : suivi par le Client et les Artisans retenus.', owner: 'none' };
      case 'completed': return { text: 'Travaux terminés.', owner: 'none' };
    }
  }

  switch (phase) {
    case 'draft': case 'rejected': case 'client_review': case 'dao_review': case 'approved':
      return { text: 'Le Client prépare et fait valider le dossier par D.A.O.', owner: 'client' };
    case 'published': case 'partially_awarded':
      return { text: 'Le Client compare les offres et attribue les lots.', owner: 'client' };
    case 'closed': return { text: 'Publication clôturée.', owner: 'none' };
    case 'awarded': return { text: 'Lots attribués : conditions et suivi depuis le suivi du chantier.', owner: 'none' };
    case 'works': return { text: 'Suivez l’avancement dans le suivi du chantier.', owner: 'none' };
    case 'completed': return { text: 'Travaux terminés.', owner: 'none' };
  }
  return { text: '', owner: 'none' };
}
