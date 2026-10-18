import { createNotificationApi } from '../../../../dao-backend/src/server/runtime';

export async function GET(request: Request) { return createNotificationApi(request)(request); }
export async function PATCH(request: Request) { return createNotificationApi(request)(request); }
