import OutboxStatus from '../../../../../components/backoffice/OutboxStatus';
import { StaffHeader, StaffTabs, historyTabs } from '../../../../../components/backoffice/PageChrome';
export default function Page() {
  return <section className="mx-auto max-w-6xl space-y-5">
    <StaffHeader group="Gouvernance" title="Historique" crumb="Emails de suivi" description="Envois déclenchés après une validation métier, avec leurs tentatives et erreurs." />
    <StaffTabs label="Vues de l’historique" tabs={historyTabs} current="/app/dao/history/emails" />
    <OutboxStatus />
  </section>;
}
