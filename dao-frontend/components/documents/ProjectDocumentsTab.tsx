'use client';
import { useState } from 'react';
import { Upload } from 'lucide-react';
import { Card, SectionHeading } from '../ui';
import { cn } from '../../lib/utils';
import { projectApi } from '../../lib/collaboration';
import { supabaseBrowser } from '../../lib/supabase-browser';
import { fieldClass, primaryAction } from '../../app/app/projects/_components/ProjectUi';
import DocumentDossier, { type LegacyDocument } from './DocumentDossier';

/**
 * Onglet « Documents et plans » du chantier (#456). Le dépôt privé existant est conservé tel quel
 * (URL signée, contrôle du fichier, partage explicite) ; le classement et les versions s’y ajoutent.
 */
export default function ProjectDocumentsTab({ projectId, userId, canUpload, documents, onRefresh }: {
  projectId: string; userId: string; canUpload: boolean; documents: LegacyDocument[]; onRefresh: () => Promise<void>;
}) {
  const [shareScope, setShareScope] = useState('owner_only');
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});
  async function upload(file: File) {
    setUploading(true); setMessage({});
    try {
      const data = await projectApi<{ path: string; token: string }>('/api/documents/project', { project_id: projectId, original_name: file.name, mime_type: file.type, size_bytes: file.size, share_scope: shareScope });
      const result = await supabaseBrowser().storage.from('dao-private').uploadToSignedUrl(data.path, data.token, file);
      if (result.error) throw result.error;
      await onRefresh();
      setMessage({ success: 'Document envoyé pour contrôle. Vous pouvez le classer comme plan ou pièce technique.' });
    } catch (exception: any) { setMessage({ error: exception.message ?? 'Upload refusé.' }); }
    finally { setUploading(false); }
  }
  return <Card className="p-5 sm:p-6">
    <SectionHeading title="Documents et plans" description="PDF, JPG, PNG ou WebP, 20 Mo maximum. Les fichiers restent privés pendant le contrôle ; classez-les pour suivre leurs versions et leur revue technique."
      action={canUpload ? <label className={cn(primaryAction, 'cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-teal')}><Upload size={16} aria-hidden="true" />{uploading ? 'Envoi…' : 'Ajouter'}<input aria-label="Ajouter un document" className="sr-only" type="file" accept=".pdf,image/jpeg,image/png,image/webp" disabled={uploading} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ''; }} /></label> : undefined} />
    {canUpload && <label className="mt-5 block max-w-sm text-sm font-semibold text-ink">Partage du nouveau document<select aria-label="Partage du nouveau document" className={cn(fieldClass, 'mt-2')} value={shareScope} onChange={event => setShareScope(event.target.value)}><option value="owner_only">Moi uniquement</option><option value="project_members">Membres du chantier après contrôle</option></select></label>}
    {message.error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{message.error}</p>}
    {message.success && <p role="status" className="mt-4 rounded-xl bg-teal/10 p-3 text-sm text-teal">{message.success}</p>}
    <DocumentDossier projectId={projectId} userId={userId} legacyDocuments={documents} canUpload={canUpload} onLegacyChanged={onRefresh} onMessage={setMessage} />
  </Card>;
}
