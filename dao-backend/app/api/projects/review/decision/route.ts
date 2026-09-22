import { createRequestApi } from '../../../../../src/server/runtime.js';
export async function POST(request: Request) { return createRequestApi(request).reviewProject(request); }
