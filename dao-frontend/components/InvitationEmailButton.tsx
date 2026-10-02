'use client';

import { useRef, useState } from 'react';
import { Button } from './ui';
import { projectApi } from '../lib/collaboration';

export type PreparedInvitation = { id: string; token: string; hasEmail: boolean };
const failure = "L'invitation n'a pas pu être envoyée. Vous pouvez réessayer ou copier le lien.";

export default function InvitationEmailButton({ invitation }: { invitation: PreparedInvitation }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  async function send() {
    if (inFlight.current || sent || !invitation.hasEmail) return;
    inFlight.current = true; setSending(true); setError('');
    try {
      const result = await projectApi<{ sent: boolean; recipient_masked: string }>(`/api/project-invitations/${invitation.id}/send-email`, { token: invitation.token });
      if (result?.sent !== true) throw new Error('Email not accepted');
      setRecipient(result.recipient_masked); setSent(true);
    } catch {
      // Do not expose backend/provider errors or credentials in the interface.
      setError(failure);
    } finally { inFlight.current = false; setSending(false); }
  }
  return <div className="min-w-0 space-y-2">
    <Button type="button" disabled={!invitation.hasEmail || sending || sent} onClick={() => void send()}>
      {sending ? 'Envoi…' : sent ? 'Invitation envoyée ✓' : 'Envoyer par e-mail'}
    </Button>
    {!invitation.hasEmail && <p className="text-sm text-black/55">Aucune adresse e-mail renseignée. Copiez le lien pour transmettre l’invitation.</p>}
    {sent && <p role="status" className="break-words text-sm text-teal">Invitation envoyée à {recipient}</p>}
    {error && <p role="alert" className="max-w-md text-sm text-red-700">{error}</p>}
  </div>;
}
