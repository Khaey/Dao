import { DomainError } from '../lib/errors.js';
import { cleanText, renderEmailHtml } from './emailLayout.js';

export const invitationEmailFailure = "L'invitation n'a pas pu être envoyée. Vous pouvez réessayer ou copier le lien.";
export type EmailConfiguration = { apiKey: string; from: string; publicUrl: string };
export type ProjectInvitationEmail = {
  to: string;
  recipientName: string | null;
  inviterName: string;
  title: string;
  location: string | null;
  principalLot: string | null;
  expectedRole: 'client' | 'contractor';
  url: string;
  expiresAt: string;
  invitationId: string;
};
export type EmailTransport = { sendProjectInvitationEmail(input: ProjectInvitationEmail, config: EmailConfiguration): Promise<void> };

function configurationError(): never {
  throw new DomainError('L’envoi par e-mail est momentanément indisponible. Vous pouvez copier le lien.', 'EMAIL_CONFIGURATION');
}
export function emailConfiguration(env: Record<string, string | undefined> = process.env): EmailConfiguration {
  const apiKey = env.RESEND_API_KEY?.trim();
  const configuredFrom = env.DAO_EMAIL_FROM?.trim();
  if (!apiKey || /\s/.test(apiKey) || !configuredFrom || !env.DAO_PUBLIC_URL) configurationError();
  const match = configuredFrom.match(/^(?:D\.A\.O\s*<([^<>\s]+)>|([^<>\s]+))$/);
  const address = match?.[1] || match?.[2];
  if (!address || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) configurationError();
  return { apiKey, from: `D.A.O <${address}>`, publicUrl: publicSiteUrl(env) };
}

export function publicSiteUrl(env: Record<string,string|undefined> = process.env) {
  if (!env.DAO_PUBLIC_URL) configurationError();
  let url: URL;
  try { url = new URL(env.DAO_PUBLIC_URL); } catch { configurationError(); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || url.pathname !== '/') configurationError();
  return url.origin;
}

function inviterLabel(value: string) {
  const clean = cleanText(value);
  if (!clean || /^(utilisateur|participant d\.a\.o)$/i.test(clean)) return 'Un membre D.A.O';
  return clean;
}
function roleLabel(role: 'client' | 'contractor') {
  return role === 'contractor' ? 'Artisan / Entreprise' : 'Client';
}
function expiryLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  // French 24-hour clock (fr-TN rendered « 11:00 AM » in some ICU builds).
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Africa/Tunis',
    dateStyle: 'long',
    timeStyle: 'short',
    hourCycle: 'h23',
  }).format(date);
}

export function projectInvitationMessage(input: ProjectInvitationEmail, from: string) {
  const recipientName = input.recipientName ? cleanText(input.recipientName) : '';
  const inviterName = inviterLabel(input.inviterName);
  const title = cleanText(input.title);
  const location = input.location ? cleanText(input.location) : '';
  const principalLot = input.principalLot ? cleanText(input.principalLot) : '';
  const role = roleLabel(input.expectedRole);
  const expiry = expiryLabel(input.expiresAt);
  const greeting = recipientName ? `Bonjour ${recipientName},` : 'Bonjour,';
  const validity = expiry
    ? `Cette invitation est personnelle, valable 7 jours jusqu’au ${expiry} (heure de Tunis) et ne peut être utilisée qu’une seule fois.`
    : 'Cette invitation est personnelle, valable 7 jours et ne peut être utilisée qu’une seule fois.';

  const text = [
    greeting,
    '',
    `${inviterName} vous invite à rejoindre un chantier sur D.A.O.`,
    '',
    `Chantier : ${title}`,
    ...(principalLot ? [`Lot principal : ${principalLot}`] : []),
    ...(location ? [`Localisation : ${location}`] : []),
    `Votre rôle : ${role}`,
    '',
    'Rejoindre le chantier :',
    input.url,
    '',
    'Vous n’avez pas encore de compte ? Votre inscription est préparée depuis cette invitation : vérifiez vos informations, choisissez votre mot de passe et rejoignez le chantier.',
    '',
    validity,
    'Ne transférez pas ce lien : il est personnel et à usage unique.',
    '',
    'D.A.O',
    'Transparence · Précision · Confiance',
    '',
  ].join('\n');

  // #482: same content as before, now rendered by the shared D.A.O layout (single model for every e-mail).
  const html = renderEmailHtml({
    title: 'Invitation D.A.O',
    preheader: `${inviterName} vous invite à rejoindre le chantier ${title} sur D.A.O.`,
    eyebrow: 'Invitation au chantier',
    heading: 'Vous êtes invité à rejoindre un chantier',
    greeting,
    paragraphs: [[{ strong: inviterName }, ' vous invite à collaborer sur D.A.O.']],
    card: {
      label: 'Chantier', title,
      rows: [
        ...(principalLot ? [{ label: 'Lot principal', value: principalLot }] : []),
        ...(location ? [{ label: 'Localisation', value: location }] : []),
        { label: 'Votre rôle', value: role, badge: true },
      ],
    },
    cta: { label: 'Rejoindre le chantier', url: input.url },
    ctaNote: 'Pas encore de compte ? Votre inscription est préparée : vérifiez vos informations, choisissez votre mot de passe et rejoignez le chantier en quelques secondes.',
    footnotes: [validity, 'Ne transférez pas cet e-mail : le lien d’invitation est personnel et à usage unique.'],
    reason: 'Vous recevez cet e-mail car un membre D.A.O vous a invité sur un chantier.',
  });

  return {
    from,
    to: [input.to],
    subject: 'Invitation à rejoindre un chantier sur D.A.O',
    text,
    html,
  };
}

// A small server-only adapter; no SDK-wide coupling, persistence or logging.
// Resend replays accepted requests for 24h. Retry the same key/payload after
// network/429/5xx/concurrent-request failures; never record local success first.
// https://resend.com/docs/dashboard/emails/idempotency-keys
export class ResendEmailTransport implements EmailTransport {
  constructor(private readonly request: typeof fetch = fetch) {}
  async sendProjectInvitationEmail(input: ProjectInvitationEmail, config: EmailConfiguration) {
    try {
      const response = await this.request('https://api.resend.com/emails', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `project-invitation-email/${input.invitationId}` },
        body: JSON.stringify(projectInvitationMessage(input, config.from)),
      });
      if (!response.ok) throw new Error('Email not accepted');
      const result = await response.json();
      if (typeof result.id !== 'string' || !result.id) throw new Error('Email not accepted');
    } catch {
      // Never surface provider messages, request bodies, URLs, tokens or keys.
      throw new DomainError(invitationEmailFailure, 'EMAIL_DELIVERY');
    }
  }
}
