import { createBackofficeApi } from '../../../../../dao-backend/src/server/runtime';
export async function GET(request: Request) { return createBackofficeApi(request)(request); }
export async function POST(request: Request) { return createBackofficeApi(request)(request); }
