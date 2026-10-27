import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  DropboxSignTestTransport, type DropboxTestRequest,
} from '../src/integrations/providers/dropboxSignTestTransport.js';

const uuid = (digit: string) => digit.repeat(8) + '-' + digit.repeat(4) + '-4' + digit.repeat(3)
  + '-8' + digit.repeat(3) + '-' + digit.repeat(12);
const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<<>>\n%%EOF\n');
const id = 'a'.repeat(40);
const req = (): DropboxTestRequest => ({
  operationId: uuid('1'), contractId: uuid('2'), versionId: uuid('3'), currentVersionId: uuid('3'),
  expectedPdfSha256: createHash('sha256').update(pdf).digest('hex'), pdfBytes: pdf,
  environment: 'sandbox', legalEffectEnabled: false,
  signers: [
    { role: 'contractor', userId: uuid('4'), name: 'Artisan TEST', email: 'artisan@example.test' },
    { role: 'client', userId: uuid('5'), name: 'Client TEST', email: 'client@example.test' },
  ],
});
const response = (testMode: boolean = true, orders: number[] = [0, 1]) =>
  new Response(JSON.stringify({ signature_request: {
    signature_request_id: id, test_mode: testMode,
    signatures: orders.map(order => ({ order })),
  } }), { status: 200, headers: { 'content-type': 'application/json' } });

test('TEST only: posts a PDF and exact two signers ordered Artisan→Client, with immutable test_mode=1', async () => {
  let seen = 0;
  const mock: typeof fetch = (async (url: string, options?: RequestInit) => {
    seen++;
    assert.equal(url, 'https://api.hellosign.com/v3/signature_request/send');
    assert.equal(options?.method, 'POST');
    assert.match((options?.headers as Record<string, string>).Authorization, /^Basic /);
    const body = options!.body as FormData;
    assert.equal(body.get('test_mode'), '1');
    assert.equal(body.get('signers[0][order]'), '0');
    assert.equal(body.get('signers[1][order]'), '1');
    assert.equal(body.get('signers[0][email_address]'), 'artisan@example.test');
    assert.equal(body.get('signers[1][email_address]'), 'client@example.test');
    assert.equal(body.get('metadata[dao_test_ref]'), uuid('1'));
    assert.ok(body.get('files[0]') instanceof Blob);
    return response();
  }) as typeof fetch;
  const client = new DropboxSignTestTransport({ apiKey: 'unit-test-placeholder', fetcher: mock });
  assert.deepEqual(await client.sendTestRequest(req()), { signatureRequestId: id, testMode: true });
  assert.equal(seen, 1);
});

test('rejects live request before any HTTP call, even when deliberately bypassing TypeScript', async () => {
  let calls = 0;
  const mock: typeof fetch = (async () => { calls++; return response(); }) as typeof fetch;
  const client = new DropboxSignTestTransport({ apiKey: 'unit-test-placeholder', fetcher: mock });
  await assert.rejects(client.sendTestRequest({ ...req(), environment: 'live' }), /LIVE_FORBIDDEN/);
  await assert.rejects(client.sendTestRequest({ ...req(), legalEffectEnabled: true } as unknown as DropboxTestRequest), /LIVE_FORBIDDEN/);
  assert.equal(calls, 0);
});

test('rejects stale version, wrong hash, corrupt PDF or invalid signer order before network', async () => {
  let calls = 0;
  const mock: typeof fetch = (async () => { calls++; return response(); }) as typeof fetch;
  const client = new DropboxSignTestTransport({ apiKey: 'unit-test-placeholder', fetcher: mock });
  await assert.rejects(client.sendTestRequest({ ...req(), currentVersionId: uuid('9') }), /VERSION_INVALID/);
  await assert.rejects(client.sendTestRequest({ ...req(), expectedPdfSha256: '0'.repeat(64) }), /DOCUMENT_INVALID/);
  await assert.rejects(client.sendTestRequest({ ...req(), pdfBytes: Buffer.from('not a pdf') }), /DOCUMENT_INVALID/);
  await assert.rejects(client.sendTestRequest({ ...req(), signers: [req().signers[1], req().signers[0]] } as unknown as DropboxTestRequest), /ORDER_INVALID/);
  await assert.rejects(client.sendTestRequest({ ...req(), signers: [{ ...req().signers[0] }, { ...req().signers[1], email: 'ARTISAN@example.test' }] }), /SIGNERS_INVALID/);
  assert.equal(calls, 0);
});

test('rejects any unverified provider response including test_mode=false', async () => {
  const mock: typeof fetch = (async () => response(false)) as typeof fetch;
  const client = new DropboxSignTestTransport({ apiKey: 'unit-test-placeholder', fetcher: mock });
  await assert.rejects(client.sendTestRequest(req()), /RESPONSE_UNEXPECTED/);
  const wrongOrder: typeof fetch = (async () => response(true, [1, 0])) as typeof fetch;
  await assert.rejects(new DropboxSignTestTransport({ apiKey: 'unit-test-placeholder', fetcher: wrongOrder }).sendTestRequest(req()), /RESPONSE_UNEXPECTED/);
});

test('GET status remains test_only, cannot become legal signed status', async () => {
  const mock: typeof fetch = (async (url: string) => {
    assert.equal(url, 'https://api.hellosign.com/v3/signature_request/' + id);
    return new Response(JSON.stringify({ signature_request: {
      signature_request_id: id, test_mode: true, is_complete: true,
    } }), { status: 200 });
  }) as typeof fetch;
  const client = new DropboxSignTestTransport({ apiKey: 'unit-test-placeholder', fetcher: mock });
  assert.deepEqual(await client.readTestStatus(id), {
    signatureRequestId: id, isComplete: true, testMode: true, kind: 'test_only',
  });
  await assert.rejects(client.readTestStatus('malformed'), /ID_INVALID/);
});

test('missing server credential and bad provider status fail closed without disclosure', async () => {
  assert.throws(() => new DropboxSignTestTransport({ apiKey: '', fetcher: (async () => response()) as typeof fetch }), /NOT_CONFIGURED/);
  const mock: typeof fetch = (async () => new Response('unexpected', { status: 403 })) as typeof fetch;
  const client = new DropboxSignTestTransport({ apiKey: 'unit-test-placeholder', fetcher: mock });
  await assert.rejects(client.sendTestRequest(req()), /REQUEST_FAILED/);
});
