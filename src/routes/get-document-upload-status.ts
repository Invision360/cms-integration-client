import {
  documentUploadStatusResponseSchema,
  type DocumentUploadStatusResult,
} from '../types';
import { bearer, readBody, send, type RouteContext } from './context';
import { asDelegate } from './get-delegated-token';

const LABEL = 'Get document upload status';

export const getDocumentUploadStatus = async (
  ctx: RouteContext,
  partnerUserRef: string,
  uploadId: string,
): Promise<DocumentUploadStatusResult> => {
  const body = await readBody(
    await asDelegate(ctx, partnerUserRef, token =>
      send(ctx, `/uploads/${uploadId}`, { headers: bearer(token) }, LABEL),
    ),
    documentUploadStatusResponseSchema,
    LABEL,
    'Document upload status response was missing required fields.',
  );
  return body.upload;
};
