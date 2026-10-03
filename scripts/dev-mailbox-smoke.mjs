#!/usr/bin/env node

const EXPECTED_CONTRACTOR = 'ahmedhattab.pro+dao-contractor@gmail.com';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing protected mailbox configuration: ${name}`);
  return value;
}

const key = required('RESEND_API_KEY');
const from = required('DAO_EMAIL_FROM');
const recipient = required('DAO_TEST_CONTRACTOR_EMAIL').trim().toLowerCase();
if (recipient !== EXPECTED_CONTRACTOR) throw new Error('Mailbox smoke refused: contractor alias is not approved');
const marker = `DAO-DEV-MAILBOX-${process.env.GITHUB_RUN_ID || Date.now()}`;

const response = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `dao-dev-mailbox/${marker}` },
  body: JSON.stringify({
    from, to: [recipient], subject: `D.A.O DEV mailbox smoke ${marker}`,
    text: 'D.A.O DEV mailbox smoke test. This message contains no credentials or invitation token.',
  }),
});
if (!response.ok) throw new Error(`Resend mailbox smoke failed (${response.status})`);
console.log(`MAILBOX_SMOKE send=PASS marker=${marker}`);
