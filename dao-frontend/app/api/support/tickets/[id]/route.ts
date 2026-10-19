import { createSupportApi } from '../../../../../../dao-backend/src/server/runtime';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return createSupportApi(request).detail(request, id);
}
