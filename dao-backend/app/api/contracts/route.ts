import { createRequestApi } from '../../../src/server/runtime.js';
export async function GET(request: Request) { return createRequestApi(request).listContracts(request); }
