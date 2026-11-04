import {
  createdPlanResponseSchema,
  type CreatedPlan,
  type CreatePlanRequest,
} from '../types';
import { bearer, readBody, send, type RouteContext } from './context';
import { asDelegate } from './get-delegated-token';

const LABEL = 'Create plan request';

export const createPlan = async (
  ctx: RouteContext,
  partnerUserRef: string,
  plan: CreatePlanRequest,
): Promise<CreatedPlan> => {
  const body = await readBody(
    await asDelegate(ctx, partnerUserRef, token =>
      send(
        ctx,
        '/plans',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...bearer(token) },
          body: JSON.stringify(plan),
        },
        LABEL,
      ),
    ),
    createdPlanResponseSchema,
    LABEL,
    'Create plan response was missing required fields.',
  );
  return body.plan;
};
