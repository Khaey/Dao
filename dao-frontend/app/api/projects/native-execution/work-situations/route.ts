import { createNativeWorkSituationApi } from '../../../../../../dao-backend/src/server/runtime';

export async function GET(request: Request) {
  return createNativeWorkSituationApi(request)(request);
}

export async function POST(request: Request) {
  return createNativeWorkSituationApi(request)(request);
}
