'use client';

import { FormEvent, useState } from 'react';
import { AlertCircle, Check, Copy, Link2, Lock, MessageCircle, UserPlus } from 'lucide-react';
import { Card, Input, SectionHeading } from './ui';
import { projectApi, Team } from '../lib/collaboration';
import { cn } from '../lib/utils';
import InvitationEmailButton, { PreparedInvitation } from './InvitationEmailButton';
import { fieldClass, Pill, primaryAction, secondaryAction, type Tone } from '../app/app/projects/_components/ProjectUi';
import { RESTRICTED_MESSAGE, settingAvailable, useMySettings } from '../lib/settings';

const invitationLabels: Record<string, string> = { pending: 'En attente de confirmation', accepted: 'Acceptée', declined: 'Refusée', revoked: 'Révoquée', expired: 'Expirée' };
const invitationTones: Record<string, Tone> = { pending: 'clay', accepted: 'teal', declined: 'red', revoked: 'neutral', expired: 'neutral' };
const initials = (name?: string) => (name || 'P').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || 'P';
const labelClass = 'block text-sm font-semibold text-ink';
const checkboxClass = 'mt-0.5 h-5 w-5 shrink-0 rounded border-black/20 accent-teal';

export default function ProjectTeam({ projectId, team, needsClient, archived, lots, onChange, initialLotId, messageTarget, onMessage }: { projectId: string; team: Team; needsClient: boolean; archived: boolean; lots: { id: string; title: string }[]; messageTarget?: (member: Team['members'][number]) => string | null; onMessage?: (conversationMemberId: string) => void; onChange: (team: Team) => void; initialLotId?: string }) {
  const [recipientName, setRecipientName] = useState(''); const [email, setEmail] = useState(''); const [requestId, setRequestId] = useState(() => lots.some(lot => lot.id === initialLotId) ? initialLotId! : ''); const [privateAccess, setPrivateAccess] = useState(false);
  const [link, setLink] = useState(''); const [error, setError] = useState(''); const [saving, setSaving] = useState(false); const [copied, setCopied] = useState(false);
  const [invitation, setInvitation] = useState<PreparedInvitation | null>(null);
  const inviteAllowed = settingAvailable(useMySettings(team.is_client ? 'client' : undefined, projectId), 'client.invite_professionals');
  const canInvite = !archived && ((team.is_client && inviteAllowed) || (needsClient && team.can_prepare));
  const pendingLotIds = new Set(team.invitations.filter(invite => invite.expected_role === 'contractor' && invite.status === 'pending' && new Date(invite.expires_at).getTime() > Date.now()).map(invite => invite.principal_request_id).filter(Boolean));
  const availableLots = lots.filter(lot => !pendingLotIds.has(lot.id));
  const pendingClient = team.invitations.some(invite => invite.expected_role === 'client' && invite.status === 'pending' && new Date(invite.expires_at).getTime() > Date.now());
  async function refresh() { onChange(await projectApi<Team>(`/api/projects/team?project_id=${projectId}`)); }
  async function invite(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setCopied(false);
    if (email.trim() && !recipientName.trim()) { setError('Renseignez le nom du destinataire avec son email.'); setSaving(false); return; }
    if (!needsClient && !requestId) { setError('Choisissez le lot principal de cet artisan.'); setSaving(false); return; }
    try {
      const result = await projectApi('/api/projects/invitations', { project_id: projectId, expected_role: needsClient ? 'client' : 'contractor', recipient_email: email.trim() || null, recipient_name: recipientName.trim() || null, request_id: needsClient ? null : requestId, can_view_private_details: !needsClient && privateAccess });
      setLink(`${window.location.origin}/invite/${result.token}`);
      setInvitation({ id: result.id, token: result.token, hasEmail: Boolean(email.trim()) });
      setRecipientName(''); setEmail(''); setRequestId(''); setPrivateAccess(false); await refresh();
    } catch (exception: any) { setError(exception.message); } finally { setSaving(false); }
  }
  async function change(path: string, body: Record<string, unknown>) {
    setSaving(true); setError('');
    try { await projectApi(path, body); setLink(''); setInvitation(null); await refresh(); }
    catch (exception: any) { setError(exception.message); } finally { setSaving(false); }
  }
  const members = team.members.filter(member => member.status === 'accepted');
  return <div className="space-y-5">
    <Card className="p-5 sm:p-6"><SectionHeading title="Équipe du chantier" description="Les participants acceptés retrouvent ce chantier dans Mes chantiers." action={<span className="rounded-full bg-ink/[0.06] px-2.5 py-1 text-xs font-semibold tabular-nums text-ink/80">{members.length} participant{members.length > 1 ? 's' : ''}</span>} />
      {needsClient && <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-3 text-sm text-amber-900"><AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />Client à confirmer — le chantier reste en attente de confirmation du client.</p>}
      <ul className="mt-5 divide-y divide-black/[0.06] rounded-xl border border-black/[0.08]">{members.map(member => <li key={member.id} className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3"><span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${member.participation_role === 'client' ? 'bg-ink text-white' : 'bg-teal/10 text-teal'}`}>{initials(member.name)}</span><div className="min-w-0"><h3 className="break-words font-semibold text-ink">{member.name || 'Participant'}</h3><Pill tone={member.participation_role === 'client' ? 'neutral' : 'teal'} className="mt-1">{member.participation_role === 'client' ? 'Client' : 'Artisan / Entreprise'}</Pill></div></div>
          <div className="flex items-center gap-2">{(() => { const target = onMessage && messageTarget ? messageTarget(member) : null; return target ? <button type="button" aria-label={`Écrire à ${member.name || 'ce participant'}`} title={`Écrire à ${member.name || 'ce participant'}`} onClick={() => onMessage!(target)} className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-teal/10 text-teal transition hover:bg-teal hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"><MessageCircle size={18} aria-hidden="true" /></button> : null; })()}
          {team.is_client && !archived && member.participation_role === 'contractor' && <button type="button" disabled={saving} className="inline-flex min-h-11 items-center rounded-xl bg-white px-4 text-sm font-semibold text-red-700 ring-1 ring-inset ring-red-200 transition hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-50" onClick={() => { if (window.confirm('Retirer ce participant du chantier ?')) void change('/api/projects/members', { member_id: member.id, revoke: true }); }}>Retirer le participant</button>}</div>
        </div>
        {member.participation_role === 'contractor' && <label className="mt-3 flex min-h-11 items-start gap-3 rounded-lg bg-sand/70 px-3 py-2.5 text-sm text-ink"><input type="checkbox" className={checkboxClass} checked={member.can_view_private_details} disabled={!team.is_client || archived || saving} onChange={event => void change('/api/projects/members', { member_id: member.id, can_view_private_details: event.target.checked })} />Accès aux coordonnées privées pour {member.name || 'ce participant'}</label>}
      </li>)}</ul>
    </Card>
    {!archived && team.is_client && !inviteAllowed && <Card className="p-5 sm:p-6"><p className="rounded-xl bg-sand px-4 py-3 text-sm text-ink/70">{RESTRICTED_MESSAGE}</p></Card>}
    {canInvite && <Card className="p-5 sm:p-6"><SectionHeading title={needsClient ? 'Invitation au chantier — Client' : 'Inviter un artisan ou une entreprise'} description="Cette invitation donne accès au chantier. Elle est distincte d’un DAO sur invitation." />
      {pendingClient ? <p className="mt-4 rounded-xl bg-sand px-4 py-3 text-sm text-ink/70">Une invitation client est déjà en attente. Révoquez-la avant d’en créer une autre.</p> : <form onSubmit={invite} className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>{needsClient ? 'Nom du client' : 'Nom de l’artisan / entreprise'}<Input aria-label="Nom du destinataire" className="mt-2 min-h-11" value={recipientName} onChange={event => setRecipientName(event.target.value)} maxLength={160} required={Boolean(email.trim())} /></label>
        <label className={labelClass}>Email du destinataire — optionnel<Input aria-label="Email du destinataire — optionnel" className="mt-2 min-h-11" type="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
        {!needsClient && (availableLots.length > 0 ? <label className={cn(labelClass, 'sm:col-span-2')}>Lot principal<select aria-label="Lot principal de l’invitation" className={cn(fieldClass, 'mt-2')} value={requestId} onChange={event => setRequestId(event.target.value)} required><option value="">Choisir le lot concerné</option>{availableLots.map(lot => <option key={lot.id} value={lot.id}>{lot.title}</option>)}</select></label> : <p className="rounded-xl bg-sand px-4 py-3 text-sm text-ink/70 sm:col-span-2">Aucun lot disponible pour une nouvelle invitation. Ajoutez un lot ou libérez un lot déjà affecté / invité.</p>)}
        {!needsClient && <div className="space-y-3 sm:col-span-2"><p className="text-xs text-ink/65">L’artisan sera automatiquement rattaché à ce lot après acceptation. Vous pourrez ensuite lui ajouter d’autres lots.</p><label className="flex min-h-11 items-start gap-3 rounded-lg bg-sand/70 px-3 py-2.5 text-sm text-ink"><input type="checkbox" checked={privateAccess} onChange={event => setPrivateAccess(event.target.checked)} className={checkboxClass} /><span className="flex items-start gap-1.5"><Lock size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-ink/55" />Autoriser l’accès aux coordonnées privées du chantier</span></label></div>}
        <div className="sm:col-span-2"><button type="submit" className={primaryAction} disabled={saving || (!needsClient && (!requestId || availableLots.length === 0))}><UserPlus size={16} aria-hidden="true" />{saving ? 'Préparation…' : 'Préparer l’invitation'}</button></div>
      </form>}
      {link && <div className="mt-5 space-y-3 rounded-xl border border-teal/20 bg-teal/[0.05] p-4">
        <p role="status" className="flex items-center gap-2 text-sm font-semibold text-teal"><Link2 size={16} aria-hidden="true" />Invitation prête : transmettez ce lien au destinataire.</p>
        <Input aria-label="Lien d’invitation" className="min-h-11 font-mono text-xs" value={link} readOnly onFocus={event => event.currentTarget.select()} />
        <div className="flex flex-wrap items-start gap-3"><button type="button" className={primaryAction} onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setError('Sélectionnez et copiez le lien ci-dessus.'); } }}>{copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{copied ? 'Lien copié' : 'Copier le lien'}</button>{invitation && <InvitationEmailButton key={invitation.id} invitation={invitation} />}</div>
        <p className="text-xs text-ink/65">Ce lien à usage unique expire dans sept jours.</p>
      </div>}
    </Card>}
    {team.invitations.length > 0 && <Card className="p-5 sm:p-6"><SectionHeading title="Invitations au chantier" /><ul className="mt-4 divide-y divide-black/[0.06] rounded-xl border border-black/[0.08]">{team.invitations.map(invitation => { const expired = invitation.status === 'pending' && new Date(invitation.expires_at).getTime() <= Date.now(); const statusKey = expired ? 'expired' : invitation.status; return <li key={invitation.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0"><p className="break-words font-semibold text-ink">{invitation.recipient_name || (invitation.expected_role === 'client' ? 'Client' : 'Artisan / Entreprise')}</p><p className="break-all text-sm text-ink/65">{invitation.recipient_email || 'Lien à transmettre directement'}</p>{invitation.principal_request_id && <p className="mt-1 text-xs text-ink/65">Lot principal : {lots.find(lot => lot.id === invitation.principal_request_id)?.title || 'Lot du chantier'}</p>}<Pill tone={invitationTones[statusKey] ?? 'neutral'} className="mt-2">{expired ? 'Expirée' : invitationLabels[invitation.status] || 'Statut à préciser'}</Pill></div>
      {invitation.status === 'pending' && !expired && canInvite && <button type="button" disabled={saving} className={cn(secondaryAction, 'self-start sm:self-auto')} onClick={() => void change('/api/projects/invitations/revoke', { invitation_id: invitation.id })}>Révoquer l’invitation</button>}
    </li>; })}</ul></Card>}
    {error && <p role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />{error}</p>}
  </div>;
}
