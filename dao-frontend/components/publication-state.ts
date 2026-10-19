// Client visibility of a professional's profile, logo, projects and media, derived from the states the server
// already returns. Mirrors the publication rules of dao_private.professional_public_profile (the server stays
// authoritative): a profile is public when verified + identity approved + review approved; the most recent
// approved + consented logo is shown; a project is shown when published + consented; a media item is shown
// when approved + consented AND its project is shown. Informational only — never used to grant access.

export type Tone = 'teal' | 'clay' | 'red' | 'neutral';
export type Visibility = {
  visible: boolean;
  /** Short state for the owner, e.g. « En contrôle par D.A.O. ». Never a raw server key. */
  label: string;
  tone: Tone;
  /** Why it is (not) visible, one sentence. */
  why: string;
  /** What the owner can do next, if anything. */
  action?: string;
};

type Profile = { verification_status?: string | null; public_identity_status?: string | null };
type Details = { review_status?: string | null; review_reason?: string | null };
type FileLike = { id: string; status?: string | null; public_consent?: boolean | null; review_reason?: string | null; created_at?: string | null; content_sha256?: string | null };
type ProjectLike = { status?: string | null; publication_consent?: boolean | null; review_reason?: string | null };

const visible = (why: string): Visibility => ({ visible: true, label: 'Visible par les clients', tone: 'teal', why });
const hidden = (label: string, tone: Tone, why: string, action?: string): Visibility => ({ visible: false, label, tone, why, action });

export function profileVisibility(profile: Profile, details: Details): Visibility {
  const review = details.review_status ?? 'draft';
  if (review === 'draft') return hidden('Fiche non soumise', 'clay', 'Votre fiche n’a pas encore été envoyée à D.A.O.', 'Soumettez-la depuis l’onglet « Vérification ».');
  if (review === 'pending_review') return hidden('En contrôle par D.A.O.', 'clay', 'D.A.O. examine votre fiche avant de la publier.');
  if (review === 'rejected') return hidden('Corrections demandées', 'red', details.review_reason ? `Motif : ${details.review_reason}` : 'D.A.O. a demandé des corrections.', 'Corrigez puis soumettez de nouveau depuis « Vérification ».');
  if (review === 'hidden') return hidden('Fiche masquée', 'neutral', 'Vous avez masqué votre fiche.', 'Soumettez-la de nouveau pour la republier.');
  if (profile.verification_status !== 'verified') return hidden('Vérification en attente', 'clay',
    profile.verification_status === 'suspended' ? 'Votre compte professionnel est suspendu.' : 'Votre vérification professionnelle n’est pas encore validée.',
    profile.verification_status === 'suspended' ? undefined : 'Vérifiez les pièces jointes dans « Vérification ».');
  if (profile.public_identity_status !== 'approved') return hidden('Identité publique en attente', 'clay', 'Votre nom public attend la validation de D.A.O.');
  return visible('Votre fiche est publiée dans l’annuaire.');
}

/** The logo the server would show: most recent approved + consented + inspected file. */
export function publicLogoId(files: FileLike[]) {
  return files.filter((file) => file.status === 'approved' && file.public_consent && file.content_sha256)
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))[0]?.id ?? null;
}

function mediaState(file: FileLike, kind: 'logo' | 'media'): Visibility | null {
  const what = kind === 'logo' ? 'logo' : 'média';
  switch (file.status) {
    case 'withdrawn': return hidden('Retiré par vous', 'neutral', `Ce ${what} n’est plus proposé aux clients.`);
    case 'quarantined': return hidden('Envoi incomplet', 'red', 'Le fichier n’a pas été reçu entièrement.', 'Retirez-le puis envoyez-le de nouveau.');
    case 'rejected': return hidden('Refusé par D.A.O.', 'red', file.review_reason ? `Motif : ${file.review_reason}` : 'Ce fichier n’a pas été accepté.', `Envoyez un autre ${kind === 'logo' ? 'logo' : 'fichier'}.`);
    case 'ready': return file.public_consent
      ? hidden('En contrôle par D.A.O.', 'clay', 'D.A.O. vérifie ce fichier avant de le publier.')
      : hidden('Autorisation manquante', 'red', 'Vous n’avez pas autorisé sa publication : D.A.O. ne peut pas l’approuver.', 'Choisissez « Modifier le média » et cochez l’autorisation.');
    default: return null;
  }
}

export function logoVisibility(file: FileLike, publicLogo: string | null, profilePublic: boolean): Visibility {
  const state = mediaState(file, 'logo');
  if (state) return state;
  if (file.id !== publicLogo) return hidden('Remplacé', 'neutral', 'Un logo approuvé plus récent est affiché à la place.');
  return profilePublic ? visible('Affiché en tête de votre fiche.') : hidden('Validé, en attente de la fiche', 'clay', 'Il apparaîtra dès que votre fiche sera publiée.');
}

export function projectVisibility(project: ProjectLike, profilePublic: boolean): Visibility {
  switch (project.status) {
    case 'pending_review': return hidden('En contrôle par D.A.O.', 'clay', 'D.A.O. examine cette réalisation avant de la publier.');
    case 'published': return !project.publication_consent
      ? hidden('Autorisation manquante', 'red', 'La publication n’est plus autorisée.', 'Modifiez-la, cochez l’autorisation puis soumettez-la.')
      : profilePublic ? visible('Présentée sur votre fiche avec ses médias validés.') : hidden('Validée, en attente de la fiche', 'clay', 'Elle apparaîtra dès que votre fiche sera publiée.');
    case 'hidden': return project.review_reason
      ? hidden('Refusée par D.A.O.', 'red', `Motif : ${project.review_reason}`, 'Modifiez-la puis soumettez-la de nouveau.')
      : hidden('Masquée par vous', 'neutral', 'Cette réalisation n’est pas proposée aux clients.', 'Modifiez-la, cochez l’autorisation puis soumettez-la.');
    default: return project.publication_consent
      ? hidden('Brouillon non soumis', 'clay', 'Une réalisation n’est visible qu’après validation par D.A.O.', 'Cliquez sur « Soumettre » pour la faire contrôler.')
      : hidden('Brouillon sans autorisation', 'clay', 'L’autorisation de publication n’est pas cochée.', 'Modifiez-la, cochez l’autorisation, puis soumettez-la.');
  }
}

export function assetVisibility(asset: FileLike, project: Visibility): Visibility {
  const state = mediaState(asset, 'media');
  if (state) return state;
  if (!asset.public_consent) return hidden('Autorisation manquante', 'red', 'La publication de ce média n’est pas autorisée.', 'Choisissez « Modifier le média » et cochez l’autorisation.');
  if (project.visible) return visible('Affiché dans cette réalisation.');
  return hidden('Validé, en attente de la réalisation', 'clay', 'Il apparaîtra quand la réalisation sera visible par les clients.');
}

export type PublicationSummary = {
  profile: Visibility; logo: Visibility | null;
  projects: { total: number; visible: number }; media: { total: number; visible: number };
  todo: Array<{ text: string; section: number }>;
};

/** Owner overview: what clients see today and the next actions, with the dossier section to open. */
export function publicationSummary(dossier: { profile: Profile; details?: Details; files: any[]; portfolio: any[] }): PublicationSummary {
  const profile = profileVisibility(dossier.profile, dossier.details ?? {});
  const logos = dossier.files.filter((file) => file.purpose === 'logo' && file.status !== 'withdrawn');
  const logoId = publicLogoId(logos);
  const logo = logos.length ? logoVisibility(logos.find((file) => file.id === logoId) ?? logos[0], logoId, profile.visible) : null;
  const todo: PublicationSummary['todo'] = [];
  if (profile.action) todo.push({ text: profile.action, section: 4 });
  if (!logos.length) todo.push({ text: 'Ajoutez un logo : sans logo, les clients voient vos initiales.', section: 0 });
  else if (logo?.action) todo.push({ text: `Logo : ${logo.action}`, section: 0 });
  let projectsVisible = 0, mediaTotal = 0, mediaVisible = 0;
  for (const item of dossier.portfolio) {
    const state = projectVisibility(item, profile.visible);
    if (state.visible) projectsVisible += 1;
    else if (state.action) todo.push({ text: `« ${item.title} » : ${state.action}`, section: 3 });
    for (const asset of (item.assets ?? []).filter((entry: any) => entry.status !== 'withdrawn')) {
      mediaTotal += 1;
      const media = assetVisibility(asset, state);
      if (media.visible) mediaVisible += 1;
      else if (media.action) todo.push({ text: `${asset.original_name} : ${media.action}`, section: 3 });
    }
  }
  if (!dossier.portfolio.length) todo.push({ text: 'Ajoutez une réalisation avec des photos pour rassurer les clients.', section: 3 });
  return { profile, logo, projects: { total: dossier.portfolio.length, visible: projectsVisible }, media: { total: mediaTotal, visible: mediaVisible }, todo };
}

/** Staff wording: what clients see now, or what an approval would change. Same rules, impersonal phrasing. */
export function staffMediaEffect(file: FileLike, context: { kind: 'logo' | 'media'; containerVisible: boolean; replaced?: boolean }): Visibility {
  const container = context.kind === 'logo' ? 'la fiche' : 'la réalisation';
  if (file.status === 'withdrawn') return hidden('Retiré par le professionnel', 'neutral', 'Non proposé aux clients.');
  if (file.status === 'quarantined') return hidden('Envoi incomplet', 'red', 'Fichier non inspecté : aucune décision possible.');
  if (file.status === 'rejected') return hidden('Refusé', 'red', file.review_reason ? `Motif communiqué : ${file.review_reason}` : 'Non publié.');
  if (!file.public_consent) return hidden('Sans autorisation de publication', 'red', 'Le professionnel n’a pas autorisé la publication : approbation impossible.');
  if (file.status === 'ready') return hidden('À décider', 'clay', context.containerVisible
    ? `Une fois approuvé, il sera visible dans ${container}.`
    : `Une fois approuvé, il restera invisible tant que ${container} n’est pas publiée.`);
  if (context.replaced) return hidden('Remplacé', 'neutral', 'Un logo approuvé plus récent est affiché.');
  return context.containerVisible ? visible('Actuellement visible par les clients.') : hidden('Validé, non encore visible', 'clay', `Visible dès que ${container} sera publiée.`);
}

/** Why a staff publication button is disabled, from the same prerequisites the server enforces. */
export function publicationBlockers(input: { consent?: boolean | null; verification?: string | null; identity?: string | null; admin?: boolean; needsAdmin?: boolean; needsIdentity?: boolean }) {
  const blockers: string[] = [];
  if (input.consent === false) blockers.push('le professionnel n’a pas autorisé la publication');
  if (input.verification !== 'verified') blockers.push('le professionnel n’est pas vérifié');
  if (input.needsIdentity && input.identity !== 'approved') blockers.push('l’identité publique n’est pas approuvée');
  if (input.needsAdmin && !input.admin) blockers.push('réservé à un administrateur');
  return blockers;
}
