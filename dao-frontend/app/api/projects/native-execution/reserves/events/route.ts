import { createRequestApi } from '../../../../../../../dao-backend/src/server/runtime';

export async function GET(request: Request) {
  return createRequestApi(request).listTechnicalReserveEvents(request);
}

export async function POST(request: Request) {
  return createRequestApi(request).recordTechnicalReserveEvent(request);
}
