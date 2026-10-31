import api from '../services/api';
import { askRomanToDraft, reachOutAsk } from '../screens/coach/home-v11/DraftSheets';
import { planEndedAsk } from '../screens/coach/home-v11/planEndedData';

jest.mock('../services/api', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

it('keeps the exact plan-ended and reach-out POST URLs and bodies, with no per-call headers', async () => {
  const post = jest.mocked(api.post);
  post.mockResolvedValue({
    data: { reply: 'Hello Maya', approval: { required: true, draft_id: 'draft-1' } },
  });
  const ended = planEndedAsk({
    client_id: 'client/one?x#%',
    name: 'Maya Ortiz',
    days_since: 1,
    package_name: '12-week block',
    last_coach_message_at: null,
  });
  const reachOut = reachOutAsk({
    user_id: 'client-2',
    display_name: 'Ana Ruiz',
    top_factor: 'No check-in for 9 days',
  } as Parameters<typeof reachOutAsk>[0]);

  await askRomanToDraft(ended.request, ended.churnedClientId);
  await askRomanToDraft(reachOut.request, reachOut.churnedClientId);

  expect(post.mock.calls).toEqual([
    ['/v1/coach/churned-clients/client%2Fone%3Fx%23%25/draft', {}],
    ['/ai/gateway/invoke', {
      capability: 'draft.coach_message',
      subject_user_id: 'client-2',
      message: 'Write a short, warm check-in from the coach to this client. For you only, never say it to them: No check-in for 9 days. Ask one easy question. No emojis.',
    }],
  ]);
});
