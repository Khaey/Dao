import { createNativeExecutionActivityApi } from '../../../../../../dao-backend/src/server/runtime';

export async function POST(request: Request) {
  return createNativeExecutionActivityApi(request)(request);
}
