/**
 * LS-865R4B B2: Voice B Studio 09a names each note with its clock time.
 * Hall's existing relative-age helper is not an approved GOAL exception.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../theme/useTheme', () => ({
  useTheme: () => ({
    colorScheme: 'light',
    semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
  }),
}));
jest.mock('../../../config/featureFlags', () => ({
  featureFlags: { communityVoiceNotes: true, communitySearch: false },
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
  useRoute: () => ({ params: { voiceNoteId: 'clock-note' } }),
}));
jest.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: {} }) }));
jest.mock('../../../hooks/useVoiceFeed', () => ({ useVoiceCatchUp: () => undefined }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1' }) }));
jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityMe: () => ({ data: { workspace_id: 'ws', membership: { id: 'm', role: 'coach' } } }),
}));
jest.mock('../../../components/StatusBarBand', () => ({ ForestStatusBar: () => null }));
jest.mock('../../../components/community', () => ({ ThreadHeader: () => null }));
jest.mock('../../../components/community/SafetyMenu', () => () => null);
jest.mock('../../../components/community/VoiceNotePlayer', () => () => null);
const mockGetOne = jest.fn();
jest.mock('../../../api/communityVoiceApi', () => ({
  communityVoiceApi: { getOne: (...args: unknown[]) => mockGetOne(...args) },
}));

import CommunityVoiceNoteDetail from '../CommunityVoiceNoteDetail';

it('Studio note metadata shows its 9:20 clock, not only a relative age', async () => {
  // Local time avoids a timezone-specific expectation; duration cannot be 9:20.
  mockGetOne.mockResolvedValue({
    id: 'clock-note', author_id: 'sender', author_name: 'Riley Chen',
    author_is_coach: false, url: null, duration_ms: 42000,
    created_at: new Date(2026, 9, 28, 9, 20).toISOString(),
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await render(
    <QueryClientProvider client={qc}><CommunityVoiceNoteDetail /></QueryClientProvider>,
  );
  try {
    await view.findByText('Riley Chen');
    expect(view.queryByText(/^0?9:20(?:\s*a\.?m\.?)?$/i)).not.toBeNull();
  } finally {
    await view.unmount();
    qc.clear();
  }
});
