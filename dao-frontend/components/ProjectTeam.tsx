'use client';

import { FormEvent, useState } from 'react';
import { Button, Card, Input, SectionHeading, Badge } from './ui';
import { projectApi, Team } from '../lib/collaboration';
import InvitationEmailButton, { PreparedInvitation } from './InvitationEmailButton';

const invitationLabels: Record<string, string> = { pending: 'En attente de confirmation', accepted: 'Acceptée', declined: 'Refusée', revoked: 'Révoquée', expired: 'Expirée' };
export default function ProjectTeam({ projectId, team, needsClient, archived, onChange }: { projectId: string; team: Team; needsClient: boolean; archived: boolean; onChange: (team: Team) => void }) {
  const [email, setEmail] = useState(''); const [privateAccess, setPrivateAccess] = useState(false);
  const [link, setLink] = useState(''); const [error, setError] = useState(''); const [saving, setSaving] = useState(false); const [copied, setCopied] = useState(false);
  const [invitation, setInvitation] = useState<PreparedInvitation | null>(null);
  const canInvite = !archived && (team.is_client || (needsClient && team.can_prepare));
  const pendingClient = team.invitations.some(invite => invite.expected_role === 'client' && invite.status === 'pending' && new Date(invite.expires_at).getTime() > Date.now());
  async function refresh() { onChange(await projectApi<Team>(`/api/projects/team?project_id=${projectId}`)); }
  async function invite(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setCopied(false);
    try {
      const result = await projectApi('/api/projects/invitations', { project_id: projectId, expected_role: needsClient ? 'client' : 'contractor', recipient_email: email.trim() || null, can_view_private_details: !needsClient && privateAccess });
      setLink(`${window.location.origin}/invite/${result.token}`);
      setInvitation({ id: result.id, token: result.token, hasEmail: Boolean(email.trim()) });
      setEmail(''); setPrivateAccess(false); await refresh();
    } catch (exception: any) { setError(exception.message); } finally { setSaving(false); }
  }
  async function change(path: string, body: Record<string, unknown>) {
    setSaving(true); setError('');
    try { await projectApi(path, body); setLink(''); setInvitation(null); await refresh(); }
    catch (exception: any) { setError(exception.message); } finally { setSaving(false); }
  }
  return <div className="space-y-5">
    <Card><SectionHeading title="Équipe du chantier" description="Les participants acceptés retrouvent ce chantier dans Mes chantiers." />{needsClient && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Client à confirmer — le chantier reste en attente de confirmation du client.</p>}
      <div className="mt-5 space-y-3">{team.members.filter(member => member.status === 'accepted').map(member => <article key={member.id} className="rounded-xl border border-black/10 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">{member.name || 'Participant'}</h3><Badge>{member.participation_role === 'client' ? 'Client' : 'Artisan / Entreprise'}</Badge></div>{team.is_client && !archived && member.participation_role === 'contractor' && <Button disabled={saving} className="bg-white text-red-700 ring-1 ring-red-100 hover:bg-red-50" onClick={() => { if (window.confirm('Retirer ce participant du chantier ?')) void change('/api/projects/members', { member_id: member.id, revoke: true }); }}>Retirer le participant</Button>}</div>{member.participation_role === 'contractor' && <label className="mt-4 flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 accent-teal" checked={member.can_view_private_details} disabled={!team.is_client || archived || saving} onChange={event => void change('/api/projects/members', { member_id: member.id, can_view_private_details: event.target.checked })} />Accès aux coordonnées privées pour {member.name || 'ce participant'}</label>}</article>)}</div>
    </Card>
    {canInvite && <Card><SectionHeading title={needsClient ? 'Invitation au chantier — Client' : 'Inviter un artisan ou une entreprise'} description="Cette invitation donne accès au chantier. Elle est distincte d’un DAO sur invitation." />{pendingClient ? <p className="mt-4 text-sm text-black/60">Une invitation client est déjà en attente. Révoquez-la avant d’en créer une autre.</p> : <form onSubmit={invite} className="mt-5 space-y-4"><label className="block text-sm font-semibold">Email du destinataire — optionnel<Input aria-label="Email du destinataire — optionnel" type="email" value={email} onChange={event => setEmail(event.target.value)} /></label>{!needsClient && <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={privateAccess} onChange={event => setPrivateAccess(event.target.checked)} className="mt-1 accent-teal" />Autoriser l’accès aux coordonnées privées du chantier</label>}<Button disabled={saving}>{saving ? 'Préparation…' : 'Préparer l’invitation'}</Button></form>}{link && <div className="mt-5 space-y-3 rounded-xl bg-teal/5 p-4"><p role="status" className="text-sm font-semibold text-teal">Invitation prête : transmettez ce lien au destinataire.</p><Input aria-label="Lien d’invitation" value={link} readOnly /><div className="flex flex-wrap items-start gap-3"><Button onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setError('Sélectionnez et copiez le lien ci-dessus.'); } }}>{copied ? 'Lien copié' : 'Copier le lien'}</Button>{invitation && <InvitationEmailButton key={invitation.id} invitation={invitation} />}</div><p className="text-xs text-black/50">Ce lien à usage unique expire dans sept jours.</p></div>}</Card>}
    {team.invitations.length > 0 && <Card><SectionHeading title="Invitations au chantier" /><div className="mt-4 space-y-3">{team.invitations.map(invitation => { const expired = invitation.status === 'pending' && new Date(invitation.expires_at).getTime() <= Date.now(); return <article key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-sand p-4"><div><p className="font-semibold">{invitation.expected_role === 'client' ? 'Client' : 'Artisan / Entreprise'}</p><p className="text-sm text-black/55">{invitation.recipient_email || 'Lien à transmettre directement'}</p><p className="mt-1 text-xs text-black/55">{expired ? 'Expirée' : invitationLabels[invitation.status] || invitation.status}</p></div>{invitation.status === 'pending' && !expired && canInvite && <Button disabled={saving} className="bg-white text-ink ring-1 ring-black/10 hover:bg-sand" onClick={() => void change('/api/projects/invitations/revoke', { invitation_id: invitation.id })}>Révoquer l’invitation</Button>}</article>; })}</div></Card>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
  </div>;
}
