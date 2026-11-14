import { createOceStatusApi } from '../../../../../dao-backend/src/server/runtime';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return createOceStatusApi()(request); }
