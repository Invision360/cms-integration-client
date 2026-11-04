import { planContentSchema, type PlanContent } from '../types';
import { bearer, readBody, send, type RouteContext } from './context';
import { asDelegate } from './get-delegated-token';

const LABEL = 'Get plan content';

export const getPlanContent = async (
  ctx: RouteContext,
  partnerUserRef: string,
  planReferenceId: string,
): Promise<PlanContent> =>
  readBody(
    await asDelegate(ctx, partnerUserRef, token =>
      send(
        ctx,
        `/plans/${encodeURIComponent(planReferenceId)}/content`,
        { headers: bearer(token) },
        LABEL,
      ),
    ),
    planContentSchema,
    LABEL,
    'Plan content response did not match the expected shape.',
  );
