import { Suspense } from 'react';
import ProfessionalPublicProfile from '../../../../components/ProfessionalPublicProfile';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <Suspense fallback={<p>Chargement…</p>}><ProfessionalPublicProfile id={id}/></Suspense>;}
