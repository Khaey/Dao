import { createSupportApi } from '../../../../../../../dao-backend/src/server/runtime';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return createSupportApi(request).reply(request, id);
}
