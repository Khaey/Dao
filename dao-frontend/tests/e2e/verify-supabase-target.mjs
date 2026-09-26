const expectedUrl = 'http://127.0.0.1:54321';
const url = process.env.DAO_SUPABASE_URL;
const secret = process.env.DAO_SUPABASE_SECRET_KEY;

if (url !== expectedUrl) {
  throw new Error('FULL E2E refused: DAO_SUPABASE_URL must be the isolated local Supabase endpoint http://127.0.0.1:54321');
}
if (!secret) {
  throw new Error('FULL E2E refused: local Supabase service role key is missing');
}

process.stdout.write('FULL E2E target verified: disposable local Supabase at ' + expectedUrl + '.\n');
