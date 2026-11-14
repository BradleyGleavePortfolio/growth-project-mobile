/**
 * QUOTE-STRIP-950 (agent 203, RENDER-CHECK-203 HI1): a turn the client sent as a reply reads in the
 * history as it does in the Roman room: its quote strip sits at the right, no wider than the room's
 * bubble, on a fill that differs from the page. The room's own strip is drawn as before.
 * The theme mock returns the real light tokens (the screen's own test returns one colour for all).
 */
import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { render } from '@testing-library/react-native';
import RomanConversationScreen from '../RomanConversationScreen';
import RomanMessageBubble from '../../../components/roman/RomanMessageBubble';
import { authEpoch } from '../../../services/accountBinding';
import { lightTokens } from '../../../theme/tokens';
import type { RomanChatsApi, RomanTranscriptPage } from '../../../api/romanChatsApi';
import type { RomanMessage } from '../../../api/romanApi';

jest.mock('../../../services/api', () => ({ __esModule: true, default: {} }));
jest.mock('../../../utils/haptics', () => ({ lightTap: jest.fn(), mediumTap: jest.fn(), warningTap: jest.fn(), selectionTap: jest.fn() }));
jest.mock('../../../utils/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn(), log: jest.fn() } }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: jest.requireActual('../../../constants/colors').default,
    semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
  }),
}));
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn() }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn(), setSentryUser: jest.fn() }));

const REPLY = '> Keep Thursday easy\n\nCan I do it indoors?';
const msg = (role: RomanMessage['role'], content: string): RomanMessage => ({
  id: 'm1', role, content, interrupted: false, createdAt: '2026-10-01T08:00:00.000Z',
});
const flat = (s: unknown): ViewStyle => StyleSheet.flatten(s as StyleProp<ViewStyle>) ?? {};

const readHistory = (message: RomanMessage) => {
  const api = {
    list: jest.fn(),
    readMessages: jest.fn(async () => ({ ok: true as const, value: { messages: [message], nextCursor: null } as RomanTranscriptPage })),
    deleteOne: jest.fn(),
    deleteAll: jest.fn(),
  };
  const params = {
    id: 'cx1', ownerId: 'user-a', binding: { subject: 'sub:user-a', epoch: authEpoch() },
    startedAt: '2026-10-01T08:00:00.000Z', surface: 'client' as const, messageCount: 1,
  };
  return render(
    <RomanConversationScreen
      navigation={{ goBack: jest.fn(), navigate: jest.fn() } as never}
      route={{ params }}
      api={api as unknown as RomanChatsApi}
      sessionUserId={() => 'user-a'}
    />,
  );
};

const room = () => render(<RomanMessageBubble message={msg('user', REPLY)} testID="u" />);

describe('QUOTE-STRIP-950: a quoted user turn in the history draws its strip right-aligned, with a fill other than the page background', () => {
  const historyStrip = async () => {
    const screen = await readHistory(msg('user', REPLY));
    const strip = flat((await screen.findByTestId('roman-transcript-message-m1-quote')).props.style);
    const page = flat(screen.getByTestId('roman-chat-transcript-screen').props.style).backgroundColor;
    return { strip, page };
  };

  it('case 1: the strip sits inside the room\'s bubble (at most 82%), with no place or width of its own', async () => {
    const { strip } = await historyStrip();
    const roomBubble = flat((await room()).getByTestId('u-bubble').props.style);
    expect(roomBubble.maxWidth).toBe('82%');
    expect(strip.alignSelf).toBeUndefined();
    expect(strip.maxWidth).toBeUndefined();
  });

  it('case 2: its fill is the room\'s (bgPrimary), not the bubble\'s bgSurface', async () => {
    const { strip, page } = await historyStrip();
    expect(page).toBeTruthy();
    expect(strip.backgroundColor).toBe(lightTokens.bgPrimary);
    expect(strip.backgroundColor).not.toBe(lightTokens.bgSurface);
  });
});

describe('QUOTE-STRIP-950: the history strip keeps its words, and other turns draw none', () => {
  it('keeps "Replying to: <quote>", its testID, the two-line cut and "You said: <words>"', async () => {
    const screen = await readHistory(msg('user', REPLY));
    const strip = await screen.findByTestId('roman-transcript-message-m1-quote');
    expect(strip.props.accessibilityLabel).toBe('Replying to: Keep Thursday easy');
    expect(screen.getByText('Keep Thursday easy').props.numberOfLines).toBe(2);
    expect(screen.getByLabelText('You said: Can I do it indoors?')).toBeTruthy();
  });

  it.each([
    ['a plain turn', 'Can I do it indoors?', 'user'],
    ['a "> " line with no blank line after it', '> Keep Thursday easy\nCan I do it indoors?', 'user'],
    ['a "> " line with an empty body', '> Keep Thursday easy\n\n   ', 'user'],
    ['a Roman turn that starts with a "> " line', REPLY, 'assistant'],
  ] as const)('%s draws no strip', async (_name, content, role) => {
    const screen = await readHistory(msg(role, content));
    await screen.findByTestId('roman-transcript-message-m1');
    expect(screen.queryByTestId('roman-transcript-message-m1-quote')).toBeNull();
  });
});

describe('QUOTE-STRIP-950: the room draws its strip as before', () => {
  it('fill bgPrimary, no alignment or width of its own, inside its bgSurface bubble', async () => {
    const r = await room();
    const strip = flat(r.getByTestId('u-quote').props.style);
    expect(strip.backgroundColor).toBe(lightTokens.bgPrimary);
    expect(strip.alignSelf).toBeUndefined();
    expect(strip.maxWidth).toBeUndefined();
    expect(strip.width).toBeUndefined();
    expect(flat(r.getByTestId('u-bubble').props.style).backgroundColor).toBe(lightTokens.bgSurface);
    expect(r.getByTestId('u-quote').props.accessibilityLabel).toBe('Replying to: Keep Thursday easy');
    expect(r.getByText('Keep Thursday easy').props.numberOfLines).toBe(2);
    expect(r.getByLabelText('You said: Can I do it indoors?')).toBeTruthy();
  });
});
