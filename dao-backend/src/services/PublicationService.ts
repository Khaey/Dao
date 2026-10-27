/** The database remains the final arbiter: this is a friendly validation layer. */
export const PUBLICATION_DEADLINE_MESSAGE =
  'La date limite des offres doit être postérieure à la date de publication. Choisissez une date future ou laissez ce champ vide.';

function badDeadline(): Error & { code: string } {
  return Object.assign(new Error(PUBLICATION_DEADLINE_MESSAGE), { code: 'BAD_REQUEST' });
}

export class PublicationService {
  constructor(private readonly db: any) {}

  async publish(input: Record<string, unknown>) {
    let deadline: string | null = null;
    const supplied = input.submission_deadline;
    if (supplied != null && supplied !== '') {
      // Only timestamp strings with an explicit timezone are accepted by this API.
      // datetime-local is converted to UTC by the browser before submission.
      if (typeof supplied !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(supplied)) {
        throw badDeadline();
      }
      const parsed = Date.parse(supplied);
      if (!Number.isFinite(parsed) || parsed <= Date.now()) throw badDeadline();
      deadline = new Date(parsed).toISOString();
    }
    const { data, error } = await this.db.rpc('publish_project', {
      p_project_id: input.project_id,
      p_visibility: input.visibility,
      p_request_ids: input.request_ids ?? null,
      p_contractor_ids: input.contractor_ids ?? null,
      p_submission_deadline: deadline,
    });
    if (error) {
      // Publication might cross its deadline during the RPC. Only translate
      // this exact DB constraint, never suppress an unrelated constraint.
      if (error.code === '23514' && /\bpublications_check\b/.test(String(error.message ?? ''))) {
        throw badDeadline();
      }
      throw error;
    }
    return data;
  }

  async get(id: string) {
    const { data, error } = await this.db.from('publications').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  }

  async close(id: string) {
    const { data, error } = await this.db.from('publications')
      .update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }
}
