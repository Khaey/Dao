export class DomainError extends Error { constructor(message: string, public readonly code = 'DOMAIN_ERROR') { super(message); } }
