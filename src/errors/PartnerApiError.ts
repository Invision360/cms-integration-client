export type PartnerApiErrorKind = 'network' | 'http' | 'malformed-response';

/** Never carries `clientSecret` or a bearer token -- callers may log this.
 *  That guarantee holds only because errorFromResponse validates
 *  `details` before passing it here rather than casting the untrusted
 *  response body. */
export class PartnerApiError extends Error {
  public readonly kind: PartnerApiErrorKind;
  public readonly statusCode?: number;
  public readonly code?: string;
  public readonly details?: Record<string, string[]>;

  constructor(
    message: string,
    kind: PartnerApiErrorKind,
    statusCode?: number,
    code?: string,
    details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'PartnerApiError';
    this.kind = kind;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
