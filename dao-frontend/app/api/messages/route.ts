import { createRequestApi } from '../../../../dao-backend/src/server/runtime';

export async function GET(request: Request) { return createRequestApi(request).listMessages(request); }
export async function POST(request: Request) { return createRequestApi(request).sendMessage(request); }
export async function PATCH(request: Request) { return createRequestApi(request).markConversationRead(request); }
