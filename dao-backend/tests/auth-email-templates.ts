// #482 D3 — Supabase Auth e-mail templates, rendered with the shared D.A.O layout.
// Supabase fills the Go-template variables ({{ .ConfirmationURL }}, {{ .Email }}…) and escapes them itself;
// our layout leaves them intact because they contain none of the characters it escapes.
// Regenerate the committed files:  npm run build && node dist/tests/auth-email-templates.js supabase/templates
import { renderEmailHtml, type EmailContent } from '../src/services/emailLayout.js';

const ignore = 'Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail : rien ne sera modifié.';
const personal = 'Ce lien est personnel et à usage unique. Ne le transférez pas.';
const reason = 'E-mail de sécurité envoyé par D.A.O. Il ne contient aucune publicité.';
const content = (input: Omit<EmailContent, 'title' | 'reason'>): EmailContent => ({ title: 'D.A.O', reason, ...input });

/** file → [subject, content]. Subjects are set in config.toml (local) and the Supabase dashboard (hosted). */
export const authTemplates: Record<string, { subject: string; used: string; content: EmailContent }> = {
  invite: { subject: 'Invitation à rejoindre l’équipe D.A.O', used: 'Invitation staff (back-office → inviteUserByEmail → /auth/activate-staff)', content: content({
    preheader: 'Activez votre accès à l’espace de gestion D.A.O.', eyebrow: 'Invitation équipe', heading: 'Vous êtes invité à rejoindre l’équipe D.A.O.',
    greeting: 'Bonjour,', paragraphs: [['Un administrateur D.A.O. vous a ouvert un accès à l’espace de gestion pour l’adresse ', { strong: '{{ .Email }}' }, '.'], ['Activez votre accès en choisissant votre mot de passe.']],
    cta: { label: 'Activer mon accès', url: '{{ .ConfirmationURL }}' },
    footnotes: [personal, 'S’il a expiré, demandez une nouvelle invitation à votre administrateur.'] }) },
  recovery: { subject: 'Réinitialisation de votre mot de passe D.A.O', used: 'Mot de passe oublié (/auth/forgot-password → resetPasswordForEmail → /auth/reset-password)', content: content({
    preheader: 'Choisissez un nouveau mot de passe pour votre compte D.A.O.', eyebrow: 'Sécurité du compte', heading: 'Réinitialisez votre mot de passe',
    greeting: 'Bonjour,', paragraphs: [['Une réinitialisation du mot de passe a été demandée pour le compte ', { strong: '{{ .Email }}' }, '.']],
    cta: { label: 'Choisir un nouveau mot de passe', url: '{{ .ConfirmationURL }}' },
    footnotes: [ignore, personal] }) },
  confirmation: { subject: 'Confirmez votre adresse e-mail D.A.O', used: 'Inscription (signUp), uniquement si « Confirm email » est activé sur le projet', content: content({
    preheader: 'Confirmez votre adresse pour activer votre compte D.A.O.', eyebrow: 'Bienvenue', heading: 'Confirmez votre adresse e-mail',
    greeting: 'Bonjour,', paragraphs: [['Bienvenue sur D.A.O. Confirmez l’adresse ', { strong: '{{ .Email }}' }, ' pour activer votre compte.']],
    cta: { label: 'Confirmer mon adresse', url: '{{ .ConfirmationURL }}' },
    footnotes: [ignore] }) },
  email_change: { subject: 'Confirmez votre nouvelle adresse e-mail D.A.O', used: 'Changement d’adresse e-mail (aucun écran ne le propose aujourd’hui)', content: content({
    preheader: 'Confirmez le changement d’adresse de votre compte D.A.O.', eyebrow: 'Sécurité du compte', heading: 'Confirmez votre nouvelle adresse',
    greeting: 'Bonjour,', paragraphs: [['Vous avez demandé à remplacer l’adresse ', { strong: '{{ .Email }}' }, ' par ', { strong: '{{ .NewEmail }}' }, '.']],
    cta: { label: 'Confirmer le changement', url: '{{ .ConfirmationURL }}' },
    footnotes: [ignore, personal] }) },
  magic_link: { subject: 'Votre lien de connexion D.A.O', used: 'Connexion par lien (aucun écran ne l’utilise aujourd’hui)', content: content({
    preheader: 'Votre lien de connexion à D.A.O.', eyebrow: 'Connexion', heading: 'Votre lien de connexion',
    greeting: 'Bonjour,', paragraphs: [['Utilisez le bouton ci-dessous pour vous connecter à D.A.O. avec l’adresse ', { strong: '{{ .Email }}' }, '.']],
    cta: { label: 'Me connecter', url: '{{ .ConfirmationURL }}' },
    footnotes: [ignore, personal] }) },
};

export const renderAuthTemplate = (name: string) => renderEmailHtml(authTemplates[name].content) + '\n';

if (process.argv[1] && /auth-email-templates\.js$/.test(process.argv[1]) && process.argv[2]) {
  const { writeFile } = await import('node:fs/promises');
  for (const name of Object.keys(authTemplates)) await writeFile(`${process.argv[2]}/${name}.html`, renderAuthTemplate(name));
  console.log(`${Object.keys(authTemplates).length} modèles Auth écrits dans ${process.argv[2]}`);
}
