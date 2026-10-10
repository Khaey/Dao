import ProfessionalDossierReview from '../../../../../../components/ProfessionalDossierReview';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <ProfessionalDossierReview id={id}/>;}
