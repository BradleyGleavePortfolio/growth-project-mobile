/**
 * TEXT-PENDING-M (agent 203; owner 7 A, 13:5x PDT 10-26: "7.) a"): in a space chat, the viewer's own text waiting on
 * the phone while offline shows the voice note's two marks, the small spinning circle and the struck-through wifi, in
 * the row's head where the clock and the words "Waiting to send" were; a screen reader still hears "Waiting to send",
 * once, in the head's one label. No other row changes (a waiting voice note keeps its card's marks and its empty head).
 * The two copies of the marks (SpaceVoiceNote.tsx's card, SpaceChatRow.tsx's head) are held equal here (P1).
 * The real row and, for voice rows, the real card and player; the marks and the clock are found by their glyphs.
 */
import React from 'react';
import { Alert, PixelRatio, StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

jest.mock('../../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('../../../HapticPressable', () => {
  const ReactActual = jest.requireActual('react');
  return {
    __esModule: true,
    default: ({ children, ...props }: { children?: unknown }) => ReactActual.createElement('HapticPressableHost', props, children),
  };
});
jest.mock('../../../../api/communityVoiceApi', () => ({ communityVoiceApi: { getOne: jest.fn() } }));
jest.mock('../spaceChatApi', () => ({ spaceChatApi: { markHeard: jest.fn() } }));

import SpaceChatRow, { SMALL_GREY, spaceTime, type SpaceChatRowProps } from '../SpaceChatRow';
import { communityVoiceApi } from '../../../../api/communityVoiceApi';
import { forestPop as fp } from '../../../../theme/tokens';

type El = { type: string; props: Record<string, any>; parent: El | null; children: (El | string)[] };
type R = Awaited<ReturnType<typeof render>>;
// RNTL 14 leaves hidden elements out of every query; the marks are hidden from screen readers (the label says them).
const H = { includeHiddenElements: true } as const;
const flat = (style: unknown) => (StyleSheet.flatten(style as object) ?? {}) as Record<string, unknown>;
const all = (el: El): El[] => [el, ...el.children.flatMap((c) => (typeof c === 'string' ? [] : all(c)))];
const GLYPHS = (Ionicons as unknown as { glyphMap: Record<string, number> }).glyphMap;
/** Ionicons draws a Text holding its glyph: find an icon by name under an element. */
const icons = (el: El, name: string) => all(el).filter((n) => n.type === 'Text' && n.children.includes(String.fromCodePoint(GLYPHS[name])));
const unfaded = (node: El) => {
  for (let n: El | null = node; n; n = n.parent) expect(flat(n.props.style).opacity ?? 1).toBe(1);
};

const AT = '2026-10-26T10:00:00.000Z';
const VOICE = { id: 'v-1', duration_ms: 8000, waveform_peaks: [0.4, 0.6] };
const MINE = { name: 'Mia', isCoach: false, createdAt: AT, authorId: 'u-1', viewerUserId: 'u-1', onRetry: jest.fn(), onDiscard: jest.fn() };
const TEXT: SpaceChatRowProps = { ...MINE, id: 'l-1', body: 'Hi', state: 'waiting', offline: true };
const LONG = 'Maximiliana Featherstonehaugh-Okonkwo';
const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrap = (client: QueryClient, el: React.ReactElement) => <QueryClientProvider client={client}>{el}</QueryClientProvider>;
const mount = (p: SpaceChatRowProps) => render(wrap(qc(), <SpaceChatRow {...p} />));
/** The head's `who` view: the one element that speaks the head (name, Coach, state or time, then what was said). */
const whoOf = (r: R, name: string) => (r.getByText(name, H) as unknown as El).parent as El;
const row = (r: R, id: string) => r.getByTestId(`space-chat-row-${id}`, H) as unknown as El;

/** Every mark a row's head can draw, read off the elements (no layout in a test). */
function headMarks(who: El) {
  return {
    circles: all(who).filter((n) => n.type === 'ActivityIndicator').length,
    wifi: icons(who, 'wifi-outline').length,
    clocks: icons(who, 'time-outline').length,
  };
}

/** The text row's waiting marks, as the card draws its own (SpaceVoiceNote.tsx s.played, s.wifiOff, s.strike). */
function textMarks(r: R, id: string) {
  const group = r.getByTestId(`space-chat-waiting-${id}`, H) as unknown as El;
  const circle = r.getByTestId(`space-chat-waiting-circle-${id}`, H) as unknown as El;
  const box = r.getByTestId(`space-chat-waiting-wifi-off-${id}`, H) as unknown as El;
  return { group, circle, box, ...parts(group, circle, box) };
}
function cardMarks(r: R, id: string) {
  const group = r.getByTestId(`space-chat-voice-waiting-${id}`, H) as unknown as El;
  const circle = r.getByTestId(`space-chat-voice-circle-${id}`, H) as unknown as El;
  const box = r.getByTestId(`space-chat-voice-wifi-off-${id}`, H) as unknown as El;
  return { group, circle, box, ...parts(group, circle, box) };
}
type Shape = ReturnType<typeof parts>['shape'];
/** The same shape with its ink taken out (P2: only the ink differs between the coach's card and the coach's text). */
const noInk = (s: Shape) => ({
  ...s, circle: { ...s.circle, color: null }, glyph: s.glyph && { ...s.glyph, style: { ...s.glyph.style, color: null } },
  strike: s.strike && { ...s.strike, backgroundColor: null },
});
function parts(group: El, circle: El, box: El) {
  const [glyph] = icons(box, 'wifi-outline');
  const strike = box.children.find((c): c is El => typeof c !== 'string' && c.type === 'View');
  return {
    shape: {
      group: flat(group.props.style),
      order: group.children.map((c) => (typeof c === 'string' ? c : c === circle ? 'circle' : c === box ? 'box' : c.type)),
      circle: { type: circle.type, size: circle.props.size, color: circle.props.color },
      box: flat(box.props.style),
      glyph: glyph ? { style: flat(glyph.props.style), allowFontScaling: glyph.props.allowFontScaling, glyph: glyph.children } : null,
      strike: strike ? flat(strike.props.style) : null,
    },
    glyph,
    strike,
  };
}

beforeEach(() => jest.clearAllMocks());
// RNTL 14: render, rerender, fireEvent and unmount are async and always awaited.

describe('W: the viewer\'s own text waiting offline draws the voice card\'s two marks in its head (owner 7 A)', () => {
  it.each([
    ['W1 a member\'s text', TEXT, ['Mia'], 'Mia, Waiting to send. Hi'],
    ['W2 the coach\'s own text', { ...TEXT, name: 'Rae Lin', isCoach: true }, ['Rae Lin', 'Coach'], 'Rae Lin, Coach, Waiting to send. Hi'],
    ['W3 a reply (its quote above the text)', { ...TEXT, quote: { gone: false, name: 'Jo', text: 'Leg day done' } }, ['Mia'], 'Replying to Jo: Leg day done. Mia, Waiting to send. Hi'],
    ['W4 under a long name', { ...TEXT, name: LONG }, [LONG], `${LONG}, Waiting to send. Hi`],
  ] as const)('%s: the circle and the struck wifi where the clock and the words were; spoken once, as before', async (_c, props, head, label) => {
    const r = await mount(props as SpaceChatRowProps);
    const who = whoOf(r, head[0]);
    const m = textMarks(r, 'l-1');
    // In the head, after the name (and the Coach mark), in the place of the clock and the words; nothing else there.
    expect(m.group.parent).toBe(who);
    expect(who.children.map((c) => (typeof c === 'string' ? c : c === m.group ? 'marks' : c.children.join('')))).toEqual([...head, 'marks']);
    // The card's marks to the point: a small circle and a 20 x 20 box (wifi-outline at 18, a 22 x 2 bar at -45deg), all SMALL_GREY.
    expect(m.shape.circle).toEqual({ type: 'ActivityIndicator', size: 'small', color: SMALL_GREY });
    expect(m.shape.order).toEqual(['circle', 'box']);
    expect(m.shape.group).toMatchObject({ flexDirection: 'row', alignItems: 'center', gap: 4 });
    expect(Object.keys(m.shape.group).filter((k) => /^(margin|padding)/.test(k))).toEqual([]);
    expect(m.shape.box).toEqual({ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' });
    expect(m.shape.glyph?.style).toMatchObject({ fontSize: 18, color: SMALL_GREY });
    expect(m.shape.strike).toEqual({ position: 'absolute', width: 22, height: 2, borderRadius: 1, transform: [{ rotate: '-45deg' }], backgroundColor: SMALL_GREY });
    // No clock and no visible words anywhere in the row.
    expect(icons(row(r, 'l-1'), 'time-outline')).toHaveLength(0);
    expect(r.queryByText('Waiting to send', H)).toBeNull();
    expect(headMarks(who)).toEqual({ circles: 1, wifi: 1, clocks: 0 });
    // Spoken: the head's one label, the base's character for character; the marks are hidden and say nothing.
    expect(who.props.accessible).toBe(true);
    expect(who.props.accessibilityLabel).toBe(label);
    expect(m.group.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(m.group.props.accessibilityElementsHidden).toBe(true);
    for (const n of all(m.group)) {
      expect(n.props.accessible).toBeFalsy();
      expect(n.props.accessibilityLabel).toBeUndefined();
    }
    const speaking = all(row(r, 'l-1')).filter((n) => /Waiting to send/.test(String(n.props.accessibilityLabel ?? '')));
    expect(speaking).toHaveLength(1);
    expect(speaking[0]).toBe(who);
    // Nothing fades (FR-871 Sol B4); the ••• stays; the text is drawn under the head as before.
    for (const n of [m.circle, m.glyph as El, m.strike as El]) unfaded(n);
    expect(r.getByTestId('space-chat-local-menu-l-1').props.accessibilityLabel).toBe('Delete this message');
    expect(r.getByText('Hi', H)).toBeTruthy();
    await r.unmount();
  });

});

describe('U: every other row is drawn as before (no circle, no struck wifi and no clock in its head)', () => {
  const t = spaceTime(AT);
  const SERVER = { id: 'm-1', name: 'Ana', isCoach: false, createdAt: AT, authorId: 'u-ana', viewerUserId: 'u-1', offline: true };
  it.each([
    ['U1 own text waiting, online (next to go)', { ...TEXT, offline: false }, 'Mia', 'Mia, Sending…. Hi', 'Sending…'],
    ['U2 own text on its way', { ...TEXT, state: 'sending' }, 'Mia', 'Mia, Sending…. Hi', 'Sending…'],
    ['U3 own text not sent', { ...TEXT, state: 'failed' }, 'Mia', 'Mia, Not sent. Hi', 'Not sent'],
    ['U3 own text refused for its words', { ...TEXT, state: 'failed', rejected: true }, 'Mia', 'Mia, Not sent. Hi', 'Not sent'],
    ['U4 own text the server took, the list not caught up', { ...TEXT, state: 'sent' }, 'Mia', `Mia, ${t}. Hi`, t],
    ['U7 a server text row, offline', { ...SERVER, body: 'Hello' }, 'Ana', `Ana, ${t}. Hello`, t],
    ['U7 a server photo row, offline', { ...SERVER, body: 'Done', image: { url: 'https://signed.example/p.jpg', width: 800, height: 600 } }, 'Ana', `Ana, ${t}. Photo. Done`, t],
    ['U8 a removed row', { ...SERVER, body: 'Hello', removed: { who: 'other', text: 'Message removed' } }, 'Ana', `Ana, ${t}. Message removed`, t],
  ] as const)('%s', async (_c, props0, name, label, word) => {
    const props = props0 as SpaceChatRowProps;
    const r = await mount(props);
    const who = whoOf(r, name);
    expect(headMarks(who)).toEqual({ circles: 0, wifi: 0, clocks: 0 });
    expect(r.queryByTestId(`space-chat-waiting-circle-${props.id}`, H)).toBeNull();
    expect(r.queryByTestId(`space-chat-waiting-wifi-off-${props.id}`, H)).toBeNull();
    expect(icons(row(r, props.id), 'time-outline')).toHaveLength(0);
    expect(who.props.accessibilityLabel).toBe(label);
    expect(r.getByText(word, H).parent).toBe(who);
    if (props.id === 'l-1' && (props.state === 'sending' || props.state === 'sent' || !props.offline)) {
      expect(r.getByTestId('space-chat-local-busy-l-1')).toBeTruthy();
      expect(r.queryByTestId('space-chat-local-menu-l-1')).toBeNull();
    }
    if (props.state === 'failed') {
      if (props.rejected) expect(r.queryByTestId('space-chat-retry-l-1')).toBeNull();
      else expect(r.getByTestId('space-chat-retry-l-1')).toBeTruthy();
      expect(r.getByTestId('space-chat-discard-l-1')).toBeTruthy();
      expect(r.getByTestId('space-chat-local-menu-l-1').props.accessibilityLabel).toBe('Delete this message');
    }
    await r.unmount();
  });
});

// The voice rows load their player at once (VoiceNotePlayer, FX-848): they run last, each unmounted.
describe('U and P: voice rows keep their card\'s marks, and the two copies of the marks stay equal', () => {
  const VO: SpaceChatRowProps = { ...MINE, id: 'v-1', body: null, voice: VOICE, localUri: 'file:///v-1.m4a', state: 'waiting', offline: true };

  it('U5 own voice note waiting offline: its head stays empty (one space-chat-waiting-<id>, a Text with no words); the card has the marks', async () => {
    const r = await mount(VO);
    const who = whoOf(r, 'Mia');
    const head = r.getAllByTestId('space-chat-waiting-v-1', H) as unknown as El[];
    expect(head).toHaveLength(1);
    expect(head[0].type).toBe('Text');
    expect(head[0].props.children).toBe('');
    expect(headMarks(who)).toEqual({ circles: 0, wifi: 0, clocks: 0 });
    expect(r.queryByTestId('space-chat-waiting-circle-v-1', H)).toBeNull();
    expect(r.getByTestId('space-chat-voice-circle-v-1', H)).toBeTruthy();
    expect(r.getByTestId('space-chat-voice-wifi-off-v-1', H)).toBeTruthy();
    expect(all(row(r, 'v-1')).filter((n) => n.type === 'ActivityIndicator')).toHaveLength(1);
    expect(who.props.accessibilityLabel).toBe('Mia, ');
    await r.unmount();
  });

  it.each([
    ['U6 own voice note sending', { ...VO, state: 'sending', offline: false }, 'Mia, Sending…', 'Sending…'],
    ['U6 own voice note not sent', { ...VO, state: 'failed', offline: false }, 'Mia, Not sent', 'Not sent'],
  ] as const)('%s: the head says its word as before; no marks there', async (_c, props, label, word) => {
    const r = await mount(props as SpaceChatRowProps);
    const who = whoOf(r, 'Mia');
    expect(headMarks(who)).toEqual({ circles: 0, wifi: 0, clocks: 0 });
    expect(r.queryByTestId('space-chat-waiting-circle-v-1', H)).toBeNull();
    expect(who.props.accessibilityLabel).toBe(label);
    expect(r.getByText(word, H).parent).toBe(who);
    await r.unmount();
  });

  it('U7 a server voice row, offline: its time, no marks in its head', async () => {
    (communityVoiceApi.getOne as jest.Mock).mockResolvedValue({ ...VOICE, url: 'https://signed.example/v-1.m4a', heard_at: null });
    const r = await mount({ id: 'm-2', name: 'Ana', isCoach: false, createdAt: AT, body: null, voice: VOICE, authorId: 'u-ana', viewerUserId: 'u-1', offline: true });
    const who = whoOf(r, 'Ana');
    expect(headMarks(who)).toEqual({ circles: 0, wifi: 0, clocks: 0 });
    expect(who.props.accessibilityLabel).toBe(`Ana, ${spaceTime(AT)}`);
    await r.unmount();
  });

  it('P1 parity: the text row\'s marks equal the member voice card\'s, prop for prop and style for style', async () => {
    const client = qc();
    const r = await render(wrap(client, <><SpaceChatRow {...TEXT} /><SpaceChatRow {...VO} /></>));
    const text = textMarks(r, 'l-1');
    const card = cardMarks(r, 'v-1');
    expect(card.shape.circle.color).toBe(SMALL_GREY);
    expect(text.shape).toEqual(card.shape);
    await r.unmount();
  });

  it('P2: the coach\'s own voice card draws its marks on-deep, while the coach\'s own text row keeps SMALL_GREY (it sits on the page)', async () => {
    const coach = { name: 'Rae Lin', isCoach: true };
    const r = await render(wrap(qc(), <><SpaceChatRow {...TEXT} {...coach} /><SpaceChatRow {...VO} {...coach} /></>));
    const text = textMarks(r, 'l-1');
    const card = cardMarks(r, 'v-1');
    expect([card.shape.circle.color, card.shape.glyph?.style.color, card.shape.strike?.backgroundColor]).toEqual([fp.onDeep, fp.onDeep, fp.onDeep]);
    expect([text.shape.circle.color, text.shape.glyph?.style.color, text.shape.strike?.backgroundColor]).toEqual([SMALL_GREY, SMALL_GREY, SMALL_GREY]);
    expect(noInk(text.shape)).toEqual(noInk(card.shape));
    await r.unmount();
  });

  it('P3: at 130% text the marks keep their sizes (the glyph does not scale with text; the circle and the box are fixed)', async () => {
    const r100 = await mount(TEXT);
    const at100 = textMarks(r100, 'l-1').shape;
    await r100.unmount();
    expect(at100.glyph?.allowFontScaling).toBe(false);
    expect((Ionicons as unknown as { defaultProps: { allowFontScaling: boolean } }).defaultProps.allowFontScaling).toBe(false);
    expect([at100.circle.size, at100.glyph?.style.fontSize, at100.box.width, at100.box.height]).toEqual(['small', 18, 20, 20]);
    const scale = jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1.3);
    const r130 = await mount(TEXT);
    expect(textMarks(r130, 'l-1').shape).toEqual(at100);
    await r130.unmount();
    scale.mockRestore();
  });
});

describe('M: the moves of one row (each render shows one look, never both or neither)', () => {
  it('M1 waiting offline -> the signal returns (Sending…) -> the server took it (the time) -> waiting offline again (the marks back)', async () => {
    const client = qc();
    const t = spaceTime(AT);
    const look = (r: R) => {
      const who = whoOf(r, 'Mia');
      const marks = !!r.queryByTestId('space-chat-waiting-circle-l-1', H) && !!r.queryByTestId('space-chat-waiting-wifi-off-l-1', H);
      const words = who.children.filter((c): c is El => typeof c !== 'string' && c.type === 'Text' && c.children.join('') !== 'Mia').map((c) => c.children.join(''));
      return { marks, words, clocks: headMarks(who).clocks, label: who.props.accessibilityLabel };
    };
    const steps: SpaceChatRowProps[] = [TEXT, { ...TEXT, offline: false }, { ...TEXT, state: 'sent', offline: false }, TEXT];
    const seen: ReturnType<typeof look>[] = [];
    const r = await render(wrap(client, <SpaceChatRow {...steps[0]} />));
    seen.push(look(r));
    for (const p of steps.slice(1)) {
      await r.rerender(wrap(client, <SpaceChatRow {...p} />));
      seen.push(look(r));
    }
    expect(seen).toEqual([
      { marks: true, words: [], clocks: 0, label: 'Mia, Waiting to send. Hi' },
      { marks: false, words: ['Sending…'], clocks: 0, label: 'Mia, Sending…. Hi' },
      { marks: false, words: [t], clocks: 0, label: `Mia, ${t}. Hi` },
      { marks: true, words: [], clocks: 0, label: 'Mia, Waiting to send. Hi' },
    ]);
    await r.unmount();
  });

  it('M2 Delete on W1: the ••• asks first, then the row leaves the phone (as today)', async () => {
    const onDiscard = jest.fn();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const r = await mount({ ...TEXT, onDiscard });
    const before = { marks: !!r.queryByTestId('space-chat-waiting-circle-l-1', H), menu: r.getByTestId('space-chat-local-menu-l-1').props.accessibilityLabel };
    await fireEvent.press(r.getByTestId('space-chat-local-menu-l-1'));
    const asked = { title: alert.mock.calls[0]?.[0], discarded: onDiscard.mock.calls.length };
    (alert.mock.calls[0][2] as { text: string; onPress?: () => void }[]).find((b) => b.text === 'Delete')?.onPress?.();
    expect([before, asked, onDiscard.mock.calls.length]).toEqual([
      { marks: true, menu: 'Delete this message' }, { title: 'Delete this message?', discarded: 0 }, 1,
    ]);
    alert.mockRestore();
    await r.unmount();
  });
});
