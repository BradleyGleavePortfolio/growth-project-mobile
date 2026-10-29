/**
 * FR-865R5 (agent 183), Sol R4 #865 B1 and B2, beside the lens's own B-TESTs (voiceDetailNarrowLayout / voiceDetailClock).
 *
 * B1: the actual page, player and waveform at the six phone widths the round names, a member's and a coach's note: the
 * 48 bars fit their seek target at every width; from 360 pt the card keeps GOAL B-09a's place under the name (44 pt in),
 * and only on a phone too narrow for that (320 pt) does the card keep the page's width.
 *
 * B2: the time beside the name is the note's clock in the phone's own 12/24-hour setting (expo-localization), with
 * midnight as 00:05 on a 24-hour phone, never 24:05; and since a clock is longer than an age, the name, Coach mark and clock
 * share a wrapping line, so the clock goes under the name instead of cutting it (found by the 320 pt and 130% renders).
 */
import React from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { render, within } from '@testing-library/react-native';
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
  useRoute: () => ({ params: { voiceNoteId: 'fit-note' } }),
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
const mockCalendars = jest.fn(() => [{ uses24hourClock: true as boolean | null }]);
jest.mock('expo-localization', () => ({ getCalendars: () => mockCalendars() }));
const mockGetOne = jest.fn();
jest.mock('../../../api/communityVoiceApi', () => ({
  communityVoiceApi: { getOne: (...args: unknown[]) => mockGetOne(...args) },
}));

import CommunityVoiceNoteDetail from '../CommunityVoiceNoteDetail';

type Node = { type: unknown; props: Record<string, any>; parent: Node | null; children: Array<Node | string> };
const style = (node: Node) => StyleSheet.flatten(node.props.style) ?? {};
const side = (s: Record<string, any>, edge: 'Left' | 'Right') =>
  Number(s[`padding${edge}`] ?? s.paddingHorizontal ?? s.padding ?? 0) + Number(s[`border${edge}Width`] ?? s.borderWidth ?? 0);

async function renderAt(width: number, note: Record<string, unknown>) {
  const dimensions = jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height: 844, scale: 1, fontScale: 1 });
  mockGetOne.mockResolvedValue({
    id: 'fit-note', author_id: 'sender', author_name: 'Riley Chen', author_is_coach: false,
    url: 'https://audio.example.invalid/fit.m4a', duration_ms: 42000, waveform_peaks: Array(48).fill(0.5),
    created_at: new Date(2026, 9, 28, 9, 20).toISOString(), ...note,
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await render(<QueryClientProvider client={qc}><CommunityVoiceNoteDetail /></QueryClientProvider>);
  await view.findByText('Riley Chen');
  return {
    view,
    done: async () => { await view.unmount(); qc.clear(); dimensions.mockRestore(); },
  };
}

describe('B1: the bars fit their seek target at every phone width (Sol R4 #865 B1)', () => {
  it.each([320, 360, 375, 390, 414, 430].flatMap((width) => [false, true].map((coach) => [width, coach] as const)))(
    '%i pt, author_is_coach=%s: every bar inside the seek target; under the name from 360 pt',
    async (width, coach) => {
      const { view, done } = await renderAt(width, { author_is_coach: coach });
      try {
        const scroll = view.getByTestId('community-voice-detail-scroll') as unknown as Node;
        const card = view.getByTestId('community-voice-detail-player') as unknown as Node;
        const toggle = view.getByTestId('voice-player-toggle', { includeHiddenElements: true }) as unknown as Node;
        const seek = view.getByTestId('voice-player-seek', { includeHiddenElements: true }) as unknown as Node;
        const wave = view.getByTestId('voice-waveform', { includeHiddenElements: true }) as unknown as Node;
        const page = StyleSheet.flatten(scroll.props.contentContainerStyle) ?? {};
        // The inset between the page's sides and the card (a forwarded style object counted once).
        const seen = new Set([scroll.props.contentContainerStyle, card.props.style]);
        let inset = 0;
        for (let n = card.parent; n && n !== scroll; n = n.parent) {
          if (n.props.style && !seen.has(n.props.style)) {
            inset += side(style(n), 'Left') + side(style(n), 'Right');
            seen.add(n.props.style);
          }
        }
        expect(inset).toBe(width >= 360 ? 44 : 0);
        let row = seek.parent;
        while (row && !(style(row).flexDirection === 'row' && style(row).gap)) row = row.parent;
        const available = width - side(page, 'Left') - side(page, 'Right') - inset -
          side(style(card), 'Left') - side(style(card), 'Right') - Number(style(toggle).width) - Number(style(row!).gap);
        const bars = wave.children.filter((n): n is Node => typeof n !== 'string');
        expect(bars).toHaveLength(48);
        // A bar is never narrower than its two 1 pt edges; 47 gaps between 48 bars.
        const required = bars.reduce((sum, n) => sum + Math.max(Number(style(n).width ?? 0), side(style(n), 'Left') +
          side(style(n), 'Right')), 0) + (bars.length - 1) * Number(style(wave).gap);
        expect(required).toBeLessThanOrEqual(available);
      } finally {
        await done();
      }
    },
  );
});

describe("B2: the note's clock in the phone's 12/24-hour setting (Sol R4 #865 B2)", () => {
  afterEach(() => mockCalendars.mockReset().mockImplementation(() => [{ uses24hourClock: true }]));

  it.each([
    [false, 9, 20, /^9:20\s?a\.?m\.?$/i],
    [false, 21, 20, /^9:20\s?p\.?m\.?$/i],
    [true, 21, 20, /^21:20$/],
    [true, 0, 5, /^00:05$/],
  ] as const)('uses24hourClock=%s, %i:%i local reads %s', async (h24, hour, minute, expected) => {
    mockCalendars.mockImplementation(() => [{ uses24hourClock: h24 }]);
    const { view, done } = await renderAt(390, { created_at: new Date(2026, 9, 28, hour, minute).toISOString() });
    try {
      expect(view.getByText(expected)).toBeTruthy();
      expect(view.queryByText(/^just now$|^\d+(?:m|h|d|w|mo)$/)).toBeNull(); // the relative age is gone
    } finally {
      await done();
    }
  });

  it('a clock is longer than an age: the name, Coach mark and clock share a wrapping line, so the clock never cuts the name', async () => {
    mockCalendars.mockImplementation(() => [{ uses24hourClock: false }]);
    const { view, done } = await renderAt(320, { author_is_coach: true });
    try {
      let line = (view.getByText('Riley Chen') as unknown as Node).parent;
      while (line && style(line).flexDirection !== 'row') line = line.parent;
      expect(style(line!)).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' });
      expect(within(line as never).getByText('Coach')).toBeTruthy();
      expect(within(line as never).getByText(/^9:20\s?a\.?m\.?$/i)).toBeTruthy();
      expect(within(line as never).queryByTestId('community-voice-detail-tile')).toBeNull();
    } finally {
      await done();
    }
  });

  it('no 12/24-hour reading (web): the phone locale decides, still a clock', async () => {
    mockCalendars.mockImplementation(() => [{ uses24hourClock: null }]);
    const { view, done } = await renderAt(390, {});
    try {
      expect(view.getByText(/^0?9:20(\s?a\.?m\.?)?$/i)).toBeTruthy();
    } finally {
      await done();
    }
  });
});
