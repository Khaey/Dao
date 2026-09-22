import { createRequestApi } from '../../../../dao-backend/src/server/runtime';

export async function POST(request: Request) {
  return createRequestApi(request).initializeProfile(request);
}

export async function PATCH(request: Request) {
  return createRequestApi(request).updateProfile(request);
}
