import { createRequestApi } from '../../../../../../dao-backend/src/server/runtime';

export async function GET(request: Request) {
  return createRequestApi(request).listTechnicalInspections(request);
}

export async function POST(request: Request) {
  return createRequestApi(request).requestTechnicalInspection(request);
}
