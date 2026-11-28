/**
 * LS-RAM-1 B1 (B-TEST on growth-project-mobile#1025 @ 3d81fecc; owner #200-S4: "when you press and hold ANY message, you
 * should be able to report that message"). A press and hold on a voice note where a finger lands on its card, the
 * waveform or the play disc, opens that note's own Report menu, as a hold on its name does.
 * The press is made as a phone makes it: userEvent.longPress gives the touch to the nearest touchable under the finger,
 * so a hold bound on a wrapper around the player's own pressables does not count (the build's known trap 1). The real
 * section, the real player and the real menu; only the wire, the theme, the icons and the record sheet are stood in.
 * Names are made up.
 */
import React from 'react';
import { render, userEvent, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import VoiceNotesSection from '../VoiceNotesSection';
import { resetVoiceOutbox } from '../../../hooks/useVoiceOutbox';
import { resetReportedVoiceNotes } from '../VoiceReportedFold';
import { registerVoicePlayback, type VoicePlaybackHandle } from '../voicePlaybackPort';

jest.mock('../../../config/featureFlags', () => ({ featureFlags: { communityVoiceNotes: true } }));
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../../../hooks/useCommunity', () => ({
  ...jest.requireActual('../../../hooks/useCommunity'),
  useCommunityMe: () => ({ data: { membership: { role: 'client' } } }),
}));
jest.mock('../VoiceRecordSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn() }),
}));
const mockListFeed = jest.fn();
jest.mock('../../../api/communityVoiceApi', () => {
  const actual = jest.requireActual('../../../api/communityVoiceApi');
  return { ...actual, communityVoiceApi: { listFeed: (...a: unknown[]) => mockListFeed(...a) } };
});

const NOTE = {
  id: 'vn-a', workspace_id: 'ws-1', cohort_id: null, conversation_id: null, author_id: 'u-jo', author_name: 'Jo Park',
  url: 'https://storage.example.test/vn-a', duration_ms: 42_000, bytes: 1000, mime_type: 'audio/mp4',
  waveform_peaks: [0.2, 0.7, 0.4], created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
};
const play = jest.fn(async () => undefined);
const seek = jest.fn(async () => undefined);

beforeEach(() => {
  play.mockClear();
  seek.mockClear();
  resetVoiceOutbox();
  resetReportedVoiceNotes();
  (NetInfo as unknown as { __reset: () => void }).__reset();
  mockListFeed.mockReset().mockResolvedValue({ voice_notes: [NOTE], next_cursor: null });
  registerVoicePlayback({
    isAvailable: true,
    load: jest.fn(async () => ({ play, pause: jest.fn(async () => undefined), seek, unload: jest.fn(async () => undefined) } as unknown as VoicePlaybackHandle)),
  });
});
afterAll(() => registerVoicePlayback(null));

const SHEET = 'vn-menu-vn-a-sheet';
const open = async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const s = await render(
    <QueryClientProvider client={qc}>
      <VoiceNotesSection workspaceId="ws-1" viewerUserId="u-me" viewerCoachId="u-coach" testID="vn" />
    </QueryClientProvider>,
  );
  await s.findByTestId('vn-player-vn-a');
  return s;
};

describe('LS-RAM-1 B1: a hold on a voice note where the finger lands', () => {
  it('control: holding the note\'s name opens its Report menu (green at 3d81fecc)', async () => {
    const user = userEvent.setup();
    const s = await open();
    await user.longPress(s.getByText('Jo Park'), { duration: 600 });
    expect(s.queryByTestId(SHEET)).not.toBeNull();
    expect(s.queryByTestId('vn-menu-vn-a-report')).not.toBeNull();
  });

  it('B1: holding the note\'s waveform opens its Report menu, and does not move the playhead instead', async () => {
    const user = userEvent.setup();
    const s = await open();
    await user.longPress(within(s.getByTestId('vn-player-vn-a')).getByTestId('voice-player-seek'), { duration: 600 });
    expect(s.queryByTestId(SHEET)).not.toBeNull();
    expect(seek).not.toHaveBeenCalled();
  });

  it('B1: holding the note\'s play disc opens its Report menu, and does not start the note instead', async () => {
    const user = userEvent.setup();
    const s = await open();
    await user.longPress(within(s.getByTestId('vn-player-vn-a')).getByTestId('voice-player-toggle'), { duration: 600 });
    expect(s.queryByTestId(SHEET)).not.toBeNull();
    expect(play).not.toHaveBeenCalled();
  });
});
