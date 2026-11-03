import { createBtpEstimateApi } from '../../../../../dao-backend/src/server/runtime';

export async function GET(request:Request) {
  return createBtpEstimateApi(request)(request);
}

export async function POST(request:Request) {
  return createBtpEstimateApi(request)(request);
}
