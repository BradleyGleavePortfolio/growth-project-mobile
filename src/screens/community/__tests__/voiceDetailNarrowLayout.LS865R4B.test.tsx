/**
 * LS-865R4B B1: render the actual detail, player and waveform at a 320 pt window.
 * The strip must fit its seek target, or clip there, not draw past the card.
 * A render-tree width budget complements the isolated browser measurements:
 * 320 - page 32 - indent 44 - card 24 - disc/gap 64 = 156;
 * 48 bordered bars and 47 gaps require at least 190.
 */
import React from 'react';
import { Dimensions, StyleSheet } from 'react-native';
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
  useRoute: () => ({ params: { voiceNoteId: 'narrow-note' } }),
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
const mockGetOne = jest.fn();
jest.mock('../../../api/communityVoiceApi', () => ({
  communityVoiceApi: { getOne: (...args: unknown[]) => mockGetOne(...args) },
}));

import CommunityVoiceNoteDetail from '../CommunityVoiceNoteDetail';

type Node = {
  type: unknown;
  props: Record<string, any>;
  parent: Node | null;
  children: Array<Node | string>;
};
const style = (node: Node) => StyleSheet.flatten(node.props.style) ?? {};
const horizontal = (s: Record<string, any>) =>
  Number(s.paddingLeft ?? s.paddingHorizontal ?? s.padding ?? 0) +
  Number(s.paddingRight ?? s.paddingHorizontal ?? s.padding ?? 0) +
  Number(s.borderLeftWidth ?? s.borderWidth ?? 0) +
  Number(s.borderRightWidth ?? s.borderWidth ?? 0);

it.each([false, true])(
  '320 pt: author_is_coach=%s waveform stays inside its seek target',
  async (coach) => {
    const dimensions = jest.spyOn(Dimensions, 'get').mockReturnValue({
      width: 320, height: 844, scale: 1, fontScale: 1,
    });
    mockGetOne.mockResolvedValue({
      id: 'narrow-note', author_id: 'sender', author_name: 'Riley Chen',
      author_is_coach: coach, url: 'https://audio.example.invalid/narrow.m4a',
      duration_ms: 42000, waveform_peaks: Array(48).fill(0.5),
      created_at: new Date().toISOString(),
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = await render(
      <QueryClientProvider client={qc}><CommunityVoiceNoteDetail /></QueryClientProvider>,
    );
    try {
      const card = await view.findByTestId('community-voice-detail-player') as unknown as Node;
      const scroll = view.getByTestId('community-voice-detail-scroll') as unknown as Node;
      const seek = view.getByTestId('voice-player-seek', { includeHiddenElements: true }) as unknown as Node;
      const wave = view.getByTestId('voice-waveform', { includeHiddenElements: true }) as unknown as Node;
      const toggle = view.getByTestId('voice-player-toggle', { includeHiddenElements: true }) as unknown as Node;
      let available = Dimensions.get('window').width -
        horizontal(StyleSheet.flatten(scroll.props.contentContainerStyle) ?? {});
      // Native test renders retain the content view and composite wrappers.
      // Count a forwarded style object once, and not the scroll inset twice.
      const counted = new Set([scroll.props.contentContainerStyle, card.props.style]);
      for (let n = card.parent; n && n !== scroll; n = n.parent) {
        if (n.props.style && !counted.has(n.props.style)) {
          available -= horizontal(style(n));
          counted.add(n.props.style);
        }
      }
      available -= horizontal(style(card));
      let row = seek.parent;
      while (row && !(style(row).flexDirection === 'row' && style(row).gap)) row = row.parent;
      expect(row).not.toBeNull();
      available -= Number(style(toggle).width ?? style(toggle).minWidth ?? 0) +
        Number(style(row!).gap ?? 0);
      const bars = wave.children.filter((n): n is Node => typeof n !== 'string');
      const required = bars.reduce((sum, n) => {
        const s = style(n);
        return sum + Math.max(Number(s.width ?? s.minWidth ?? 0),
          Number(s.borderLeftWidth ?? s.borderWidth ?? 0) + Number(s.borderRightWidth ?? s.borderWidth ?? 0));
      }, 0) + Math.max(0, bars.length - 1) * Number(style(wave).gap ?? 0);
      const clipped = [seek, wave].some(n => ['hidden', 'clip', 'scroll'].includes(style(n).overflow));
      expect({ required, available, contained: clipped || required <= available }).toEqual(
        expect.objectContaining({ contained: true }),
      );
    } finally {
      await view.unmount();
      qc.clear();
      dimensions.mockRestore();
    }
  },
);
