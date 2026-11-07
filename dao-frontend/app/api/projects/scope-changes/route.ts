import { createLotScopeChangesApi } from '../../../../../dao-backend/src/server/runtime';

export async function GET(request: Request) { return createLotScopeChangesApi(request)(request); }
export async function POST(request: Request) { return createLotScopeChangesApi(request)(request); }
