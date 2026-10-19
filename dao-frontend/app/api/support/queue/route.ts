import { createSupportApi } from '../../../../../dao-backend/src/server/runtime';

export async function GET(request: Request) { return createSupportApi(request).queue(request); }
