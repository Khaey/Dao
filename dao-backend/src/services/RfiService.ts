import { clarificationInput, listInput, questionInput, rfiId } from '../rfi/contract.js';

export class RfiService {
  constructor(private readonly db:any) {}
  private async rpc(name:string,parameters:Record<string,unknown>={}) { const {data,error}=await this.db.rpc(name,parameters); if(error)throw error; return data; }
  list(query:URLSearchParams){const input=listInput(query);return this.rpc('list_rfi_questions',{p_limit:input.limit,p_before:null,p_before_id:null,p_publication_request_id:input.publication_request_id});}
  create(value:unknown){const input=questionInput(value);return this.rpc('create_rfi_question',{p_publication_request_id:input.publication_request_id,p_body:input.body,p_idempotency_key:input.idempotency_key});}
  publish(id:unknown,value:unknown){const input=clarificationInput(value);return this.rpc('publish_rfi_clarification',{p_question_id:rfiId(id),p_body:input.body,p_impacts_scope:input.impacts_scope,p_idempotency_key:input.idempotency_key});}
  async markRead(id:unknown){await this.rpc('mark_rfi_read',{p_question_id:rfiId(id)});return {acknowledged:true};}
}
