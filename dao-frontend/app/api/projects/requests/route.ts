import { createRequestApi } from '../../../../../dao-backend/src/server/runtime';

export async function POST(request: Request) {
  return createRequestApi(request).addProjectRequest(request);
}

export async function PATCH(request: Request) {
  return createRequestApi(request).updateProjectRequest(request);
}

export async function DELETE(request: Request) {
  return createRequestApi(request).withdrawProjectRequest(request);
}
