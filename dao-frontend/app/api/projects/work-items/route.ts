import { createProjectWorkItemsApi } from '../../../../../dao-backend/src/server/runtime';

export async function GET(request: Request) { return createProjectWorkItemsApi(request)(request); }
export async function POST(request: Request) { return createProjectWorkItemsApi(request)(request); }
