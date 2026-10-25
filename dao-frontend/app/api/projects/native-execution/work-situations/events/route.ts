import { createNativeWorkSituationEventsApi } from '../../../../../../../dao-backend/src/server/runtime';

export async function GET(request: Request) {
  return createNativeWorkSituationEventsApi(request)(request);
}
