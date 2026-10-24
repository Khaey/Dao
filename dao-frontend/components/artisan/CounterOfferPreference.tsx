'use client';
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '../../lib/supabase-browser';
import { Card } from '../ui';

export default function CounterOfferPreference() {
  const [value, setValue] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { let active=true;
    void supabaseBrowser().rpc('my_bid_counter_preference').then(({data,error}) => {
      if(!active) return;
      if(error) setError('Préférence indisponible. Réessayez après activation du service.');
      else {setValue(data===true);setReady(true);}
    });
    return () => {active=false;};
  }, []);
  async function change(checked: boolean) {
    setBusy(true);setError('');
    const {data,error}=await supabaseBrowser().rpc('set_my_bid_counter_preference',{p_allowed:checked});
    if(error || data!==checked) setError('Modification non enregistrée. Réessayez.');
    else setValue(checked);
    setBusy(false);
  }
  return <Card className="space-y-3">
    <h2 className="text-lg font-bold text-ink">Négociation des devis</h2>
    <p className="text-sm text-black/60">Choisissez si les Clients peuvent vous proposer un autre montant avant l’attribution d’un lot. Votre devis déjà soumis reste inchangé.</p>
    <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-ink">
      <input type="checkbox" checked={value} disabled={!ready||busy} onChange={e=>void change(e.target.checked)} className="h-5 w-5 accent-teal" />
      Autoriser les contre-propositions des Clients
    </label>
    {!ready && !error && <p role="status" className="text-xs text-black/50">Chargement de votre préférence…</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </Card>;
}
