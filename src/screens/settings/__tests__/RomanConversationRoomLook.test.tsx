/**
 * ROMAN-HISTORY-LOOK-M (agent 203; owner 203-D17 op 1, #203-E50): one past conversation with Roman reads as the
 * Roman room did. Every turn is drawn by the room's one turn component (RomanMessageBubble): Roman's words in his
 * serif under his face and the ROMAN overline, the client's words in the room's bubble with any quote card inside
 * it, an interrupted reply with the room's note, a marked reply with its crisis actions, and no hold. The page has
 * the room's title block. The quote card sizes to its words (LO-958R1 C1): Jest runs no layout, so case f pins the
 * strip text's style on the mounted screen and the mounted bubble; the width itself is shown by code, not by picture.
 * The theme mock returns the real light tokens, as RomanConversationQuoteStrip950.test.tsx does.
 */
import React from 'react';
import { Linking, StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';
import { NavigationContext } from '@react-navigation/native';
import RomanConversationScreen from '../RomanConversationScreen';
import RomanMessageBubble, { ROMAN_READING } from '../../../components/roman/RomanMessageBubble';
import { ROMAN_INTERRUPTED_NOTE } from '../../../components/roman/romanVoice';
import { chatDateLabel, ROMAN_CHATS_COPY } from '../romanChatsCopy';
import { authEpoch } from '../../../services/accountBinding';
import { featureFlags } from '../../../config/featureFlags';
import { forestPop, lightTokens, radius, typography } from '../../../theme/tokens';
import type { RomanChatsApi, RomanTranscriptPage } from '../../../api/romanChatsApi';
import type { RomanMessage } from '../../../api/romanApi';

jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: jest.fn(async () => ({ data: { name: 'Sam Rivera' } })) } }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'user-a', email: '', role: 'student', coach_id: 'c1' }) }));
jest.mock('../../../utils/haptics', () => ({ lightTap: jest.fn(), mediumTap: jest.fn(), warningTap: jest.fn(), selectionTap: jest.fn() }));
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: { softImpact: jest.fn(async () => undefined), selection: jest.fn() } }));
jest.mock('../../../utils/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn(), log: jest.fn() } }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: jest.requireActual('../../../constants/colors').default,
    semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
  }),
}));
// The room's note loads Roman's italic with useFonts (RomanHeldCard.tsx), which awaits loadAsync.
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn(async () => undefined) }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn(), setSentryUser: jest.fn() }));

const QUOTE = 'Keep Thursday easy';
const REPLY = `> ${QUOTE}\n\nCan I do it indoors?`;
const STARTED = '2026-10-01T08:00:00.000Z';
const msg = (id: string, role: RomanMessage['role'], content: string, extra: Partial<RomanMessage> = {}): RomanMessage => ({
  id, role, content, interrupted: false, createdAt: STARTED, ...extra,
});
const flat = (s: unknown): ViewStyle & TextStyle => (StyleSheet.flatten(s as StyleProp<ViewStyle & TextStyle>) ?? {}) as ViewStyle & TextStyle;
const nav = { goBack: jest.fn(), navigate: jest.fn(), addListener: jest.fn(() => () => undefined) };

/** The real history screen, its transcript answered by a stub (oldest first on screen; the stub sends newest first). */
const readHistory = (oldestFirst: RomanMessage[]) => {
  const api = {
    list: jest.fn(),
    readMessages: jest.fn(async () => ({
      ok: true as const,
      value: { messages: [...oldestFirst].reverse(), nextCursor: null } as RomanTranscriptPage,
    })),
    deleteOne: jest.fn(),
    deleteAll: jest.fn(),
  };
  const params = {
    id: 'cx1', ownerId: 'user-a', binding: { subject: 'sub:user-a', epoch: authEpoch() },
    startedAt: STARTED, surface: 'client' as const, messageCount: oldestFirst.length,
  };
  return render(
    <NavigationContext.Provider value={nav as never}>
      <RomanConversationScreen
        navigation={nav as never}
        route={{ params }}
        api={api as unknown as RomanChatsApi}
        sessionUserId={() => 'user-a'}
      />
    </NavigationContext.Provider>,
  );
};

/** The turn's own element: the testID the history gives it, never the room's -reply, -bubble or -quote. */
const TURN = /^roman-transcript-message-[^-]+$/;
const hasAncestor = (n: TestInstance | null, test: (p: TestInstance) => boolean): boolean => {
  for (let p = n?.parent ?? null; p; p = p.parent) if (test(p)) return true;
  return false;
};

let openURL: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});
afterEach(() => openURL.mockRestore());

describe('ROMAN-HISTORY-LOOK-M: the history draws the room’s turns', () => {
  it('case a: a quoted client turn is the room’s bubble, with the quote card inside it', async () => {
    const screen = await readHistory([msg('m1', 'user', REPLY)]);
    const bubble = await screen.findByTestId('roman-transcript-message-m1-bubble');
    const b = flat(bubble.props.style);
    expect(b.backgroundColor).toBe(lightTokens.bgSurface);
    expect(b.borderColor).toBe(lightTokens.border);
    expect(b.borderWidth).toBe(StyleSheet.hairlineWidth);
    expect(b.borderRadius).toBe(radius.card);
    expect(b.maxWidth).toBe('82%');
    const strip = within(bubble).getByTestId('roman-transcript-message-m1-quote');
    expect(strip.props.accessibilityLabel).toBe(`Replying to: ${QUOTE}`);
    expect(within(bubble).getByText(QUOTE).props.numberOfLines).toBe(2);
    expect(within(bubble).getByLabelText('You said: Can I do it indoors?')).toBeTruthy();
    const s = flat(strip.props.style);
    expect(s.alignSelf).toBeUndefined();
    expect(s.maxWidth).toBeUndefined();
    // The card sits on the bubble: its fill is the room's (bgPrimary), not the bubble's own.
    expect(s.backgroundColor).toBe(lightTokens.bgPrimary);
  });

  it('case b: a Roman turn reads in the room’s serif under his face and the ROMAN overline', async () => {
    const content = 'Yes. Keep Thursday easy: a 30-minute ride at a pace you could talk through.';
    const screen = await readHistory([msg('m1', 'assistant', content)]);
    const said = await screen.findByLabelText(`Roman said: ${content}`);
    const words = within(said).getByText(content);
    const w = flat(words.props.style);
    expect(w.fontFamily).toBe(ROMAN_READING.fontFamily);
    expect(w.fontFamily).toMatch(/^Cormorant/);
    expect(w.fontSize).toBe(19);
    expect(w.lineHeight).toBe(28);
    const turn = screen.getByTestId('roman-transcript-message-m1');
    const face = within(turn).getByTestId('roman-bubble-avatar');
    expect(flat(face.props.style).width).toBe(22);
    const overline = within(turn).getByText('ROMAN');
    expect(flat(overline.props.style).fontFamily).toBe(typography.eyebrow.fontFamily);
  });

  it('case c: no "YOU" label anywhere, and no hairline between turns', async () => {
    const screen = await readHistory([
      msg('m1', 'user', 'Can I swap my Thursday run?'),
      msg('m2', 'assistant', 'Yes, keep it easy.'),
      msg('m3', 'user', REPLY),
    ]);
    const turns = (await screen.findAllByTestId(TURN)).filter((t) => typeof t.type === 'string');
    expect(turns.map((t) => t.props.testID)).toEqual([
      'roman-transcript-message-m1', 'roman-transcript-message-m2', 'roman-transcript-message-m3',
    ]);
    expect(screen.queryByText('YOU')).toBeNull();
    for (const t of turns) {
      const s = flat(t.props.style);
      expect(s.borderBottomWidth ?? 0).toBe(0);
      expect(s.borderWidth ?? 0).toBe(0);
    }
  });

  it('case d: an interrupted Roman turn shows the room’s note and gold rule, and says it', async () => {
    const content = 'Partial answer';
    const screen = await readHistory([msg('m1', 'assistant', content, { interrupted: true })]);
    const note = await screen.findByTestId('roman-transcript-message-m1-interrupted');
    expect(within(note).getByText(ROMAN_INTERRUPTED_NOTE)).toBeTruthy();
    expect(flat(screen.getByTestId('roman-transcript-message-m1-interrupted-rule').props.style).backgroundColor).toBe(forestPop.gold);
    expect(screen.getByLabelText(`Roman said: ${content} ${ROMAN_INTERRUPTED_NOTE}`)).toBeTruthy();
  });

  it('case e: the room’s header: Back, then the transcript title as the room’s h1 headline, never cut', async () => {
    const screen = await readHistory([msg('m1', 'user', 'Hello')]);
    await screen.findByTestId('roman-transcript-message-m1');
    const back = screen.getByLabelText(ROMAN_CHATS_COPY.back);
    expect(back.props.accessibilityRole).toBe('button');
    await fireEvent.press(back);
    expect(nav.goBack).toHaveBeenCalled();
    const title = screen.getByText(ROMAN_CHATS_COPY.transcriptTitle(chatDateLabel({ startedAt: STARTED })));
    expect(title.props.accessibilityRole).toBe('header');
    expect(title.props.numberOfLines).toBeUndefined();
    const t = flat(title.props.style);
    expect(t.fontFamily).toBe(typography.h1.fontFamily);
    expect(t.fontSize).toBe(typography.h1.fontSize);
    expect(t.lineHeight).toBe(typography.h1.lineHeight);
  });

  it('case f: the quote card sizes to its words: its text shrinks, never grows (history and room)', async () => {
    const screen = await readHistory([msg('m1', 'user', REPLY)]);
    const inHistory = flat((await screen.findByText(QUOTE)).props.style);
    const room = await render(<RomanMessageBubble message={msg('u', 'user', REPLY)} testID="u" />);
    const inRoom = flat(room.getByText(QUOTE).props.style);
    for (const s of [inHistory, inRoom]) {
      expect(s.flexShrink).toBe(1);
      expect(s.flex).toBeUndefined();
      expect(s.flexGrow).toBeUndefined();
    }
  });
});

describe('ROMAN-HISTORY-LOOK-M: what stays', () => {
  it.each([
    ['a plain turn', 'Can I do it indoors?', 'user'],
    ['a "> " line with no blank line after it', `> ${QUOTE}\nCan I do it indoors?`, 'user'],
    ['a "> " line with an empty body', `> ${QUOTE}\n\n   `, 'user'],
    ['a Roman turn that starts with a "> " line', REPLY, 'assistant'],
  ] as const)('case g: %s draws no quote card', async (_name, content, role) => {
    const screen = await readHistory([msg('m1', role, content)]);
    await screen.findAllByTestId(TURN);
    expect(screen.queryByTestId('roman-transcript-message-m1-quote')).toBeNull();
    expect(screen.queryByLabelText(/^Replying to: /)).toBeNull();
  });

  it('case h: crisisActions on, a marked reply keeps its actions (Call 9 1 1 opens tel:911); off, none', async () => {
    const marked = msg('m1', 'assistant', 'Fixed reply.', { safetyActions: ['call_911', 'call_988', 'text_988'] });
    const on = jest.replaceProperty(featureFlags, 'crisisActions', true);
    try {
      const screen = await readHistory([marked]);
      await fireEvent.press(await screen.findByRole('button', { name: 'Call 9 1 1' }));
      expect(openURL).toHaveBeenLastCalledWith('tel:911');
      expect(screen.getByRole('button', { name: 'Call 988' })).toBeTruthy();
      await screen.unmount();
    } finally {
      on.restore();
    }
    const off = jest.replaceProperty(featureFlags, 'crisisActions', false);
    try {
      const screen = await readHistory([marked]);
      await screen.findAllByTestId(TURN);
      expect(screen.queryByRole('button', { name: 'Call 9 1 1' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Call 988' })).toBeNull();
    } finally {
      off.restore();
    }
  });

  it('case i: read only: a long press on Roman’s turn opens nothing and no hold is offered', async () => {
    const content = 'Yes, keep it easy.';
    const screen = await readHistory([msg('m1', 'assistant', content)]);
    const said = await screen.findByLabelText(`Roman said: ${content}`);
    await fireEvent(said, 'longPress');
    expect(said.props.accessibilityHint).toBeUndefined();
    expect(said.props.accessibilityActions).toBeUndefined();
    for (const word of ['Reply', 'Copy', 'Report', 'Report message']) expect(screen.queryByText(word)).toBeNull();
  });

  it('case k: the room’s own turn is unchanged: its bubble, card fill, words and testIDs', async () => {
    const r = await render(<RomanMessageBubble message={msg('u', 'user', REPLY)} testID="u" />);
    const bubble = flat(r.getByTestId('u-bubble').props.style);
    expect(bubble.backgroundColor).toBe(lightTokens.bgSurface);
    expect(bubble.maxWidth).toBe('82%');
    expect(bubble.borderRadius).toBe(radius.card);
    expect(flat(r.getByTestId('u-quote').props.style).backgroundColor).toBe(lightTokens.bgPrimary);
    expect(r.getByTestId('u-quote').props.accessibilityLabel).toBe(`Replying to: ${QUOTE}`);
    expect(r.getByLabelText('You said: Can I do it indoors?')).toBeTruthy();
    const a = await render(<RomanMessageBubble message={msg('a', 'assistant', 'Yes.')} testID="r" />);
    expect(a.getByTestId('r-reply').props.accessibilityLabel).toBe('Roman said: Yes.');
    expect(a.getByTestId('roman-bubble-avatar')).toBeTruthy();
  });

  it('case l: every turn and the title stay out of analytics capture, under the screen’s root testID', async () => {
    const screen = await readHistory([msg('m1', 'user', REPLY), msg('m2', 'assistant', 'Yes.')]);
    const turns = (await screen.findAllByTestId(TURN)).filter((t) => typeof t.type === 'string');
    expect(turns).toHaveLength(2);
    const title = screen.getByText(ROMAN_CHATS_COPY.transcriptTitle(chatDateLabel({ startedAt: STARTED })));
    const root = screen.getByTestId('roman-chat-transcript-screen');
    expect(root.props['ph-no-capture']).toBe(true);
    for (const n of [...turns, title]) {
      expect(hasAncestor(n, (p) => p.props['ph-no-capture'] === true)).toBe(true);
      expect(hasAncestor(n, (p) => p.props.testID === 'roman-chat-transcript-screen')).toBe(true);
    }
  });
});
