import { createBtpReferenceApi } from '../../../../../dao-backend/src/server/runtime';

export async function GET(request:Request) {
  return createBtpReferenceApi(request).catalog(request);
}
