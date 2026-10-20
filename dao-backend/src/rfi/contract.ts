export class RfiContractError extends Error { constructor(public readonly code: string) { super(code); } }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function rfiId(value: unknown) { if (typeof value !== 'string' || !uuid.test(value)) throw new RfiContractError('invalid'); return value; }
export function rfiKey(value: unknown) { if (typeof value !== 'string' || value.length < 8 || value.length > 120) throw new RfiContractError('invalid'); return value; }
export function questionInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RfiContractError('invalid');
  const input=value as Record<string,unknown>; const body=typeof input.body==='string'?input.body.trim():'';
  if (body.length<1 || body.length>4000) throw new RfiContractError('invalid');
  return {publication_request_id:rfiId(input.publication_request_id),body,idempotency_key:rfiKey(input.idempotency_key)};
}
export function clarificationInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RfiContractError('invalid');
  const input=value as Record<string,unknown>; const body=typeof input.body==='string'?input.body.trim():'';
  if (body.length<1 || body.length>8000 || typeof input.impacts_scope!=='boolean') throw new RfiContractError('invalid');
  return {body,impacts_scope:input.impacts_scope,idempotency_key:rfiKey(input.idempotency_key)};
}
export function listInput(query: URLSearchParams) {
  const limit=Number(query.get('limit')??20); if(!Number.isInteger(limit)||limit<1||limit>50)throw new RfiContractError('invalid');
  const request=query.get('publication_request_id'); return {limit,publication_request_id:request?rfiId(request):null};
}
