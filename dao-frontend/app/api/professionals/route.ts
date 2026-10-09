import { createProfessionalApi } from '../../../../dao-backend/src/server/runtime';
export async function GET(request:Request) { return createProfessionalApi(request)(request); }
export async function POST(request:Request) { return createProfessionalApi(request)(request); }
