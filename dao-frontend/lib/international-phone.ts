/** Formats an explicitly international phone number for the existing E.164 database constraint.
 * Never guesses the country for national/trunk numbers or accepts extensions. */
export function normalizeInternationalPhone(input:unknown,field='Numéro'):string {
  if(typeof input!=='string') throw new Error(`${field} : indiquez un numéro international commençant par + et l’indicatif pays.`);
  const raw=input.trim();
  if(!raw)return '';
  const opens=(raw.match(/\(/g)||[]).length,closes=(raw.match(/\)/g)||[]).length;
  if(!/^\+[0-9\s().-]+$/.test(raw)||/\(\s*0\s*\)/.test(raw)||opens!==closes)
    throw new Error(`${field} : utilisez + et l’indicatif pays, puis le numéro, sans extension ni zéro de tronc entre parenthèses.`);
  const normalized=raw.replace(/[\s().-]/g,'');
  if(!/^\+[1-9][0-9]{6,14}$/.test(normalized))
    throw new Error(`${field} : format international invalide (7 à 15 chiffres après +, indicatif inclus).`);
  return normalized;
}
