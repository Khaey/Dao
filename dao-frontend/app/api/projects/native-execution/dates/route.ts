import { createNativeLotDatesApi } from '../../../../../../dao-backend/src/server/runtime';

const api = (request: Request) => createNativeLotDatesApi(request)(request);

export async function GET(request: Request) {
  return api(request);
}

export async function PUT(request: Request) {
  return api(request);
}
