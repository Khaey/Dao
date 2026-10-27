import { redirect } from 'next/navigation';

/**
 * The award-scoped journal (#346 B2, #353) now lives in the single « Suivi du chantier » entry (#387 phase 2).
 * Old links (notifications, e-mails, bookmarks) land on its « Carnet de chantier » section; rights stay server-side.
 */
export default async function ExecutionPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  redirect(`/app/native-execution/${encodeURIComponent(projectId)}?section=journal`);
}
