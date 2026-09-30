import { createRequestApi } from '../../../../../dao-backend/src/server/runtime';

export async function GET(request: Request) {
  return createRequestApi(request).projectTeam(request);
}
