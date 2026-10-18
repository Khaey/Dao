import { createOcePlanningApi } from '../../../../../dao-backend/src/server/runtime';

export async function GET(request: Request) { return createOcePlanningApi(request)(request); }
export async function POST(request: Request) { return createOcePlanningApi(request)(request); }
export async function PUT(request: Request) { return createOcePlanningApi(request)(request); }
export async function PATCH(request: Request) { return createOcePlanningApi(request)(request); }
export async function DELETE(request: Request) { return createOcePlanningApi(request)(request); }
