import { createRequestApi } from '../../../../../dao-backend/src/server/runtime';

export async function GET(request: Request) {
  return createRequestApi(request).precontractAgreementSnapshot(request);
}

export async function POST(request: Request) {
  return createRequestApi(request).mutatePrecontractAgreement(request);
}
