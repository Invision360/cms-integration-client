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
  return new PartnerApiError(description, 'http', response.status, code);
};

export const basicAuthHeader = (
  clientId: string,
  clientSecret: string,
): string =>
  'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
