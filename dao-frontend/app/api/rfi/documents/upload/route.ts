import { createRfiApi } from '../../../../../../dao-backend/src/server/runtime';
export async function POST(request:Request){return createRfiApi(request).prepareDocument(request);}
