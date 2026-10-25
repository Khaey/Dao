import { createDocumentDossierApi } from '../../../../../dao-backend/src/server/runtime';

export async function GET(request: Request) {
  return createDocumentDossierApi(request)(request);
}

export async function POST(request: Request) {
  return createDocumentDossierApi(request)(request);
}
