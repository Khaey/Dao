import { createSupportApi } from '../../../../../dao-backend/src/server/runtime';

export async function GET(request: Request) { return createSupportApi(request).list(request); }
export async function POST(request: Request) { return createSupportApi(request).create(request); }
