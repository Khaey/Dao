import { createRequestApi } from '../../../../dao-backend/src/server/runtime';
export async function POST(request: Request) { return createRequestApi(request).awardRequest(request); }
