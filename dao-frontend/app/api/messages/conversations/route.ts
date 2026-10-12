import { createRequestApi } from '../../../../../dao-backend/src/server/runtime';

export async function GET(request: Request) { return createRequestApi(request).listConversations(request); }
export async function POST(request: Request) { return createRequestApi(request).openConversation(request); }
