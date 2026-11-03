import { DomainError } from '../lib/errors.js';
import type { BtpCatalogSnapshot, BtpProjectType } from '../btp-reference/contract.js';

const projectTypes = new Set<BtpProjectType>(['construction','renovation','extension','repair','other']);

export class BtpReferenceService {
  constructor(private readonly db:any) {}

  async snapshot(projectType:string|null,countryCode:string):Promise<BtpCatalogSnapshot> {
    if(projectType && !projectTypes.has(projectType as BtpProjectType)) throw new DomainError('Type de projet invalide','BAD_REQUEST');
    if(!/^[A-Z]{2}$/.test(countryCode)) throw new DomainError('Code pays invalide','BAD_REQUEST');
    const {data,error}=await this.db.rpc('btp_catalog_snapshot',{p_project_type:projectType,p_country_code:countryCode});
    if(error) throw error;
    if(!data?.catalogVersion) throw new DomainError('Aucun référentiel BTP publié pour ce pays','NOT_FOUND');
    return data as BtpCatalogSnapshot;
  }
}
