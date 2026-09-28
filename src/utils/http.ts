import { PartnerApiError } from '../errors';

export const parseJsonBody = async (
  response: Response,
  context: string,
): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    throw new PartnerApiError(
      `${context} response was not valid JSON.`,
      'malformed-response',
    );
  }
};

/** The body is untrusted server data, so this validates its shape rather
 *  than casting it -- PartnerApiError's "never carries a secret" guarantee
 *  holds only because arbitrary server data is refused here, not passed
 *  through. */
const isStringArrayRecord = (
  value: unknown,
): value is Record<string, string[]> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every(
    messages =>
      Array.isArray(messages) &&
      messages.every(message => typeof message === 'string'),
  );

/** Never echoes the request's own headers or body, so the thrown error is
 *  always safe for a caller to log. */
export const errorFromResponse = async (
  response: Response,
  context: string,
): Promise<PartnerApiError> => {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const record =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const code = typeof record.error === 'string' ? record.error : undefined;
  const description =
    typeof record.error_description === 'string'
      ? record.error_description
      : typeof record.message === 'string'
        ? record.message
        : `${context} was rejected with status ${response.status}.`;
  const details = isStringArrayRecord(record.error_details)
    ? record.error_details
    : undefined;
  return new PartnerApiError(
    description,
    'http',
    response.status,
    code,
    details,
  );
};

export const basicAuthHeader = (
  clientId: string,
  clientSecret: string,
): string =>
  'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
