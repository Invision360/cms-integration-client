import { PartnerApiError } from '../errors';
import type {
  RequestDocumentUploadRequest,
  RequestedDocumentUpload,
} from '../types';
import type { RouteContext } from './context';
import { requestDocumentUpload } from './request-document-upload';

/** The PUT goes to the granted S3 URL, not to VITA, so it bypasses `send`. */
export const uploadDocument = async (
  ctx: RouteContext,
  partnerUserRef: string,
  planReferenceId: string,
  request: RequestDocumentUploadRequest,
  body: BodyInit,
): Promise<RequestedDocumentUpload> => {
  const upload = await requestDocumentUpload(
    ctx,
    partnerUserRef,
    planReferenceId,
    request,
  );

  let response: Response;
  try {
    response = await ctx.fetch(upload.url, {
      method: 'PUT',
      headers: upload.headers,
      body,
    });
  } catch {
    throw new PartnerApiError('Document upload failed.', 'network');
  }
  if (!response.ok) {
    throw new PartnerApiError(
      `Document upload was rejected with status ${response.status}.`,
      'http',
      response.status,
    );
  }
  return upload;
};
