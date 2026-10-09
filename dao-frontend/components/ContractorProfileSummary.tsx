'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabaseBrowser } from '../lib/supabase-browser';
import { Badge, Card, SectionHeading } from './ui';

type ContractorProfile = {
  id: string;
  business_name: string;
  contractor_type: string | null;
  public_trade_name: string;
  public_presentation: string;
  years_experience: number | null;
  availability: string;
  available_from: string | null;
  verification_status: string;
  public_identity_status: string;
};

const typeLabels: Record<string, string> = {
  artisan: 'Artisan',
  company: 'Entreprise',
  general_contractor: 'Entreprise générale',
  independent_professional: 'Professionnel indépendant',
};
const availabilityLabels: Record<string, string> = {
  available: 'Disponible',
  scheduled: 'Disponible à partir d’une date',
  unavailable: 'Indisponible',
  to_discuss: 'À discuter',
};
const verificationLabels: Record<string, string> = {
  pending: 'En attente de vérification',
  verified: 'Vérifié',
  rejected: 'Corrections demandées',
  suspended: 'Suspendu',
};
const identityLabels: Record<string, string> = {
  draft: 'Brouillon',
  approved: 'Publique',
  hidden: 'Masquée',
};

export default function ContractorProfileSummary() {
  const [profile, setProfile] = useState<ContractorProfile | null>(null);
  const [tradeNames, setTradeNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      const supabase = supabaseBrowser();
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) { setError('Session expirée.'); setLoading(false); return; }
      const profileResult = await supabase.from('contractor_profiles')
        .select('id,business_name,contractor_type,public_trade_name,public_presentation,years_experience,availability,available_from,verification_status,public_identity_status')
        .eq('user_id', userData.user.id).maybeSingle();
      if (profileResult.error || !profileResult.data) { setError('Profil professionnel introuvable.'); setLoading(false); return; }
      const links = await supabase.from('contractor_trades').select('trade_id,trades(name_fr)').eq('contractor_id', profileResult.data.id);
      if (links.error) setError('Les métiers du profil ne peuvent pas être chargés.');
      setProfile(profileResult.data as ContractorProfile);
      setTradeNames((links.data ?? []).map((row: any) => row.trades?.name_fr).filter(Boolean));
      setLoading(false);
    })();
  }, []);

  const completion = useMemo(() => profile ? Math.round([
    profile.business_name,
    profile.contractor_type,
    profile.public_trade_name,
    profile.public_presentation,
    profile.years_experience != null,
    tradeNames.length > 0,
  ].filter(Boolean).length / 6 * 100) : 0, [profile, tradeNames]);

  if (loading) return <Card id="professional-profile">Chargement du profil professionnel…</Card>;
  if (!profile) return <Card id="professional-profile"><p role="alert" className="text-sm text-red-700">{error || 'Profil professionnel introuvable.'}</p></Card>;

  return <Card id="professional-profile">
    <SectionHeading eyebrow="Espace artisan" title="Profil professionnel" description="Les informations actuellement enregistrées pour votre activité." />
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <Badge tone={profile.verification_status === 'verified' ? 'teal' : profile.verification_status === 'suspended' ? 'red' : 'clay'}>{verificationLabels[profile.verification_status] ?? profile.verification_status}</Badge>
      <Badge>{`Identité ${identityLabels[profile.public_identity_status] ?? profile.public_identity_status}`}</Badge>
      <span className="text-sm text-black/50">Profil complété à {completion}%</span>
    </div>
    {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-xl bg-sand p-3"><p className="text-xs text-black/45">Activité</p><p className="mt-1 font-semibold">{profile.business_name}</p></div>
      <div className="rounded-xl bg-sand p-3"><p className="text-xs text-black/45">Nom public</p><p className="mt-1 font-semibold">{profile.public_trade_name || 'À compléter'}</p></div>
      <div className="rounded-xl bg-sand p-3"><p className="text-xs text-black/45">Type</p><p className="mt-1 font-semibold">{typeLabels[profile.contractor_type ?? ''] || 'À compléter'}</p></div>
      <div className="rounded-xl bg-sand p-3"><p className="text-xs text-black/45">Disponibilité</p><p className="mt-1 font-semibold">{availabilityLabels[profile.availability] ?? profile.availability}</p>{profile.available_from && <p className="mt-1 text-xs text-black/45">À partir du {new Date(profile.available_from).toLocaleDateString('fr-TN')}</p>}</div>
    </div>
    <div className="mt-4 space-y-2 text-sm text-black/60">
      <p><span className="font-semibold text-ink">Métiers :</span> {tradeNames.length ? tradeNames.join(' · ') : 'À compléter'}</p>
      <p><span className="font-semibold text-ink">Expérience :</span> {profile.years_experience == null ? 'À compléter' : `${profile.years_experience} an${profile.years_experience > 1 ? 's' : ''}`}</p>
      <p className="whitespace-pre-wrap"><span className="font-semibold text-ink">Présentation :</span> {profile.public_presentation || 'À compléter'}</p>
    </div>
    <p className="mt-4 rounded-xl bg-sand px-4 py-3 text-xs text-black/55">La modification de la fiche professionnelle sera activée après validation de la règle de re-vérification par D.A.O.</p>
  </Card>;
}
