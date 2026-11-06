/** LS-938R2: every backend message kind in the coach inbox must have a message destination. */
import type { CoachInboxItem } from '../../../api/coachCommunityApi';
import type { CoachCommunityNav } from '../coachCommunityNavTypes';

jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  return {
    ...actual,
    featureFlags: { ...actual.featureFlags, communitySpaceChat: true, communityVoiceNotes: true },
  };
});
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import { inboxMessageOpener } from '../CoachCommunityInboxScreen';

it.each(['text', 'voice', 'photo'] as const)(
  'LS938R2 B2: a backend %s message has an opener to its space and message',
  (kind) => {
    const item: CoachInboxItem = {
      id: '11111111-1111-4111-8111-111111111111',
      cohort_id: '22222222-2222-4222-8222-222222222222',
      cohort_name: 'Everyone',
      client_user_id: '33333333-3333-4333-8333-333333333333',
      client_name: 'Sam Lee',
      avatar_url: null,
      snippet: kind === 'photo' ? 'Photo' : 'A message',
      created_at: '2026-11-05T12:00:00.000Z',
      acknowledged: false,
      type: 'message',
      kind,
      ...(kind === 'voice' ? { voice: { note_id: '11111111-1111-4111-8111-111111111111', duration_ms: 42000 } } : {}),
    };
    const navigate = jest.fn();
    const open = inboxMessageOpener({ navigate } as unknown as CoachCommunityNav, item);
    expect(open).toEqual(expect.any(Function));
    open?.();
    expect(navigate).toHaveBeenCalledWith('CommunitySpaceChat', {
      cohortId: item.cohort_id,
      messageId: item.id,
    });
  },
);
