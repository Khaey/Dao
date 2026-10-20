import { createRfiApi } from '../../../../dao-backend/src/server/runtime';
export async function GET(request:Request){return createRfiApi(request).list(request);}
export async function POST(request:Request){return createRfiApi(request).create(request);}
