export type PartnerApiErrorKind = 'network' | 'http' | 'malformed-response';

/** Never carries `clientSecret` or a bearer token -- callers may log this. */
export class PartnerApiError extends Error {
  public readonly kind: PartnerApiErrorKind;
  public readonly statusCode?: number;
  public readonly code?: string;

  constructor(
    message: string,
    kind: PartnerApiErrorKind,
    statusCode?: number,
    code?: string,
  ) {
    super(message);
    this.name = 'PartnerApiError';
    this.kind = kind;
    this.statusCode = statusCode;
    this.code = code;
  }
}
