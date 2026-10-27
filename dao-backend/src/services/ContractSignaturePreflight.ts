import { createHash } from 'node:crypto';
import { DomainError } from '../lib/errors.js';

/**
 * P2.2-E2 / #383 — OFFLINE provider evaluation only.
 *
 * This module cannot request signatures, issue OTPs, upload files, call a
 * provider, verify certificates, create a signature or change legal status.
 * Do not expose its signers' personal data in an API response or log.
 */
type Role = 'client' | 'contractor';
export type SignerIdentity = {
  role: Role;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
};

export type ContractSignaturePreflightInput = {
  contractId: string;
  contractVersionId: string;
  currentVersionId: string;
  contractVersionHash: string;
  legalEffectEnabled: boolean;
  contractStatus: string;
  daoLegalName: string;
  pdfBytes: Uint8Array;
  expectedPdfSha256: string;
  signers: readonly SignerIdentity[];
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha256 = /^[0-9a-f]{64}$/;
const allowedStatuses = new Set(['draft', 'review', 'ready', 'awaiting_signatures']);

function ensure(value: unknown, message: string): asserts value {
  if (!value) throw new DomainError(message, 'SIGNATURE_PREFLIGHT_BLOCKED');
}

function meaningfulString(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 1 && value.trim().length <= 150;
}

/**
 * Creates a document-and-role fingerprint to plan integration with the public
 * NGSign DIGI_GO REST flow. It is deliberately impossible to launch a provider
 * transaction from this module. Only a separately reviewed server-side service,
 * explicit feature gate and signed proof verifier may do that in a future lot.
 */
export function prepareNgSignCandidate(input: ContractSignaturePreflightInput) {
  ensure(input.legalEffectEnabled === false, 'État juridique incompatible avec la préparation hors ligne');
  ensure(allowedStatuses.has(input.contractStatus), 'Dossier annulé, signé ou dans un état inattendu');
  ensure(uuid.test(input.contractId) && uuid.test(input.contractVersionId) && uuid.test(input.currentVersionId),
    'Identifiants contractuels invalides');
  ensure(input.contractVersionId === input.currentVersionId, 'La version du document n’est plus la version courante');
  ensure(sha256.test(input.contractVersionHash), 'Empreinte de version contractuelle invalide');
  ensure(meaningfulString(input.daoLegalName), 'Entité D.A.O. à identifier');

  const pdf = input.pdfBytes;
  ensure(pdf instanceof Uint8Array && pdf.byteLength >= 20 && pdf.byteLength <= 20 * 1024 * 1024,
    'PDF manquant ou de taille non autorisée');
  // Fast preflight, NOT a PDF parser or cryptographic PDF signature validation.
  const header = Buffer.from(pdf.subarray(0, 8)).toString('latin1');
  const trailer = Buffer.from(pdf.subarray(Math.max(0, pdf.byteLength - 2048))).toString('latin1');
  ensure(header.startsWith('%PDF-1.') || header.startsWith('%PDF-2.'), 'Document non identifié comme PDF');
  ensure(trailer.includes('%%EOF'), 'Fin de fichier PDF absente');
  ensure(sha256.test(input.expectedPdfSha256), 'Empreinte PDF attendue invalide');
  const actualPdfSha256 = createHash('sha256').update(pdf).digest('hex');
  ensure(actualPdfSha256 === input.expectedPdfSha256, 'PDF modifié après son empreinte de référence');

  ensure(input.signers.length === 2, 'Deux signataires exacts sont requis');
  const byRole = new Map<Role, SignerIdentity>();
  for (const person of input.signers) {
    ensure(person.role === 'client' || person.role === 'contractor', 'Rôle de signature non autorisé');
    ensure(!byRole.has(person.role), 'Un rôle ne peut pas signer deux fois');
    ensure(uuid.test(person.userId), 'Identifiant du signataire invalide');
    ensure(meaningfulString(person.firstName) && meaningfulString(person.lastName),
      'Nom complet du signataire requis');
    ensure(typeof person.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email) && person.email.length <= 254,
      'Adresse électronique du signataire invalide');
    byRole.set(person.role, person);
  }
  ensure(byRole.has('client') && byRole.has('contractor'), 'Accord des deux rôles exigé');
  const client = byRole.get('client')!;
  const contractor = byRole.get('contractor')!;
  ensure(client.userId !== contractor.userId && client.email.toLowerCase() !== contractor.email.toLowerCase(),
    'Le Client et l’Artisan doivent être deux identités distinctes');

  return {
    // Explicit non-activation: DO NOT reinterpret as provider readiness or a signature.
    state: 'sandbox_design_only' as const,
    providerCandidate: 'NGSign / DigiGO' as const,
    legalEffectEnabled: false as const,
    externalCallsMade: false as const,
    pdf: {
      sha256: actualPdfSha256,
      byteLength: pdf.byteLength,
      contractId: input.contractId,
      versionId: input.contractVersionId,
      canonicalVersionHash: input.contractVersionHash,
    },
    signerModes: (['contractor', 'client'] as const).map(role => ({
      role, userId: byRole.get(role)!.userId,
      // Official NGSign public API vocabulary. Actual sandbox behavior unverified.
      sigType: 'DIGI_GO' as const, mode: 'BY_MAIL' as const, otp: 'OTP' as const,
    })),
    mustVerifyBeforeActivation: [
      'PDF contractuel définitif et clauses validés par un juriste tunisien',
      'Identité et mandat vérifiés de chacun des deux signataires',
      'Contrat de partenariat et identifiants sandbox du fournisseur',
      'Contrôle de sécurité des appels et réponses du fournisseur',
      'Preuves cryptographiques, révocation, horodatage et archivage du PDF signé',
      'Contrôle final par le représentant autorisé de D.A.O.',
    ] as const,
  };
}
