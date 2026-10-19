import { DomainError } from '../lib/errors.js';

const ascii=(value:unknown)=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7E]/g,'?');
const money=(millimes:number)=>`${(millimes/1000).toFixed(3)} TND`;
const escapePdf=(value:string)=>ascii(value).replace(/([\\()])/g,'\\$1');

function makePdf(lines:string[]) {
  const visible=lines.slice(0,48);
  const content=['BT','/F1 11 Tf','50 790 Td',...visible.flatMap((line,index)=>index===0?[`(${escapePdf(line)}) Tj`]:['0 -15 Td',`(${escapePdf(line)}) Tj`]),'ET'].join('\n');
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body='%PDF-1.4\n'; const offsets=[0];
  objects.forEach((object,index)=>{offsets.push(body.length);body+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=body.length;body+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(value=>String(value).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(body);
}

export class QuotePdfService {
  constructor(private readonly db:any) {}
  async export(versionId:string) {
    const versionResult=await this.db.from('bid_versions').select('id,version_no,submitted_at,quote_valid_until,quote_terms,material_references,contractor_profiles(business_name)').eq('id',versionId).single();
    if(versionResult.error||!versionResult.data)throw new DomainError('Quote not found','NOT_FOUND');
    const itemsResult=await this.db.from('bid_items').select('id,price_millimes,duration_days,inclusions,exclusions,project_request_versions(title)').eq('bid_version_id',versionId).order('created_at');
    if(itemsResult.error)throw itemsResult.error;
    const itemIds=(itemsResult.data??[]).map((item:any)=>item.id);
    const quoteResult=itemIds.length?await this.db.from('bid_quote_lines').select('bid_item_id,position,designation,unit,quantity_milli,unit_price_millimes,total_millimes').in('bid_item_id',itemIds).order('position'):{data:[],error:null};
    if(quoteResult.error)throw quoteResult.error;
    const contractor=Array.isArray(versionResult.data.contractor_profiles)?versionResult.data.contractor_profiles[0]:versionResult.data.contractor_profiles;
    const lines=[`DEVIS D.A.O. - Version ${versionResult.data.version_no}`,`Artisan / entreprise: ${contractor?.business_name??'Professionnel verifie'}`,`Date: ${new Date(versionResult.data.submitted_at??Date.now()).toLocaleDateString('fr-TN')}`];
    if(versionResult.data.quote_valid_until)lines.push(`Validite annoncee: ${versionResult.data.quote_valid_until}`);
    for(const item of itemsResult.data??[]){const request=Array.isArray(item.project_request_versions)?item.project_request_versions[0]:item.project_request_versions;lines.push('',`LOT: ${request?.title??'Lot'} - ${money(Number(item.price_millimes))} - ${item.duration_days} jours`);for(const quote of quoteResult.data??[]){if(quote.bid_item_id===item.id)lines.push(`${quote.designation} | ${Number(quote.quantity_milli)/1000} ${quote.unit} x ${money(Number(quote.unit_price_millimes))} = ${money(Number(quote.total_millimes))}`);}lines.push(`Inclus: ${item.inclusions}`);if(item.exclusions)lines.push(`Exclusions: ${item.exclusions}`);}
    if(versionResult.data.material_references)lines.push('',`Materiaux / references: ${versionResult.data.material_references}`);
    if(versionResult.data.quote_terms)lines.push(`Conditions / garantie annoncees: ${versionResult.data.quote_terms}`);
    lines.push('Document informatif: la consultation ne vaut ni attribution, ni contrat, ni paiement.');
    return {bytes:makePdf(lines),filename:`devis-dao-v${versionResult.data.version_no}.pdf`};
  }
}
