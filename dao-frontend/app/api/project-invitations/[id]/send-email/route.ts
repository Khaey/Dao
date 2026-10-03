import { createInvitationEmailApi } from '../../../../../../dao-backend/src/server/runtime';

export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return createInvitationEmailApi(request)(request, id);
}
