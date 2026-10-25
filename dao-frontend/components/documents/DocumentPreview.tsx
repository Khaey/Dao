'use client';
import { useEffect, useRef, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { isDwg, signedDocumentUrl } from './dossier-model';

/**
 * Aperçu d’un PDF ou d’une image autorisé : l’URL signée courte n’est demandée qu’après le contrôle
 * d’accès serveur (RLS) et n’est jamais conservée. Aucun BIM/CAO dans ce MVP.
 */
export default function DocumentPreview({ document, onClose }: { document: { id: string; originalName: string; mimeType: string }; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    signedDocumentUrl(document.id).then(value => { if (active) setUrl(value); }).catch(exception => { if (active) setError(exception.message ?? 'Aperçu refusé.'); });
    return () => { active = false; };
  }, [document.id]);
  useEffect(() => {
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Un plan DWG (#464) n'est jamais rendu dans le navigateur : téléchargement uniquement.
  const dwg = isDwg(document.mimeType);
  const isImage = !dwg && document.mimeType.startsWith('image/');
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-6" onClick={onClose}>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Aperçu de ${document.originalName}`} onClick={event => event.stopPropagation()}
      className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl outline-none sm:rounded-2xl">
      <div className="flex items-center justify-between gap-3 border-b border-black/5 px-4 py-3">
        <p className="min-w-0 break-all text-sm font-semibold text-ink">{document.originalName}</p>
        <div className="flex shrink-0 gap-2">
          {url && <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-teal hover:bg-sand"><ExternalLink size={15} aria-hidden="true" />{dwg ? 'Télécharger' : 'Ouvrir'}</a>}
          <button type="button" onClick={onClose} aria-label="Fermer l’aperçu" className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-ink/65 hover:bg-sand"><X size={18} aria-hidden="true" /></button>
        </div>
      </div>
      <div className="min-h-[50vh] flex-1 overflow-auto bg-sand/60">
        {error ? <p role="alert" className="p-6 text-sm text-red-700">{error}</p>
          : !url ? <p className="p-6 text-sm text-ink/65">Préparation de l’aperçu…</p>
          : dwg ? <p className="p-6 text-sm text-ink/70">Aperçu indisponible pour un plan DWG. Utilisez « Télécharger » pour l’ouvrir dans votre logiciel de CAO.</p>
          : isImage ? <img src={url} alt={document.originalName} className="mx-auto max-h-[80vh] w-auto object-contain" />
          : <iframe src={url} title={`Aperçu de ${document.originalName}`} className="h-[75vh] w-full border-0" />}
      </div>
    </div>
  </div>;
}
