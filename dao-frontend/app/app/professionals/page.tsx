import { Suspense } from 'react';
import ProfessionalDirectory from '../../../components/ProfessionalDirectory';
export default function Page(){return <Suspense fallback={<p role="status">Chargement de l’annuaire…</p>}><ProfessionalDirectory/></Suspense>;}
