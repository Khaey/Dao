import { createRequestApi } from '../../../../dao-backend/src/server/runtime';

export async function POST(request: Request) {
  return createRequestApi(request).createProject(request);
}

export async function PATCH(request: Request) {
  return createRequestApi(request).updateProjectDraft(request);
}
