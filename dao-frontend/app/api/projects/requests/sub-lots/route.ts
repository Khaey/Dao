import { createClientOfficialSubLotApi } from '../../../../../../dao-backend/src/server/runtime';

const api = (request: Request) => createClientOfficialSubLotApi(request);

export async function GET(request: Request) {
  return api(request)(request);
}

export async function PUT(request: Request) {
  return api(request)(request);
}
