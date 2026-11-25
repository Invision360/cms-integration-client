import { z } from 'zod';

export interface PartnerApiClientConfig {
  /** Already includes the version [`/v1`] stage - don't append it again. */
  apiUrl: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

export const actorTokenResponseSchema = z
  .object({
    access_token: z.string(),
    expires_in: z.number(),
  })
  .transform(({ access_token, expires_in }) => ({
    accessToken: access_token,
    expiresIn: expires_in,
  }));

export type ActorTokenResponse = z.infer<typeof actorTokenResponseSchema>;

/** Not cached by this client for now */
export const delegatedTokenResponseSchema = z
  .object({
    access_token: z.string(),
    token_type: z.string(),
    expires_in: z.number(),
  })
  .transform(({ access_token, token_type, expires_in }) => ({
    accessToken: access_token,
    tokenType: token_type,
    expiresIn: expires_in,
  }));

export type DelegatedToken = z.infer<typeof delegatedTokenResponseSchema>;

export const identityResponseSchema = z.object({
  actor: z.object({
    type: z.literal('partner_deployment'),
    provider: z.string(),
    clientId: z.string(),
  }),
  authority: z.object({ name: z.string() }),
  integration: z.object({ attachedAt: z.string() }),
});

export type Identity = z.infer<typeof identityResponseSchema>;

/** `user.id` is the partner user reference /me was called as, not a VITA
 *  identifier. `userRoles` is read live on every call, unlike a delegated
 *  token's own role claim. */
export const meResponseSchema = z.object({
  user: z.object({ id: z.string(), userRoles: z.array(z.string()) }),
  authority: z.object({ name: z.string() }),
});

export type Me = z.infer<typeof meResponseSchema>;

/** What VITA needs to create a plan. Nothing here is a VITA identifier: the
 *  references are all your own, and VITA never returns one of its own. */
export interface CreatePlanRequest {
  /** Your handle for this plan, unique within your attachment. Opaque to
   *  VITA, which never parses it -- iDox composes it as
   *  `<CASE_ID>_<FIRST_PLAN_ID>`. Sending it twice is refused rather than
   *  duplicated, which is what makes a retry after a timeout safe. */
  planId: string;
  /** The case reference a coordinator reads on the plan in VITA. */
  caseIdentifier: string;
  /** `YYYY-MM-DD`, or any ISO date string -- only the date part is kept. */
  dueOn: string;
  /** The assignee's user reference, as mapped in your attachment. Not a VITA
   *  identifier. */
  assigneeId: string;
}

export const createdPlanResponseSchema = z.object({
  plan: z.object({
    id: z.string(),
    caseIdentifier: z.string(),
    dueOn: z.string(),
    assignee: z.object({ id: z.string() }),
  }),
});

export type CreatedPlan = z.infer<typeof createdPlanResponseSchema>['plan'];

/** What VITA needs to grant an upload. `contentLength` must match the bytes
 *  sent to the returned URL exactly -- it is part of what gets signed. */
export interface RequestDocumentUploadRequest {
  filename: string;
  contentType: string;
  contentLength: number;
}

export const requestDocumentUploadResponseSchema = z.object({
  upload: z.object({
    uploadId: z.string(),
    url: z.string(),
    headers: z.record(z.string(), z.string()),
    expiresAt: z.string(),
  }),
});

export type RequestedDocumentUpload = z.infer<
  typeof requestDocumentUploadResponseSchema
>['upload'];

/** PENDING, PROCESSING and EXPIRED are all still yours to poll; COMPLETED
 *  and FAILED are terminal, same as VITA's own DocumentUploadStatus. */
export const documentUploadStatusResponseSchema = z.object({
  upload: z.object({
    uploadId: z.string(),
    status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED']),
    error: z.object({ code: z.string(), description: z.string() }).nullable(),
  }),
});

export type DocumentUploadStatusResult = z.infer<
  typeof documentUploadStatusResponseSchema
>['upload'];

/** Only `open` accepts documents. `in_progress` and `ready_to_import` can be
 *  imported. `generating` and `failed` can be neither. */
export const planStatusResponseSchema = z.object({
  plan: z.object({
    id: z.string(),
    status: z.enum([
      'open',
      'generating',
      'in_progress',
      'ready_to_import',
      'failed',
    ]),
    updatedAt: z.string(),
    message: z.string(),
  }),
});

export type PlanStatusResult = z.infer<typeof planStatusResponseSchema>['plan'];

// The plan content contract (GET /plans/{planReferenceId}/content). Mirrors
// the server's schema but tolerates keys it does not know: an additive change
// does not bump `schemaVersion`, so it must not break a deployed client.

const text = z.string().nullable();
const richText = z.object({ text: z.string(), html: z.string() });
const citation = z.object({
  quote: z.string(),
  documentName: z.string(),
  page: z.number().int().nullable(),
});
const entry = z.object({ content: richText, citations: z.array(citation) });
const narrative = entry.nullable();
const approval = z
  .object({ approvedAt: z.string(), approvedBy: z.string().nullable() })
  .nullable();
const outcome = entry.extend({
  preparingForAdulthood: text,
  timeline: text,
  reviewDate: text,
});
const provision = entry.extend({ frequency: text, deliverer: text });
const socialCareProvision = provision.extend({ type: z.enum(['H1', 'H2']) });
const group = <P extends z.ZodTypeAny>(provisionSchema: P) =>
  z.object({
    needsAndProvisions: z.array(
      z.object({ needs: z.array(entry), provisions: z.array(provisionSchema) }),
    ),
    outcomes: z.array(outcome),
  });
const educationArea = z.object({
  strengths: z.array(entry),
  needProvisionOutcomeGroups: z.array(group(provision)),
});
const needsProvisionsOutcomes = <G extends z.ZodTypeAny>(groupSchema: G) =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('no_needs_identified'), statement: richText }),
    z.object({ kind: z.literal('identified'), groups: z.array(groupSchema) }),
  ]);

export const planContentSchema = z.object({
  schemaVersion: z.number().int(),
  plan: z.object({
    reference: z.string(),
    status: z.enum(['in_progress', 'ready_to_import']),
    contentRevision: z.number().int(),
    updatedAt: z.string(),
    approvedAt: z.string().nullable(),
  }),
  sources: z.array(
    z.object({
      documentName: z.string(),
      originalFilename: z.string().nullable(),
      tags: z.array(z.string()),
      createdAt: z.string().nullable(),
    }),
  ),
  details: z.object({
    approval,
    childOrYoungPerson: z.object({
      firstName: text,
      surname: text,
      otherNames: text,
      dateOfBirth: text,
      homeAddress: text,
      gender: text,
      preferredPronoun: text,
      religion: text,
      ethnicity: text,
      firstLanguage: text,
    }),
    parentCarers: z.array(
      z.object({
        firstName: text,
        surname: text,
        address: text,
        email: text,
        telephone: text,
        relationshipToChild: text,
        firstLanguage: text,
      }),
    ),
    identifiers: z.object({ upn: text, nhsNumber: text }),
    education: z.object({ setting: text }),
    socialCare: z.object({
      knownToSocialCare: text,
      team: text,
      lookedAfter: text,
      careType: text,
    }),
  }),
  historyAndViews: z.object({
    approval,
    history: z.object({
      home: narrative,
      health: narrative,
      education: narrative,
      involvingInDecisionMaking: narrative,
      specialistServicesEngagement: narrative,
    }),
    childOrYoungPersonViews: z.object({
      howViewsWereContributed: narrative,
      views: narrative,
      friendsRelationshipsAndCommunity: narrative,
      educationAndSchool: narrative,
      healthAndWellbeing: narrative,
      interests: narrative,
      howTheyLikeToInteract: narrative,
      strengths: narrative,
      independence: narrative,
      aspirationsAndGoals: narrative,
      furtherEducationPlans: narrative,
      howToCommunicateWithThem: narrative,
    }),
    parentCarerViews: z.object({
      viewsOnHistoryInterestsAspirations: narrative,
      aspirations: narrative,
    }),
  }),
  specialEducationalNeeds: z.object({
    approval,
    summaryOfNeeds: narrative,
    communicationAndInteraction: educationArea,
    cognitionAndLearning: educationArea,
    socialEmotionalMentalHealth: educationArea,
    physicalSensory: educationArea,
  }),
  health: z.object({
    approval,
    strengths: z.array(entry),
    needsProvisionsOutcomes: needsProvisionsOutcomes(group(provision)),
  }),
  socialCare: z.object({
    approval,
    strengths: z.array(entry),
    needsProvisionsOutcomes: needsProvisionsOutcomes(
      group(socialCareProvision),
    ),
  }),
  adviceAndInformation: z.object({
    approval,
    entries: z.array(
      z.object({
        requested: text,
        documentName: text,
        documentDate: text,
        staffOrganisation: text,
        staffName: text,
        staffRole: text,
      }),
    ),
  }),
});

export type PlanContent = z.infer<typeof planContentSchema>;
export type PlanContentRichText = z.infer<typeof richText>;
export type PlanContentCitation = z.infer<typeof citation>;
export type PlanContentEntry = z.infer<typeof entry>;
export type PlanContentNarrative = z.infer<typeof narrative>;
export type PlanContentApproval = z.infer<typeof approval>;
export type PlanContentOutcome = z.infer<typeof outcome>;
export type PlanContentProvision = z.infer<typeof provision>;
export type PlanContentSocialCareProvision = z.infer<
  typeof socialCareProvision
>;
export type PlanContentEducationArea = z.infer<typeof educationArea>;
export type PlanContentSource = PlanContent['sources'][number];
export type PlanContentParentCarer =
  PlanContent['details']['parentCarers'][number];
export type PlanContentAdviceEntry =
  PlanContent['adviceAndInformation']['entries'][number];
