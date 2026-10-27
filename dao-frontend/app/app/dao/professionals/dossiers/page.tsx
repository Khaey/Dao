import ProfessionalDirectory from '../../../../../components/ProfessionalDirectory';
import { StaffTabs, professionalTabs } from '../../../../../components/backoffice/PageChrome';
export default function Page(){return <><div className="mx-auto mb-5 max-w-6xl"><StaffTabs label="Vues des professionnels" tabs={professionalTabs} current="/app/dao/professionals/dossiers" /></div><ProfessionalDirectory review/></>;}
