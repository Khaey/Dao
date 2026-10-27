'use client';
import { useState } from 'react';
import { Card, SectionHeading } from '../ui';
import DocumentDossier from './DocumentDossier';

/** « Plans et documents du lot » (#456) : uniquement les familles rattachées aux lots que l’utilisateur détient. */
export default function LotDocumentsCard({ projectId, userId }: { projectId: string; userId: string }) {
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});
  return <Card className="p-5 sm:p-6">
    <SectionHeading title="Plans et documents du lot" description="Versions applicables des plans et pièces techniques partagés avec votre lot, versions précédentes et revue technique." />
    {message.error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{message.error}</p>}
    {message.success && <p role="status" className="mt-4 rounded-xl bg-teal/10 p-3 text-sm text-teal">{message.success}</p>}
    <DocumentDossier projectId={projectId} userId={userId} mode="lot" onMessage={setMessage} />
  </Card>;
}
