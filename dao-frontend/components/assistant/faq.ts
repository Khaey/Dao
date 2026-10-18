// Local, static FAQ for the floating assistant. Public content only: no user data, no network call,
// no third-party AI. Labels quoted here are the real labels of the D.A.O. interface.

export type FaqAudience = 'general' | 'client' | 'contractor' | 'staff';
export type FaqEntry = { id: string; audience: FaqAudience; question: string; answer: string; link?: { href: string; label: string } };

export const faq: FaqEntry[] = [
  { id: 'what', audience: 'general', question: 'Qu’est-ce que D.A.O. ?',
    answer: 'D.A.O. vous aide à préparer le dossier de vos travaux (le DAO), à le faire relire par l’équipe D.A.O., puis à le publier auprès de professionnels vérifiés pour comparer leurs offres.' },
  { id: 'register', audience: 'general', question: 'Comment créer un compte ?',
    answer: 'Sur la page de connexion, choisissez « Créer un compte », puis le type de compte : Client pour faire réaliser des travaux, Artisan / Entreprise pour répondre aux DAO. Confirmez ensuite votre adresse e-mail.',
    link: { href: '/auth/register', label: 'Créer un compte' } },
  { id: 'password', audience: 'general', question: 'J’ai oublié mon mot de passe',
    answer: 'Sur la page de connexion, utilisez le lien « Mot de passe oublié ? ». Un lien de réinitialisation est envoyé à l’adresse de votre compte.',
    link: { href: '/auth/login', label: 'Aller à la connexion' } },
  { id: 'verified', audience: 'general', question: 'Les professionnels sont-ils vérifiés ?',
    answer: 'Oui. Une fiche professionnelle n’apparaît dans l’annuaire qu’après vérification par D.A.O. Les avis ne peuvent être déposés que par des clients ayant un chantier démarré avec ce professionnel.' },
  { id: 'privacy', audience: 'general', question: 'Qui voit mes coordonnées ?',
    answer: 'L’adresse exacte et les coordonnées privées d’un chantier ne sont visibles que par ses participants autorisés et par l’équipe D.A.O. habilitée.' },

  { id: 'create-project', audience: 'client', question: 'Comment créer un chantier ?',
    answer: 'Dans « Mes chantiers », choisissez « Nouveau chantier ». Décrivez le projet, ajoutez vos lots de travaux, les dates souhaitées et votre budget. Ouvrez ensuite « Revoir le DAO » puis « Soumettre pour revue DAO ».',
    link: { href: '/app/projects', label: 'Mes chantiers' } },
  { id: 'invite', audience: 'client', question: 'Comment inviter un artisan ou un client sur mon chantier ?',
    answer: 'Ouvrez le chantier, onglet « Équipe », puis « Préparer l’invitation ». Vous pouvez copier le lien ou l’envoyer par e-mail. La personne invitée retrouve aussi l’invitation dans « Mes invitations ».' },
  { id: 'find-pro', audience: 'client', question: 'Comment trouver un professionnel ?',
    answer: 'Utilisez « Trouver un professionnel » pour parcourir l’annuaire par métier, zone et disponibilité. Votre recherche est conservée quand vous revenez d’une fiche.',
    link: { href: '/app/professionals', label: 'Trouver un professionnel' } },
  { id: 'compare', audience: 'client', question: 'Comment comparer et choisir une offre ?',
    answer: 'Une fois votre DAO publié, la page du DAO affiche « Comparer et attribuer les offres » : prix, délais, inclusions. L’attribution porte sur un lot et ne crée pas de contrat automatiquement.' },
  { id: 'review', audience: 'client', question: 'Comment donner un avis sur un professionnel ?',
    answer: 'Dès que les travaux ont démarré, le bouton « Donner mon avis » apparaît sur votre tableau de bord et dans le chantier. Vous notez le travail globalement et sur cinq critères.' },

  { id: 'bid', audience: 'contractor', question: 'Comment répondre à un DAO ?',
    answer: 'Dans « DAO disponibles », ouvrez un DAO, cochez « Répondre à ce lot », indiquez prix, délai et ce qui est inclus. Enregistrez un brouillon ou choisissez « Soumettre l’offre ». Votre profil professionnel doit être vérifié.',
    link: { href: '/app/artisan', label: 'DAO disponibles' } },
  { id: 'bid-change', audience: 'contractor', question: 'Puis-je modifier ou retirer une offre envoyée ?',
    answer: 'Une offre soumise est figée. Tant que le DAO est ouvert et qu’elle n’est pas retenue, vous pouvez « Préparer une nouvelle version » ou « Retirer l’offre » depuis le DAO ou « Mes offres ».',
    link: { href: '/app/artisan/offers', label: 'Mes offres' } },
  { id: 'pro-profile', audience: 'contractor', question: 'Comment faire vérifier mon profil professionnel ?',
    answer: 'Complétez « Mon dossier professionnel » (identité, métiers, zones, documents) puis soumettez-le. L’équipe D.A.O. le vérifie et vous indique les corrections éventuelles.' },

  { id: 'staff-review', audience: 'staff', question: 'Où se trouvent les dossiers à relire ?',
    answer: 'Dans l’espace Gestionnaire, « Revues » liste les DAO soumis. Prenez une revue en charge avant de l’approuver ou de demander des corrections.' },
  { id: 'staff-moderation', audience: 'staff', question: 'Comment modérer un avis signalé ?',
    answer: 'Ouvrez « Avis ». Un avis n’est masqué que s’il enfreint les règles, avec un motif visible par son auteur ; toutes les décisions sont journalisées dans « Historique ».' },
];

export type AssistantContext = 'public' | 'app' | 'contractor' | 'staff';

export function contextOf(pathname: string): AssistantContext {
  if (pathname.startsWith('/app/dao')) return 'staff';
  if (pathname.startsWith('/app/artisan')) return 'contractor';
  if (pathname.startsWith('/app')) return 'app';
  return 'public';
}

/** Ordered FAQ for a page: the section's own questions first, then general ones. */
export function faqFor(context: AssistantContext): FaqEntry[] {
  const order: Record<AssistantContext, FaqAudience[]> = {
    public: ['general'],
    app: ['client', 'contractor', 'general'],
    contractor: ['contractor', 'general'],
    staff: ['staff', 'general'],
  };
  return order[context].flatMap((audience) => faq.filter((entry) => entry.audience === audience));
}

const fold = (value: string) => value.toLocaleLowerCase('fr').normalize('NFD').replace(/[̀-ͯ]/g, '');
export function searchFaq(entries: FaqEntry[], query: string) {
  const words = fold(query).split(/\s+/).filter((word) => word.length > 1);
  if (!words.length) return entries;
  return entries.filter((entry) => { const text = fold(`${entry.question} ${entry.answer}`); return words.every((word) => text.includes(word)); });
}
