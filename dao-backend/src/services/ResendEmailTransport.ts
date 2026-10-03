import { DomainError } from '../lib/errors.js';

export const invitationEmailFailure = "L'invitation n'a pas pu être envoyée. Vous pouvez réessayer ou copier le lien.";
export type EmailConfiguration = { apiKey: string; from: string; publicUrl: string };
export type ProjectInvitationEmail = {
  to: string;
  recipientName: string | null;
  inviterName: string;
  title: string;
  location: string | null;
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
  let url: URL;
  try { url = new URL(env.DAO_PUBLIC_URL); } catch { configurationError(); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || url.pathname !== '/') configurationError();
  return { apiKey, from: `D.A.O <${address}>`, publicUrl: url.origin };
}

function cleanText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
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
  return new Intl.DateTimeFormat('fr-TN', {
    timeZone: 'Africa/Tunis',
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date);
}

export function projectInvitationMessage(input: ProjectInvitationEmail, from: string) {
  const recipientName = input.recipientName ? cleanText(input.recipientName) : '';
  const inviterName = inviterLabel(input.inviterName);
  const title = cleanText(input.title);
  const location = input.location ? cleanText(input.location) : '';
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

  const safeGreeting = escapeHtml(greeting);
  const safeInviter = escapeHtml(inviterName);
  const safeTitle = escapeHtml(title);
  const safeLocation = escapeHtml(location);
  const safeRole = escapeHtml(role);
  const safeUrl = escapeHtml(input.url);
  const safeValidity = escapeHtml(validity);

  const locationRow = location ? `
    <tr>
      <td style="padding:8px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;color:#51615f;">
        <span style="color:#7a8987;">Localisation</span><br>
        <strong style="font-weight:600;color:#173330;">${safeLocation}</strong>
      </td>
    </tr>` : '';

  const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>Invitation D.A.O</title>
</head>
<body style="margin:0;padding:0;background:#f4f1e9;color:#173330;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    ${safeInviter} vous invite à rejoindre le chantier ${safeTitle} sur D.A.O.
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f4f1e9;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;">
          <tr>
            <td style="padding:0 4px 18px 4px;font-family:Arial,Helvetica,sans-serif;">
              <span style="font-size:20px;line-height:24px;font-weight:800;letter-spacing:.04em;color:#087f80;">D.A.O</span>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;border:1px solid #e8e3d8;border-radius:20px;padding:36px 34px;box-shadow:0 8px 28px rgba(23,51,48,.06);">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#087f80;">
                    Invitation au chantier
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:8px;font-family:Arial,Helvetica,sans-serif;font-size:30px;line-height:37px;font-weight:800;color:#102926;">
                    Vous êtes invité à rejoindre un chantier
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:25px;color:#314845;">
                    ${safeGreeting}
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:10px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:25px;color:#314845;">
                    <strong style="color:#173330;">${safeInviter}</strong> vous invite à collaborer sur D.A.O.
                  </td>
                </tr>

                <tr>
                  <td style="padding-top:24px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f0f8f7;border:1px solid #d5ece9;border-radius:14px;">
                      <tr>
                        <td style="padding:20px 22px;">
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                            <tr>
                              <td style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#5f7774;">
                                Chantier
                              </td>
                            </tr>
                            <tr>
                              <td style="padding-top:4px;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:29px;font-weight:800;color:#102926;">
                                ${safeTitle}
                              </td>
                            </tr>
                            ${locationRow}
                            <tr>
                              <td style="padding:12px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;color:#51615f;">
                                <span style="color:#7a8987;">Votre rôle</span><br>
                                <span style="display:inline-block;margin-top:4px;padding:6px 10px;border-radius:999px;background:#d9efed;color:#086e70;font-weight:700;">${safeRole}</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td align="left" style="padding-top:26px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td bgcolor="#087f80" style="border-radius:10px;">
                          <a href="${safeUrl}" style="display:inline-block;padding:15px 24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">
                            Rejoindre le chantier
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding-top:14px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#6a7876;">
                    Pas encore de compte ? Votre inscription est préparée : vérifiez vos informations, choisissez votre mot de passe et rejoignez le chantier en quelques secondes.
                  </td>
                </tr>

                <tr>
                  <td style="padding-top:26px;">
                    <div style="height:1px;background:#ebe7de;font-size:1px;line-height:1px;">&nbsp;</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:18px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;color:#788582;">
                    ${safeValidity}<br>
                    Ne transférez pas cet e-mail : le lien d’invitation est personnel et à usage unique.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:20px 20px 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#74817e;">
              <strong style="color:#46615d;">D.A.O</strong><br>
              Transparence · Précision · Confiance
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

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
