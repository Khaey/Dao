import { CheckCircle2, Clock3, ShieldAlert } from 'lucide-react';
import type { ContractDetail } from '../../lib/contracts';

/** P2.2-E1 — read-only readiness. Never generates signature requests or legal status. */
export default function SignatureReadiness({ detail }: { detail: ContractDetail }) {
  const { contract, version, parties, acceptances } = detail;
  const versionReady = Boolean(
    version && version.id === contract.current_version_id &&
    /^[a-f0-9]{64}$/i.test(version.content_hash),
  );
  const identityRoles = ['client', 'contractor', 'dao'] as const;
  const partyReady = identityRoles.every(role =>
    parties.some(party => party.role === role && Boolean(party.legal_name?.trim())),
  );
  // The server only returns acceptances for current_version_id. Never infer consent
  // from historical acceptances that happened on a different document version.
  const clientAccepted = versionReady && acceptances.some(row => row.party_role === 'client');
  const contractorAccepted = versionReady && acceptances.some(row => row.party_role === 'contractor');
  const daoChecked = contract.status === 'ready' && Boolean(contract.validated_at);
  const prerequisites = [
    { label: 'Version contractuelle figée', complete: versionReady, detail: versionReady
      ? 'Empreinte SHA-256 de la version courante présente.'
      : 'La version de référence ou son empreinte doit être vérifiée.' },
    { label: 'Client, Artisan et D.A.O. identifiés', complete: partyReady, detail: partyReady
      ? 'Les trois noms juridiques sont renseignés ; leurs mandats restent à contrôler.'
      : 'Les trois parties doivent être renseignées avant toute signature.' },
    { label: 'Accord technique du Client sur cette version', complete: clientAccepted, detail: clientAccepted
      ? 'Accord enregistré sur la version en cours, distinct de la signature.'
      : 'Aucun accord technique sur la version courante n’est enregistré.' },
    { label: 'Accord technique de l’Artisan sur cette version', complete: contractorAccepted, detail: contractorAccepted
      ? 'Accord enregistré sur la version en cours, distinct de la signature.'
      : 'Aucun accord technique sur la version courante n’est enregistré.' },
    { label: 'Contrôle technique D.A.O.', complete: daoChecked, detail: daoChecked
      ? 'Dossier contrôlé, mais juridiquement non signé.'
      : 'Le contrôle technique final de D.A.O. n’est pas terminé.' },
    { label: 'Fournisseur et validation juridique de signature', complete: false, detail:
      'Non activés : clauses, identité des signataires, certificat et vérification cryptographique à valider.' },
  ];
  const readyCount = prerequisites.filter(item => item.complete).length;
  return <section role="region" aria-labelledby="contract-signature-title" className="rounded-2xl border border-black/[0.08] bg-white p-5 sm:p-6">
    <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal">Contrat tripartite · préparation</p>
    <h2 id="contract-signature-title" className="mt-1 text-xl font-bold text-ink">Préparer la signature du contrat</h2>
    <p className="mt-2 text-sm leading-relaxed text-black/65">Pour une signature future, l’Artisan et le Client devront signer exactement le même document et D.A.O. devra en contrôler les preuves. Ce parcours n’est pas encore ouvert.</p>
    <div className="mt-4 flex items-start gap-2 rounded-xl border border-clay/20 bg-clay/[0.06] px-4 py-3 text-sm text-ink" role="note">
      <ShieldAlert className="mt-0.5 shrink-0 text-clay" aria-hidden="true" size={18} />
      <div><strong>Signature électronique non activée — contrat non signé.</strong>
        <p className="mt-1 text-black/65">Un accord technique, même confirmé par D.A.O., n’est pas une signature électronique juridiquement vérifiée. Aucun paiement ni démarrage des travaux n’en résulte.</p>
      </div>
    </div>
    <p className="mt-5 text-sm font-semibold text-ink">Préparation du dossier : {readyCount} étape{readyCount > 1 ? 's' : ''} vérifiée{readyCount > 1 ? 's' : ''} sur {prerequisites.length}</p>
    <ol className="mt-3 space-y-3">{prerequisites.map((item, index) => <li key={item.label} className="flex items-start gap-3 rounded-xl bg-sand/60 p-3">
      {item.complete ? <CheckCircle2 size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-teal" /> : <Clock3 size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-clay" />}
      <div><p className="text-sm font-semibold text-ink">{index + 1}. {item.label}</p><p className="mt-0.5 text-xs leading-relaxed text-black/60">{item.detail}</p></div>
      <span className="sr-only">{item.complete ? 'Étape vérifiée' : 'Étape en attente'}</span>
    </li>)}</ol>
    <p className="mt-4 text-xs leading-relaxed text-black/55">Une fois le prestataire de confiance intégré et validé juridiquement, une nouvelle version figée du document, les signatures vérifiées et la validation D.A.O. pourront être reliées aux preuves d’archivage. Aucune signature n’est demandée depuis cet écran.</p>
  </section>;
}
