import { createNativeExecutionScopeApi } from '../../../../../dao-backend/src/server/runtime';

export async function POST(request: Request) {
  return createNativeExecutionScopeApi(request)(request);
}
