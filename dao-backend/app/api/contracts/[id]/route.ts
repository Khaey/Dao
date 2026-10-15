import { createRequestApi } from '../../../../src/server/runtime.js';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return createRequestApi(request).contractDetail(request, id);
}
