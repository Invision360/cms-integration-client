import {
  requestDocumentUploadResponseSchema,
  type RequestDocumentUploadRequest,
  type RequestedDocumentUpload,
} from '../types';
import { bearer, readBody, send, type RouteContext } from './context';
import { asDelegate } from './get-delegated-token';

const LABEL = 'Request document upload';

export const requestDocumentUpload = async (
  ctx: RouteContext,
  partnerUserRef: string,
  planReferenceId: string,
  request: RequestDocumentUploadRequest,
): Promise<RequestedDocumentUpload> => {
  const body = await readBody(
    await asDelegate(ctx, partnerUserRef, token =>
      send(
        ctx,
        `/plans/${encodeURIComponent(planReferenceId)}/documents`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...bearer(token) },
          body: JSON.stringify(request),
        },
        LABEL,
      ),
    ),
    requestDocumentUploadResponseSchema,
    LABEL,
    'Request document upload response was missing required fields.',
  );
  return body.upload;
};
