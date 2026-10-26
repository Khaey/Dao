// Shared D.A.O e-mail layout (#482). One table-based, inline-styled template for every transactional
// e-mail sent by the repository (Gmail, Outlook desktop/web, Apple Mail, mobile). No remote image, web
// font, tracking pixel or script: the wordmark is text, so the message reads the same with images off.
// Every dynamic value goes through `escapeHtml`; callers pass plain text only.

export const palette = {
  page: '#f7f5ef', card: '#ffffff', border: '#e7e2d6', ink: '#17202a', body: '#3b4652', muted: '#5c6670',
  teal: '#0f766e', tealSoft: '#eef7f5', tealLine: '#cfe7e2', clay: '#d97745',
} as const;

const tones = {
  info: { background: palette.tealSoft, border: palette.tealLine, label: '#0b5d57', text: palette.ink },
  success: { background: '#ffffff', border: palette.teal, label: '#0b5d57', text: palette.ink },
  warning: { background: '#fdf3ec', border: '#f1d2bd', label: '#8a3d17', text: palette.ink },
  neutral: { background: '#f4f2ec', border: palette.border, label: palette.muted, text: palette.ink },
} as const;
export type Tone = keyof typeof tones;

export type Segment = string | { strong: string };
export type EmailContent = {
  /** Document title (not shown by most clients). */
  title: string;
  /** Hidden inbox preview line. */
  preheader: string;
  eyebrow: string;
  heading: string;
  greeting?: string;
  paragraphs: Segment[][];
  /** Highlighted fact (decision, reason…), placed before the details card. */
  notice?: { tone: Tone; label: string; text: string; detail?: string };
  card?: { label: string; title: string; rows: { label: string; value: string; badge?: boolean }[] };
  cta: { label: string; url: string };
  ctaNote?: string;
  nextStep?: string;
  footnotes?: string[];
  /** Why the recipient gets this message (service e-mail, no marketing). */
  reason?: string;
};

export function cleanText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}
export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
/** Subjects never carry user data, and never a line break (no header injection). */
export function subjectLine(value: string) {
  return cleanText(value).slice(0, 120);
}

const font = 'font-family:Arial,Helvetica,sans-serif;';
const segments = (parts: Segment[]) => parts.map(part => typeof part === 'string' ? escapeHtml(part) : `<strong style="font-weight:700;color:${palette.ink};">${escapeHtml(part.strong)}</strong>`).join('');
const row = (content: string, style: string) => `
                <tr>
                  <td style="${style}">${content}</td>
                </tr>`;

export function renderEmailHtml(content: EmailContent) {
  const notice = content.notice ? (() => {
    const tone = tones[content.notice.tone];
    return row(`
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:${tone.background};border:1px solid ${tone.border};border-radius:14px;">
                      <tr>
                        <td style="padding:16px 20px;${font}">
                          <div style="font-size:12px;line-height:18px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${tone.label};">${escapeHtml(content.notice.label)}</div>
                          <div style="padding-top:4px;font-size:17px;line-height:25px;font-weight:700;color:${tone.text};">${escapeHtml(content.notice.text)}</div>${content.notice.detail ? `
                          <div style="padding-top:6px;font-size:14px;line-height:22px;color:${palette.body};">${escapeHtml(content.notice.detail)}</div>` : ''}
                        </td>
                      </tr>
                    </table>`, 'padding-top:22px;');
  })() : '';

  const card = content.card ? row(`
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:${palette.tealSoft};border:1px solid ${palette.tealLine};border-radius:14px;">
                      <tr>
                        <td style="padding:20px 22px;">
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                            <tr>
                              <td style="${font}font-size:12px;line-height:18px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#4e6461;">${escapeHtml(content.card.label)}</td>
                            </tr>
                            <tr>
                              <td class="dao-card-title" style="padding-top:4px;${font}font-size:21px;line-height:28px;font-weight:800;color:${palette.ink};">${escapeHtml(content.card.title)}</td>
                            </tr>${content.card.rows.map(item => `
                            <tr>
                              <td style="padding-top:12px;${font}font-size:14px;line-height:21px;color:${palette.body};">
                                <span style="color:${palette.muted};">${escapeHtml(item.label)}</span><br>
                                ${item.badge ? `<span style="display:inline-block;margin-top:4px;padding:6px 10px;border-radius:999px;background:#d6ece8;color:#0b5d57;font-weight:700;">${escapeHtml(item.value)}</span>` : `<strong style="font-weight:700;color:${palette.ink};">${escapeHtml(item.value)}</strong>`}
                              </td>
                            </tr>`).join('')}
                          </table>
                        </td>
                      </tr>
                    </table>`, 'padding-top:22px;') : '';

  const nextStep = content.nextStep ? row(`
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-left:3px solid ${palette.clay};">
                      <tr>
                        <td style="padding:2px 0 2px 14px;${font}font-size:14px;line-height:22px;color:${palette.body};">
                          <strong style="color:${palette.ink};">Prochaine étape</strong><br>${escapeHtml(content.nextStep)}
                        </td>
                      </tr>
                    </table>`, 'padding-top:22px;') : '';

  const footnotes = content.footnotes?.length ? `${row(`<div style="height:1px;background:#ebe7de;font-size:1px;line-height:1px;">&nbsp;</div>`, 'padding-top:26px;')}${row(content.footnotes.map(escapeHtml).join('<br>'), `padding-top:16px;${font}font-size:12px;line-height:19px;color:${palette.muted};`)}` : '';

  return `<!doctype html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
  <title>${escapeHtml(content.title)}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>
    @media only screen and (max-width:520px){
      .dao-shell{padding:20px 10px !important}
      .dao-card{padding:26px 20px !important;border-radius:16px !important}
      .dao-h1{font-size:24px !important;line-height:31px !important}
      .dao-card-title{font-size:19px !important;line-height:26px !important}
      .dao-btn{width:100% !important}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${palette.page};color:${palette.ink};-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">
    ${escapeHtml(content.preheader)}
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:${palette.page};">
    <tr>
      <td class="dao-shell" align="center" style="padding:32px 16px;">
        <!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;">
          <tr>
            <td style="padding:0 4px 18px 4px;${font}">
              <span style="font-size:22px;line-height:26px;font-weight:800;letter-spacing:.02em;color:${palette.ink};">D.A.O<span style="color:${palette.clay};">.</span></span>
            </td>
          </tr>
          <tr>
            <td class="dao-card" style="background:${palette.card};border:1px solid ${palette.border};border-radius:20px;padding:36px 34px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${row(escapeHtml(content.eyebrow), `${font}font-size:12px;line-height:18px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${palette.teal};`)}
                <tr>
                  <td class="dao-h1" style="padding-top:8px;${font}font-size:28px;line-height:35px;font-weight:800;color:${palette.ink};">${escapeHtml(content.heading)}</td>
                </tr>${content.greeting ? row(escapeHtml(content.greeting), `padding-top:22px;${font}font-size:16px;line-height:25px;color:${palette.body};`) : ''}${content.paragraphs.map((paragraph, index) => row(segments(paragraph), `padding-top:${index === 0 && !content.greeting ? 22 : 10}px;${font}font-size:16px;line-height:25px;color:${palette.body};`)).join('')}${notice}${card}${nextStep}
                <tr>
                  <td align="left" style="padding-top:26px;">
                    <table role="presentation" class="dao-btn" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td align="center" bgcolor="${palette.teal}" style="border-radius:10px;padding:14px 24px;">
                          <a href="${escapeHtml(content.cta.url)}" target="_blank" style="display:inline-block;${font}font-size:16px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;">${escapeHtml(content.cta.label)}</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>${content.ctaNote ? row(escapeHtml(content.ctaNote), `padding-top:14px;${font}font-size:13px;line-height:20px;color:${palette.muted};`) : ''}${footnotes}
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:20px 20px 0 20px;${font}font-size:12px;line-height:18px;color:${palette.muted};">
              <strong style="color:${palette.body};">D.A.O</strong><br>
              Transparence · Précision · Confiance${content.reason ? `<br><span style="display:inline-block;padding-top:8px;">${escapeHtml(content.reason)}</span>` : ''}
            </td>
          </tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Plain-text twin: same facts, the full URL, same signature. */
export function renderEmailText(content: EmailContent) {
  const plain = (parts: Segment[]) => parts.map(part => typeof part === 'string' ? part : part.strong).join('');
  return [
    ...(content.greeting ? [content.greeting, ''] : []),
    ...content.paragraphs.flatMap(paragraph => [plain(paragraph), '']),
    ...(content.notice ? [`${content.notice.label} : ${content.notice.text}`, ...(content.notice.detail ? [content.notice.detail] : []), ''] : []),
    ...(content.card ? [`${content.card.label} : ${content.card.title}`, ...content.card.rows.map(item => `${item.label} : ${item.value}`), ''] : []),
    ...(content.nextStep ? [`Prochaine étape : ${content.nextStep}`, ''] : []),
    `${content.cta.label} :`, content.cta.url, '',
    ...(content.ctaNote ? [content.ctaNote, ''] : []),
    ...(content.footnotes?.length ? [...content.footnotes, ''] : []),
    'D.A.O', 'Transparence · Précision · Confiance',
    ...(content.reason ? ['', content.reason] : []),
    '',
  ].join('\n');
}
