import { createHash } from 'node:crypto';
import type { ProviderEnvironment } from '../contracts.js';

/**
 * #509 — Dropbox Sign API test transport only (non-binding and non-production).
 *
 * No application route imports this module, no secret is read automatically,
 * and calling it cannot update a D.A.O. contract/award/ledger.
 * NOTE: Dropbox's test_mode is a per-request flag, NOT an isolated sandbox.
 */
const URL_BASE = 'https://api.hellosign.com/v3';
const HEX_SHA256 = /^[a-f0-9]{64}$/i;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SandboxSigner = Readonly<{
  role: 'contractor' | 'client';
  userId: string;
  name: string;
  email: string;
}>;

export type DropboxTestRequest = Readonly<{
  operationId: string;
  contractId: string;
  versionId: string;
  currentVersionId: string;
  expectedPdfSha256: string;
  pdfBytes: Uint8Array;
  signers: readonly [SandboxSigner, SandboxSigner];
  environment: ProviderEnvironment;
  legalEffectEnabled: false;
}>;

export type DropboxSandboxStatus = Readonly<{
  signatureRequestId: string;
  isComplete: boolean;
  testMode: true;
  /** Technical TEST result ONLY. Never map to contracts.signed. */
  kind: 'test_only';
}>;

/** Pass an explicit fetcher: no network calls without server integration. */
export class DropboxSignTestTransport {
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;

  constructor(options: Readonly<{ apiKey: string; fetcher: typeof fetch }>) {
    if (!options.apiKey || !options.apiKey.trim() || !options.fetcher) {
      throw new Error('DROPBOX_TEST_NOT_CONFIGURED');
    }
    this.apiKey = options.apiKey;
    this.fetcher = options.fetcher;
  }

  private authorization() {
    return 'Basic ' + Buffer.from(this.apiKey + ':').toString('base64');
  }

  private validate(input: DropboxTestRequest): void {
    if (input.environment !== 'sandbox' || input.legalEffectEnabled !== false) {
      throw new Error('DROPBOX_TEST_LIVE_FORBIDDEN');
    }
    if (![input.operationId, input.contractId, input.versionId, input.currentVersionId].every(x => UUID.test(x))
      || input.versionId !== input.currentVersionId) {
      throw new Error('DROPBOX_TEST_CONTRACT_VERSION_INVALID');
    }
    const bytes = input.pdfBytes;
    if (!(bytes instanceof Uint8Array) || bytes.length < 24 || bytes.length > 20 * 1024 * 1024
      || !Buffer.from(bytes.subarray(0, 8)).toString('latin1').startsWith('%PDF-')
      || !Buffer.from(bytes.subarray(Math.max(0, bytes.length - 2048))).toString('latin1').includes('%%EOF')
      || !HEX_SHA256.test(input.expectedPdfSha256)
      || createHash('sha256').update(bytes).digest('hex') !== input.expectedPdfSha256.toLowerCase()) {
      throw new Error('DROPBOX_TEST_DOCUMENT_INVALID');
    }
    if (input.signers?.length !== 2 || input.signers[0].role !== 'contractor' || input.signers[1].role !== 'client') {
      throw new Error('DROPBOX_TEST_SIGNER_ORDER_INVALID');
    }
    const [contractor, client] = input.signers;
    if (![contractor, client].every(s => UUID.test(s.userId) && s.name.trim().length >= 2
      && s.name.length <= 150 && EMAIL.test(s.email) && s.email.length <= 254)
      || contractor.userId === client.userId || contractor.email.toLowerCase() === client.email.toLowerCase()) {
      throw new Error('DROPBOX_TEST_SIGNERS_INVALID');
    }
  }

  async sendTestRequest(input: DropboxTestRequest): Promise<Readonly<{ signatureRequestId: string; testMode: true }>> {
    this.validate(input); // Always validate BEFORE network.
    const body = new FormData();
    body.append('test_mode', '1'); // FIXED; never configurable, cannot send live.
    body.append('title', 'D.A.O. — contrat de test non opposable');
    body.append('subject', 'Contrat de test D.A.O.');
    body.append('metadata[dao_test_ref]', input.operationId);
    const signers = input.signers;
    signers.forEach((s, i) => {
      body.append('signers[' + i + '][email_address]', s.email);
      body.append('signers[' + i + '][name]', s.name);
      body.append('signers[' + i + '][order]', String(i));
    });
    body.append('files[0]', new Blob([new Uint8Array(input.pdfBytes)], { type: 'application/pdf' }), 'dao-test.pdf');
    const response = await this.fetcher(URL_BASE + '/signature_request/send', {
      method: 'POST',
      headers: { Authorization: this.authorization() },
      body,
    });
    if (!response.ok) throw new Error('DROPBOX_TEST_REQUEST_FAILED');
    const data = await response.json() as { signature_request?: { signature_request_id?: unknown; test_mode?: unknown; signatures?: Array<{ order?: unknown }> } };
    const record = data?.signature_request;
    if (!record || record.test_mode !== true || typeof record.signature_request_id !== 'string'
      || !/^[0-9a-f]{40}$/i.test(record.signature_request_id)
      || !Array.isArray(record.signatures) || record.signatures.length !== 2
      || record.signatures[0].order !== 0 || record.signatures[1].order !== 1) {
      throw new Error('DROPBOX_TEST_RESPONSE_UNEXPECTED');
    }
    return Object.freeze({ signatureRequestId: record.signature_request_id, testMode: true as const });
  }

  async readTestStatus(signatureRequestId: string): Promise<DropboxSandboxStatus> {
    if (!/^[0-9a-f]{40}$/i.test(signatureRequestId)) throw new Error('DROPBOX_TEST_ID_INVALID');
    const response = await this.fetcher(URL_BASE + '/signature_request/' + signatureRequestId, {
      method: 'GET',
      headers: { Authorization: this.authorization() },
    });
    if (!response.ok) throw new Error('DROPBOX_TEST_STATUS_FAILED');
    const data = await response.json() as { signature_request?: { signature_request_id?: unknown; test_mode?: unknown; is_complete?: unknown } };
    const record = data?.signature_request;
    if (!record || record.test_mode !== true || record.signature_request_id !== signatureRequestId
      || typeof record.is_complete !== 'boolean') {
      throw new Error('DROPBOX_TEST_STATUS_UNEXPECTED');
    }
    return Object.freeze({
      signatureRequestId, isComplete: record.is_complete, testMode: true as const, kind: 'test_only' as const,
    });
  }
}
