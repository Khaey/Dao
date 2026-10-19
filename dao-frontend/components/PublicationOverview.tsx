import { ArrowRight, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { Card } from './ui';
import type { PublicationSummary } from './publication-state';

function Tile({ title, ok, value, hint }: { title: string; ok: boolean; value: string; hint: string }) {
  const Icon = ok ? Eye : EyeOff;
  return <div className="min-w-0 rounded-2xl border border-black/[0.06] bg-white p-4">
    <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-black/45"><Icon aria-hidden="true" size={14} className={ok ? 'text-teal' : 'text-clay'} />{title}</p>
    <p className={`mt-1.5 text-base font-bold ${ok ? 'text-teal' : 'text-ink'}`}>{value}</p>
    <p className="mt-1 text-xs leading-relaxed text-black/55">{hint}</p>
  </div>;
}

/** Owner overview: what clients actually see today and what is missing, with a shortcut to each section. */
export default function PublicationOverview({ summary, onOpen }: { summary: PublicationSummary; onOpen: (section: number) => void }) {
  const { profile, logo, projects, media, todo } = summary;
  return <Card role="region" className="space-y-4 p-5 sm:p-6" aria-labelledby="publication-overview-title">
    <div>
      <h2 id="publication-overview-title" className="text-lg font-bold text-ink">Ce que voient les clients</h2>
      <p className="mt-1 text-sm text-black/55">Envoyer un fichier ne le publie pas : chaque élément est visible seulement après votre autorisation et la validation de D.A.O.</p>
    </div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Tile title="Fiche" ok={profile.visible} value={profile.visible ? 'Publiée' : profile.label} hint={profile.why} />
      <Tile title="Logo" ok={Boolean(logo?.visible)} value={logo ? (logo.visible ? 'Affiché' : logo.label) : 'Initiales affichées'} hint={logo ? logo.why : 'Aucun logo envoyé.'} />
      <Tile title="Réalisations" ok={projects.visible > 0} value={`${projects.visible} sur ${projects.total} visible${projects.visible > 1 ? 's' : ''}`} hint={projects.total ? 'Une réalisation est visible une fois validée par D.A.O. et votre fiche publiée.' : 'Aucune réalisation décrite.'} />
      <Tile title="Photos et documents" ok={media.visible > 0} value={`${media.visible} sur ${media.total} visible${media.visible > 1 ? 's' : ''}`} hint="Un média est visible s’il est autorisé, validé et rattaché à une réalisation visible." />
    </div>
    {todo.length > 0 ? <div className="rounded-2xl bg-sand/60 p-4">
      <h3 className="text-sm font-bold text-ink">Prochaines étapes</h3>
      <ul className="mt-2 space-y-1.5">{todo.slice(0, 5).map((item, index) => <li key={index} className="flex flex-wrap items-center justify-between gap-2 text-sm text-black/70">
        <span className="min-w-0 flex-1">{item.text}</span>
        <button type="button" onClick={() => onOpen(item.section)} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-teal hover:bg-teal/5">Ouvrir<ArrowRight aria-hidden="true" size={14} /><span className="sr-only"> la section concernée</span></button>
      </li>)}</ul>
      {todo.length > 5 && <p className="mt-2 text-xs text-black/50">+ {todo.length - 5} autre{todo.length - 5 > 1 ? 's' : ''} élément{todo.length - 5 > 1 ? 's' : ''} à compléter dans les sections ci-dessous.</p>}
    </div> : <p className="flex items-center gap-2 rounded-2xl bg-teal/[0.06] px-4 py-3 text-sm font-medium text-teal"><CheckCircle2 aria-hidden="true" size={16} />Tout ce que vous avez préparé est visible par les clients.</p>}
  </Card>;
}
