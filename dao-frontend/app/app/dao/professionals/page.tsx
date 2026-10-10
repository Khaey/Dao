import Directory from '../../../../components/backoffice/Directory';
import Link from 'next/link';
export default function Page() { return <><Link href="/app/dao/professionals/dossiers" className="mb-4 inline-block text-sm font-semibold text-teal">Contrôler les fiches et médias professionnels</Link><Directory view="professionals" /></>; }
