import { createBtpTakeoffApi } from '../../../../../dao-backend/src/server/runtime';

export async function GET(request:Request) { return createBtpTakeoffApi(request)(request); }
export async function POST(request:Request) { return createBtpTakeoffApi(request)(request); }
