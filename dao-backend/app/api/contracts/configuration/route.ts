import { createRequestApi } from '../../../../src/server/runtime.js';

export async function GET(request: Request) {
  return createRequestApi(request).projectContractConfiguration(request);
}

export async function POST(request: Request) {
  return createRequestApi(request).setProjectContractConfiguration(request);
}
