import { createRequestApi } from '../../../../../dao-backend/src/server/runtime';

export async function GET(request: Request) {
  return createRequestApi(request).siteExecutionSnapshot(request);
}

export async function POST(request: Request) {
  return createRequestApi(request).recordSiteExecution(request);
}

export async function PATCH(request: Request) {
  return createRequestApi(request).updateSiteMilestone(request);
}
