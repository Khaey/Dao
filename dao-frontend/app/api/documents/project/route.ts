import { createRequestApi } from '../../../../../dao-backend/src/server/runtime';

export async function GET(request: Request) {
  return createRequestApi(request).listProjectDocuments(request);
}

export async function POST(request: Request) {
  return createRequestApi(request).signedProjectUpload(request);
}
