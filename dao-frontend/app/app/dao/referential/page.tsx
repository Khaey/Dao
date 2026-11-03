import { Suspense } from 'react';
import ReferentialAdmin from '../../../../components/referential/ReferentialAdmin';

// Entrée unique « Référentiel » du menu Admin (#547). L'autorisation est revérifiée en base.
export default function Page() {
  return <Suspense fallback={<p role="status">Chargement…</p>}><ReferentialAdmin /></Suspense>;
}
