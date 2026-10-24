import { createNativeExecutionPlanApi } from '../../../../../dao-backend/src/server/runtime';

export async function GET(request: Request) {
  return createNativeExecutionPlanApi(request)(request);
}
