import { createBtpPriceApi } from '../../../../../dao-backend/src/server/runtime';

export async function GET(request:Request) {
  return createBtpPriceApi(request)(request);
}

export async function POST(request:Request) {
  return createBtpPriceApi(request)(request);
}
