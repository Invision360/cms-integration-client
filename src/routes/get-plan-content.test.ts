import { PartnerApiClient } from '../PartnerApiClient';
import { PartnerApiError } from '../errors';
import { CONFIG, jsonResponse, tokenBody } from '../__fixtures__/http';

describe('PartnerApiClient#getPlanContent', () => {
  const delegatedBody = {
    access_token: 'delegated-token',
    token_type: 'Bearer',
    expires_in: 900,
  };

  const emptyGroup = { strengths: [], needProvisionOutcomeGroups: [] };
  const narrative = {
    content: { text: 'Likes trains', html: '<p>Likes trains</p>' },
    citations: [{ quote: 'q', documentName: 'report', page: 2 }],
  };
  const contentBody = () => ({
    schemaVersion: 0,
    plan: {
      reference: '5512_7',
      status: 'in_progress',
      contentRevision: 4,
      updatedAt: '2026-09-10T09:00:00.000Z',
      approvedAt: null,
    },
    sources: [
      {
        documentName: 'report',
        originalFilename: 'Report.docx',
        tags: [],
        createdAt: null,
      },
    ],
    details: {
      approval: null,
      childOrYoungPerson: Object.fromEntries(
        [
          'firstName',
          'surname',
          'otherNames',
          'dateOfBirth',
          'homeAddress',
          'gender',
          'preferredPronoun',
          'religion',
          'ethnicity',
          'firstLanguage',
        ].map(key => [key, key === 'firstName' ? 'Alex' : null]),
      ),
      parentCarers: [],
      identifiers: { upn: null, nhsNumber: null },
      education: { setting: null },
      socialCare: {
        knownToSocialCare: null,
        team: null,
        lookedAfter: null,
        careType: null,
      },
    },
    historyAndViews: {
      approval: null,
      history: Object.fromEntries(
        [
          'home',
          'health',
          'education',
          'involvingInDecisionMaking',
          'specialistServicesEngagement',
        ].map(key => [key, key === 'home' ? narrative : null]),
      ),
      childOrYoungPersonViews: Object.fromEntries(
        [
          'howViewsWereContributed',
          'views',
          'friendsRelationshipsAndCommunity',
          'educationAndSchool',
          'healthAndWellbeing',
          'interests',
          'howTheyLikeToInteract',
          'strengths',
          'independence',
          'aspirationsAndGoals',
          'furtherEducationPlans',
          'howToCommunicateWithThem',
        ].map(key => [key, null]),
      ),
      parentCarerViews: {
        viewsOnHistoryInterestsAspirations: null,
        aspirations: null,
      },
    },
    specialEducationalNeeds: {
      approval: null,
      summaryOfNeeds: null,
      communicationAndInteraction: emptyGroup,
      cognitionAndLearning: emptyGroup,
      socialEmotionalMentalHealth: emptyGroup,
      physicalSensory: emptyGroup,
    },
    health: {
      approval: null,
      strengths: [],
      needsProvisionsOutcomes: {
        kind: 'no_needs_identified',
        statement: { text: 'None', html: '<p>None</p>' },
      },
    },
    socialCare: {
      approval: null,
      strengths: [],
      needsProvisionsOutcomes: { kind: 'identified', groups: [] },
    },
    adviceAndInformation: { approval: null, entries: [] },
  });

  const clientFor = (...responses: Response[]) => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(delegatedBody));
    for (const response of responses) fetchImpl.mockResolvedValueOnce(response);
    return {
      fetchImpl,
      client: new PartnerApiClient({ ...CONFIG, fetch: fetchImpl }),
    };
  };

  it('reads the content of the plan by its reference', async () => {
    const { fetchImpl, client } = clientFor(
      jsonResponse(contentBody(), true, 200),
    );

    const content = await client.getPlanContent('48213', 'a/b c');

    expect(content).toEqual(contentBody());
    const [url, init] = fetchImpl.mock.calls[2];
    expect(url).toBe(`${CONFIG.apiUrl}/plans/a%2Fb%20c/content`);
    expect(init.headers.Authorization).toBe('Bearer delegated-token');
  });

  it('drops keys it does not know about rather than failing, so an additive change does not break it', async () => {
    const body = { ...contentBody(), newTopLevel: true };
    const { client } = clientFor(jsonResponse(body, true, 200));

    const content = await client.getPlanContent('48213', '5512_7');

    expect(content).toEqual(contentBody());
    expect(content).not.toHaveProperty('newTopLevel');
  });

  it('rejects a payload missing required fields', async () => {
    const { schemaVersion: _omitted, ...body } = contentBody();
    const { client } = clientFor(jsonResponse(body, true, 200));

    await expect(
      client.getPlanContent('48213', '5512_7'),
    ).rejects.toMatchObject({
      kind: 'malformed-response',
    });
  });

  it.each([
    [404, 'not_found'],
    [403, 'plan_forbidden'],
    [409, 'plan_not_ready'],
  ])(
    'surfaces a %s as a typed PartnerApiError, never retried',
    async (statusCode, code) => {
      const { fetchImpl, client } = clientFor(
        jsonResponse({ error: code }, false, statusCode),
      );

      await expect(
        client.getPlanContent('48213', '5512_7'),
      ).rejects.toMatchObject({
        kind: 'http',
        statusCode,
        code,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    },
  );
});
