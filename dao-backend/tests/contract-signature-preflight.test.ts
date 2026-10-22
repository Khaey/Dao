import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prepareNgSignCandidate, type ContractSignaturePreflightInput } from '../src/services/ContractSignaturePreflight.js';

const contractId = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
const clientId = '33333333-3333-4333-8333-333333333333';
const artisanId = '44444444-4444-4444-8444-444444444444';
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n');
const hash = createHash('sha256').update(pdf).digest('hex');

function input(): ContractSignaturePreflightInput {
  return {
    contractId, contractVersionId: versionId, currentVersionId: versionId,
    contractVersionHash: 'a'.repeat(64), expectedPdfSha256: hash, pdfBytes: pdf,
    contractStatus: 'ready', legalEffectEnabled: false,
    daoLegalName: 'LogicLab Tunisie (identité de test)',
    signers: [
      { role: 'contractor', userId: artisanId, firstName: 'Artisan', lastName: 'Test', email: 'artisan@example.test' },
      { role: 'client', userId: clientId, firstName: 'Client', lastName: 'Test', email: 'client@example.test' },
    ],
  };
}

function blocked(value: ContractSignaturePreflightInput, label: string) {
  assert.throws(() => prepareNgSignCandidate(value),
    (error: any) => error.code === 'SIGNATURE_PREFLIGHT_BLOCKED', label);
}

test('preflight produces a read-only NGSign DIGI_GO candidate for exactly two separate signers', () => {
  const plan = prepareNgSignCandidate(input());
  assert.equal(plan.state, 'sandbox_design_only');
  assert.equal(plan.legalEffectEnabled, false);
  assert.equal(plan.externalCallsMade, false);
  assert.equal(plan.pdf.sha256, hash);
  assert.equal(plan.pdf.canonicalVersionHash, 'a'.repeat(64));
  assert.deepEqual(plan.signerModes.map(signer => signer.role), ['contractor', 'client']);
  for (const signer of plan.signerModes) {
    assert.equal(signer.sigType, 'DIGI_GO');
    assert.equal(signer.mode, 'BY_MAIL');
    assert.equal(signer.otp, 'OTP');
  }
  assert.ok(!JSON.stringify(plan).includes('fileBase64'));
  assert.ok(!JSON.stringify(plan).includes('artisan@example.test'));
  assert.ok(!JSON.stringify(plan).includes('client@example.test'));
});

test('rejects an old contract version, missing or invalid hash and a modified PDF', () => {
  blocked({ ...input(), currentVersionId: '55555555-5555-4555-8555-555555555555' }, 'stale version');
  blocked({ ...input(), contractVersionHash: 'tampered' }, 'invalid version hash');
  blocked({ ...input(), expectedPdfSha256: 'b'.repeat(64) }, 'invalid document digest');
  blocked({ ...input(), pdfBytes: Buffer.from('text only, not a PDF') }, 'not a PDF');
  blocked({ ...input(), pdfBytes: Buffer.from('%PDF-1.4\nnot completed') }, 'missing EOF');
});

test('requires separate Client and Artisan identities and rejects provider or legal-state shortcuts', () => {
  const base = input();
  blocked({ ...base, legalEffectEnabled: true }, 'legal activation');
  blocked({ ...base, contractStatus: 'cancelled' }, 'cancelled contract');
  blocked({ ...base, daoLegalName: '' }, 'missing DAO legal identity');
  blocked({ ...base, signers: base.signers.slice(0, 1) }, 'missing signer');
  blocked({ ...base, signers: [base.signers[0], { ...base.signers[1], role: 'contractor' }] }, 'duplicate role');
  blocked({ ...base, signers: [base.signers[0], { ...base.signers[1], userId: artisanId }] }, 'same account');
  blocked({ ...base, signers: [base.signers[0], { ...base.signers[1], email: 'ARTISAN@example.test' }] }, 'same email');
  blocked({ ...base, signers: [base.signers[0], { ...base.signers[1], email: 'not-email' }] }, 'malformed email');
});
