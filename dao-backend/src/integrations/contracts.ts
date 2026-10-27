/** #505 I0.5 — domain contracts only. Never a live provider adapter. */
export type ProviderDomain =
  | 'signature' | 'escrow' | 'payment' | 'maps'
  | 'individual_identity' | 'business_identity' | 'messaging' | 'documents';
export type ProviderEnvironment = 'sandbox' | 'live';
export type ProviderCountry = 'TN'; // New countries require an explicit market review.
export type ProviderCapability =
  | 'signature.sequential' | 'signature.simple' | 'signature.qualified' | 'signature.evidence'
  | 'escrow.hold' | 'escrow.release' | 'escrow.refund' | 'escrow.dispute'
  | 'payment.collect' | 'payment.refund' | 'payment.payout' | 'payment.reconcile'
  | 'maps.map' | 'maps.geocode' | 'maps.autocomplete' | 'maps.route'
  | 'individual_identity.verify' | 'business_identity.verify'
  | 'messaging.email' | 'messaging.sms' | 'messaging.whatsapp'
  | 'documents.store' | 'documents.archive' | 'documents.timestamp';

export const CAPABILITY_DOMAIN: Readonly<Record<ProviderCapability, ProviderDomain>> = Object.freeze({
  'signature.sequential': 'signature', 'signature.simple': 'signature',
  'signature.qualified': 'signature', 'signature.evidence': 'signature',
  'escrow.hold': 'escrow', 'escrow.release': 'escrow',
  'escrow.refund': 'escrow', 'escrow.dispute': 'escrow',
  'payment.collect': 'payment', 'payment.refund': 'payment',
  'payment.payout': 'payment', 'payment.reconcile': 'payment',
  'maps.map': 'maps', 'maps.geocode': 'maps', 'maps.autocomplete': 'maps', 'maps.route': 'maps',
  'individual_identity.verify': 'individual_identity', 'business_identity.verify': 'business_identity',
  'messaging.email': 'messaging', 'messaging.sms': 'messaging', 'messaging.whatsapp': 'messaging',
  'documents.store': 'documents', 'documents.archive': 'documents', 'documents.timestamp': 'documents',
});

/** Provided by the trusted server; never accept directly from the browser. */
export type ProviderCallContext = Readonly<{
  operationId: string;
  idempotencyKey: string;
  environment: ProviderEnvironment;
  country: ProviderCountry;
  connectionId: string; // Opaque reference, NOT a token/API key.
}>;

export type VerifiedEvent = Readonly<{
  providerId: string;
  operationId: string;
  externalEventId: string;
  evidenceSha256: string;
  verifiedAt: string;
}>;

export interface SignatureProvider {
  readonly id: string;
  createSession(input: Readonly<{
    contractId: string;
    contractVersionId: string;
    pdfSha256: string;
    signersInOrder: readonly ['contractor', 'client'];
  }>, context: ProviderCallContext): Promise<Readonly<{ externalSessionRef: string }>>;
  getStatus(operationId: string, context: ProviderCallContext): Promise<'pending' | 'completed' | 'failed' | 'expired'>;
  retrieveEvidence(operationId: string, context: ProviderCallContext): Promise<Readonly<{ signedPdf: Uint8Array; auditEvidence: Uint8Array }>>;
  verifyIncomingEvent(payload: Uint8Array, headers: Readonly<Record<string, string>>): Promise<VerifiedEvent>;
}

export interface EscrowProvider {
  readonly id: string;
  createEscrow(input: Readonly<{ amountMillimes: bigint; currency: 'TND'; beneficiaryRef: string }>, context: ProviderCallContext): Promise<Readonly<{ externalEscrowRef: string }>>;
  getStatus(operationId: string, context: ProviderCallContext): Promise<'pending' | 'funded' | 'held' | 'released' | 'refunded' | 'disputed'>;
  requestRelease(input: Readonly<{ operationId: string; amountMillimes: bigint; explicitApprovalRef: string }>, context: ProviderCallContext): Promise<Readonly<{ requestRef: string }>>;
}

export interface PaymentProvider {
  readonly id: string;
  createPayment(input: Readonly<{ amountMillimes: bigint; currency: 'TND'; recipientRef: string }>, context: ProviderCallContext): Promise<Readonly<{ externalPaymentRef: string }>>;
  getStatus(operationId: string, context: ProviderCallContext): Promise<'pending' | 'paid' | 'failed' | 'reversed'>;
}
