import { planStatusResponseSchema, type PlanStatusResult } from '../types';
import { bearer, readBody, send, type RouteContext } from './context';
import { asDelegate } from './get-delegated-token';

const LABEL = 'Get plan status';

export const getPlanStatus = async (
  ctx: RouteContext,
  partnerUserRef: string,
  planReferenceId: string,
): Promise<PlanStatusResult> => {
  const body = await readBody(
    await asDelegate(ctx, partnerUserRef, token =>
      send(
        ctx,
        `/plans/${encodeURIComponent(planReferenceId)}`,
        { headers: bearer(token) },
        LABEL,
      ),
    ),
    planStatusResponseSchema,
    LABEL,
    'Plan status response was missing required fields.',
  );
  return body.plan;
};
