import { createProjectAssistantApi } from '../../../../../dao-backend/src/server/runtime';

export async function GET(request: Request) {
  return createProjectAssistantApi(request)(request);
}

export async function POST(request: Request) {
  return createProjectAssistantApi(request)(request);
}
