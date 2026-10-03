import { DomainError } from '../lib/errors.js';

export const invitationEmailFailure = "L'invitation n'a pas pu être envoyée. Vous pouvez réessayer ou copier le lien.";
export type EmailConfiguration = { apiKey: string; from: string; publicUrl: string };
export type ProjectInvitationEmail = { to: string; inviterName: string; title: string; url: string; expiresAt: string; invitationId: string };
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
  let url: URL;
  try { url = new URL(env.DAO_PUBLIC_URL); } catch { configurationError(); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || url.pathname !== '/') configurationError();
  return { apiKey, from: `D.A.O <${address}>`, publicUrl: url.origin };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
export function projectInvitationMessage(input: ProjectInvitationEmail, from: string) {
  const expiry = new Date(input.expiresAt).toLocaleString('fr-FR', { timeZone: 'UTC', dateStyle: 'long', timeStyle: 'short' });
  const validity = `Cette invitation expire dans 7 jours à compter de sa création et ne peut être utilisée qu’une seule fois. Date limite : ${expiry} UTC.`;
  return {
    from, to: [input.to], subject: 'Invitation à rejoindre un chantier sur D.A.O',
    text: `Bonjour,\n\n${input.inviterName} vous invite à rejoindre le chantier :\n\n"${input.title}"\n\nsur D.A.O.\n\nRejoindre le chantier :\n${input.url}\n\n${validity}\n`,
    html: `<html lang="fr"><body style="font-family:Arial,sans-serif;color:#142b2b"><p>Bonjour,</p><p>${escapeHtml(input.inviterName)} vous invite à rejoindre le chantier :</p><p><strong>« ${escapeHtml(input.title)} »</strong></p><p>sur D.A.O.</p><p><a href="${escapeHtml(input.url)}" style="display:inline-block;padding:12px 20px;background:#087f80;color:white;text-decoration:none;border-radius:8px">Rejoindre le chantier</a></p><p style="overflow-wrap:anywhere">${escapeHtml(input.url)}</p><p>${escapeHtml(validity)}</p></body></html>`,
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
