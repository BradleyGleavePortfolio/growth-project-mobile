/**
 * FR-865R4 (agent 182): the voice note page a coach opens from the inbox (and a member opens from search) is
 * Voice B Studio's page (GOAL B-09a in frame 05b's shell).
 *
 * Sol R3 #865 B7, Opus R3 #865 C3: ONE header in every state (closed, loading, gone, loaded), the deep forest bar
 * with Back and the title, and the app's status band above it in the same forest with light icons; never a light
 * stack bar over a second "Voice note" title. The coach stack mounts the page with no bar of its own
 * (coachCommunityHeaders868.test.ts).
 *
 * Sol R3 #865 B7, Opus R3 #865 N6: the note is named the Studio way (GOAL B-09a, as the Hall's voice rows): a square
 * identity tile (a member's leaf tile with a moss edge; the coach's deep tile with a gold serif initial), the name in
 * the Hall's type, the Hall's Coach mark on a coach's note, the time beside the name, no mic glyph; and the player is
 * told when the phone is offline, so Play is off rather than failing.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { forestPop } from '../../../theme/tokens';
import { StatusBarBand, STATUS_BAR_BONE } from '../../../components/StatusBarBand';

jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, communityVoiceNotes: true } };
});
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, navigate: jest.fn() }),
  useRoute: () => ({ params: { voiceNoteId: 'n1' } }),
  useFocusEffect: (cb: () => void | (() => void)) => require('react').useEffect(() => cb(), [cb]), // focused while mounted
}));
jest.mock('expo-status-bar', () => ({ StatusBar: ({ style }: { style: string }) =>
  require('react').createElement(require('react-native').Text, null, `icons-${style}`) }));
// Line icons read as their names here, so a test can say which glyphs the page draws.
jest.mock('@expo/vector-icons', () => ({
  ...jest.requireActual('@expo/vector-icons'),
  Ionicons: ({ name }: { name: string }) =>
    require('react').createElement(require('react-native').Text, null, `icon-${name}`),
}));
jest.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: {} }) }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1' }) }));
jest.mock('../../../components/community/SafetyMenu', () => () => null);
const mockPlayer = jest.fn();
jest.mock('../../../components/community/VoiceNotePlayer', () => (props: unknown) => {
  mockPlayer(props);
  return null;
});
const mockGetOne = jest.fn();
jest.mock('../../../api/communityVoiceApi', () => ({
  communityVoiceApi: { getOne: (...a: unknown[]) => mockGetOne(...a) },
}));

import CommunityVoiceNoteDetail from '../CommunityVoiceNoteDetail';

const flags = (jest.requireMock('../../../config/featureFlags') as { featureFlags: Record<string, boolean> })
  .featureFlags;

const note = (extra: Record<string, unknown> = {}) => ({
  id: 'n1',
  author_id: 'u1',
  author_name: 'Riley Chen',
  url: 'https://x/n1.m4a',
  duration_ms: 42000,
  created_at: new Date().toISOString(),
  waveform_peaks: [0.2, 0.9, 0.4],
  ...extra,
});

type State = 'closed' | 'loading' | 'gone' | 'loaded' | 'loaded-as-is';

async function renderPage(state: State) {
  if (state === 'closed') flags.communityVoiceNotes = false; // the route's flag off: the "not available" page
  if (state === 'loading') mockGetOne.mockReturnValue(new Promise(() => {}));
  if (state === 'gone') mockGetOne.mockRejectedValue(new Error('not found'));
  if (state === 'loaded') mockGetOne.mockResolvedValue(note());
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const phone = (page: boolean) => (
    <QueryClientProvider client={qc}>
      <SafeAreaInsetsContext.Provider value={{ top: 47, bottom: 34, left: 0, right: 0 }}>
        {page ? <CommunityVoiceNoteDetail /> : null}
        <StatusBarBand />
      </SafeAreaInsetsContext.Provider>
    </QueryClientProvider>
  );
  const view = await render(phone(true));
  if (state === 'closed') view.getByText('This voice note is not available right now.');
  if (state === 'loading') await view.findByTestId('community-voice-detail-loading');
  if (state === 'gone') await view.findByTestId('community-voice-detail-error');
  if (state === 'loaded' || state === 'loaded-as-is') await view.findByTestId('community-voice-detail-scroll');
  const band = () => StyleSheet.flatten(view.getByTestId('status-bar-band').props.style).backgroundColor;
  return { ...view, band, leave: () => view.rerender(phone(false)) };
}

const netInfo = jest.requireMock('@react-native-community/netinfo') as {
  __setState: (next: Record<string, unknown>) => void;
  __reset: () => void;
};
const lastPlayer = () => mockPlayer.mock.calls.at(-1)?.[0] as { tone?: string; offline?: boolean } | undefined;
const style = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) ?? {};
const hidden = { includeHiddenElements: true };

afterEach(() => {
  netInfo.__reset();
  flags.communityVoiceNotes = true;
  mockGoBack.mockClear();
  mockGetOne.mockReset();
  mockPlayer.mockClear();
});

describe('one header: the deep Studio bar with Back (Sol R3 #865 B7, Opus R3 #865 C3)', () => {
  it.each<State>(['closed', 'loading', 'gone', 'loaded'])(
    '%s: one bar, deep forest, titled once, Back goes back, the status band forest with light icons',
    async (state) => {
      const page = await renderPage(state);
      const bars = page.getAllByTestId('community-voice-detail-header');
      expect(bars).toHaveLength(1);
      expect(StyleSheet.flatten(bars[0].props.style).backgroundColor).toBe(forestPop.deep);
      expect(page.getAllByText('Voice note')).toHaveLength(1);
      const back = page.getByTestId('community-voice-detail-header-back');
      expect(back.props.accessibilityLabel).toBe('Back');
      fireEvent.press(back);
      expect(mockGoBack).toHaveBeenCalledTimes(1);
      expect(page.band()).toBe(forestPop.deep);
      expect(page.getByText('icons-light')).toBeTruthy();
    },
  );

  it('the status band is bone again once the page has gone', async () => {
    const page = await renderPage('loaded');
    expect(page.band()).toBe(forestPop.deep);
    await page.leave();
    expect(page.band()).toBe(STATUS_BAR_BONE);
    expect(page.queryByText('icons-light')).toBeNull();
  });
});

describe('the note is named the Studio way (Sol R3 #865 B7, Opus R3 #865 N6)', () => {
  it("a member's note: a leaf tile with a moss edge, the name and time in the Hall's type, no mic glyph", async () => {
    const page = await renderPage('loaded');
    const tile = page.getByTestId('community-voice-detail-tile', hidden);
    expect(style(tile)).toMatchObject({ width: 32, height: 32, borderRadius: 10, backgroundColor: forestPop.leaf,
      borderColor: forestPop.moss, borderWidth: 1 });
    expect(style(page.getByText('R', hidden))).toMatchObject({ color: forestPop.ink });
    // The tile is decoration: a screen reader hears the name beside it, not the letter twice.
    expect(page.queryByTestId('community-voice-detail-tile')).toBeNull();
    expect(style(page.getByText('Riley Chen'))).toMatchObject({ fontSize: 17, fontWeight: '600', color: forestPop.ink });
    expect(style(page.getByText('just now'))).toMatchObject({ fontSize: 15, color: forestPop.n700 });
    expect(page.queryByText('Coach')).toBeNull();
    expect(page.queryByText('icon-mic-outline')).toBeNull();
    expect(lastPlayer()?.tone).toBe('light');
  });

  it("a coach's note: the deep tile with a gold serif initial and the Hall's Coach mark, on the deep card", async () => {
    mockGetOne.mockResolvedValue(note({ author_name: 'Sam Rivera', author_is_coach: true }));
    const page = await renderPage('loaded-as-is');
    expect(style(page.getByTestId('community-voice-detail-tile', hidden))).toMatchObject({ backgroundColor: forestPop.deep });
    expect(style(page.getByText('S', hidden))).toMatchObject({ color: forestPop.gold, fontFamily: 'CormorantGaramond_500Medium' });
    expect(style(page.getByText('Coach'))).toMatchObject({ backgroundColor: forestPop.deep, color: forestPop.gold });
    expect(lastPlayer()?.tone).toBe('coach');
  });

  it('no name: the page says "Voice note" and draws no tile, never an invented letter', async () => {
    mockGetOne.mockResolvedValue(note({ author_name: null }));
    const page = await renderPage('loaded-as-is');
    expect(page.queryByTestId('community-voice-detail-tile', hidden)).toBeNull();
    expect(page.getAllByText('Voice note')).toHaveLength(2); // the bar's title and the name line
  });

  it('offline: the player is told, so Play is off (the grey disc of GOAL B-10a), not a load that fails', async () => {
    netInfo.__setState({ isConnected: false, isInternetReachable: false });
    await renderPage('loaded');
    await waitFor(() => expect(lastPlayer()?.offline).toBe(true));
  });

  it('online: Play is on', async () => {
    await renderPage('loaded');
    await waitFor(() => expect(lastPlayer()?.offline).toBe(false));
  });
});
