/**
 * FIX-944R1 (m#944 fix round 1; LS-944R1 B1 = LO-944R1 C5): the 08a first-use card in every window the renders rule
 * names. Its two buttons are 130 pt each, as 08a draws them (FR-871R5), so on a small phone with larger text the card is
 * taller than the window: it must be capped at the window less its top inset, with its lines scrolling between the
 * title and the buttons. Beside the lens's B-TEST (LS944R1FirstUseFits.btest.test.tsx), with a real safe area:
 *   a. the B-TEST's two cells with a top inset: the member's card is too tall for 568 pt and must scroll under a cap of
 *      the window less the inset; the coach's two-line card fits;
 *   b. 320 x 568, 360 x 640, 375 x 667 and 390 x 844, at 100%, 130% and 200% text, with insets 20/0, 24/0 and 47/34,
 *      member and coach: the sheet's maxHeight is the window's height (useWindowDimensions) less the top inset, and a
 *      ScrollView holds the lines;
 *   c. 390 x 844 at 100% and 130%, where the card fits: every style it drew before this round, in the same order;
 *   d. what it does: Record, Not now, the hardware back, onDismiss, the header first, the modal view; the grab, the
 *      title and both buttons outside the scroll, which shows no indicator and does not bounce while the lines fit;
 *   e. what it does not: no report line for a coach, no new words, the same three testIDs.
 * Read from the drawn tree, not device pixels.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type { TestInstance } from 'test-renderer';
import { forestPop as fp, neutral, voiceShades } from '../../../../theme/tokens';
import { describeVoiceAudience } from '../../VoicePrivacyCopy';

jest.mock('../spaceChatApi', () => ({ spaceChatApi: { getVoiceConsent: jest.fn(), recordVoiceConsent: jest.fn() } }));

import SpaceVoiceFirstUse from '../SpaceVoiceFirstUse';

type Box = Record<string, unknown>;
type Insets = { top: number; bottom: number };
const SPACE = 'Morning crew';
const AUDIENCE = describeVoiceAudience({ kind: 'cohort', cohortName: SPACE });
const REPORT = 'If someone reports a voice note, your coach and the TGP Fitness team can listen to it.';
const DELETE = 'You can delete your voice note at any time.';
const linesFor = (coach: boolean) => (coach ? [AUDIENCE, DELETE] : [AUDIENCE, REPORT, DELETE]);
const IDS = ['space-chat-voice-first-use', 'space-chat-voice-first-use-record', 'space-chat-voice-first-use-not-now'];

// The card's styles at b9b90580 (SpaceVoiceFirstUse.tsx:88-104), copied: where it fits it must draw exactly these.
const BEFORE = {
  sheet: { backgroundColor: neutral[0], borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8, paddingHorizontal: 20 },
  grab: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: voiceShades.track, marginBottom: 10 },
  title: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 22, lineHeight: 29, color: fp.ink, marginTop: 8, marginBottom: 6 },
  points: { gap: 12, marginTop: 10, marginBottom: 6 },
  point: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  wash: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: voiceShades.leafWash, borderWidth: 1, borderColor: voiceShades.washEdge },
  text: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, color: fp.ink },
  buttons: { gap: 10, marginTop: 14, marginBottom: 10 },
  record: { minHeight: 130, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 20, flexDirection: 'row', gap: 8,
    alignItems: 'center', justifyContent: 'center', backgroundColor: fp.forest },
  quiet: { minHeight: 130, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 12 },
  label: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 16, lineHeight: 20 },
};

const flat = (n: TestInstance): Box => (StyleSheet.flatten(n.props.style) ?? {}) as Box;
const up = (n: TestInstance) => n.parent as TestInstance;
const isScroll = (n: TestInstance) => /ScrollView/i.test(n.type);
const hosts = (root: TestInstance): TestInstance[] =>
  root.children.flatMap((c) => (typeof c === 'string' ? [] : [c, ...hosts(c)]));
const between = (n: TestInstance, top: TestInstance | null): TestInstance[] => {
  const out: TestInstance[] = [];
  for (let p = n.parent; p && p !== top; p = p.parent) out.push(p);
  return out;
};
const scrollOf = (n: TestInstance, top: TestInstance) => between(n, top).find(isScroll);
const textOf = (n: TestInstance) => n.children.filter((c): c is string => typeof c === 'string').join('');
// The words the card draws, in order (an icon's glyph is not a word: Ionicons draws with its own font family).
const words = (root: TestInstance) =>
  hosts(root).filter((n) => n.type === 'Text' && !/ionicons/i.test(String(flat(n).fontFamily ?? ''))).map(textOf);

let dims: jest.SpyInstance | undefined;
afterEach(() => { dims?.mockRestore(); dims = undefined; });

async function draw(o: { coach?: boolean; w?: number; h?: number; fs?: number; insets?: Insets;
  onRecord?: () => void; onClose?: () => void; onDismiss?: () => void } = {}) {
  dims = jest.spyOn(require('react-native'), 'useWindowDimensions')
    .mockReturnValue({ width: o.w ?? 390, height: o.h ?? 844, scale: 2, fontScale: o.fs ?? 1 });
  const inset = o.insets ?? { top: 47, bottom: 34 };
  await render(
    <SafeAreaInsetsContext.Provider value={{ top: inset.top, bottom: inset.bottom, left: 0, right: 0 }}>
      <SpaceVoiceFirstUse visible cohortName={SPACE} coach={o.coach ?? false} onRecord={o.onRecord ?? jest.fn()}
        onClose={o.onClose ?? jest.fn()} onDismiss={o.onDismiss} />
    </SafeAreaInsetsContext.Provider>,
  );
  const sheet = screen.getByTestId('space-chat-voice-first-use');
  const lines = linesFor(o.coach ?? false).map((t) => screen.getByText(t));
  return {
    sheet,
    box: flat(sheet),
    lines,
    title: screen.getByText('Voice notes'),
    record: screen.getByTestId('space-chat-voice-first-use-record'),
    notNow: screen.getByTestId('space-chat-voice-first-use-not-now'),
    modal: between(sheet, null).find((n) => n.type === 'Modal') as TestInstance,
  };
}

describe('FIX-944R1 a: the B-TEST cells with a top inset (320 x 568, 130% text, insets 20/0)', () => {
  const H = 568;
  const FS = 1.3;
  const fewestLines = (letters: number, fontSize: number, width: number) => Math.max(1, Math.ceil((letters * 0.45 * fontSize * FS) / width));
  const n0 = (v: unknown) => (typeof v === 'number' ? v : 0);
  it.each([false, true])('coach %s: the card fits 568 pt, or scrolls under a cap of the window less the inset', async (coach) => {
    const c = await draw({ coach, w: 320, h: H, fs: FS, insets: { top: 20, bottom: 0 } });
    const grab = flat(c.sheet.children[0] as TestInstance);
    const title = flat(c.title);
    const points = flat(up(up(c.lines[0])));
    const buttons = flat(up(c.record));
    const rows = c.lines.map((line) => {
      const row = up(line);
      const wash = flat(row.children[0] as TestInstance);
      const width = 320 - 2 * n0(c.box.paddingHorizontal) - n0(wash.width) - n0(flat(row).gap);
      return Math.max(n0(wash.height), fewestLines(textOf(line).length, n0(flat(line).fontSize), width) * n0(flat(line).lineHeight) * FS);
    });
    const least =
      n0(c.box.paddingTop) + n0(c.box.paddingBottom) + n0(grab.height) + n0(grab.marginBottom) +
      n0(title.lineHeight) * FS + n0(title.marginTop) + n0(title.marginBottom) +
      n0(points.marginTop) + n0(points.marginBottom) + n0(points.gap) * (rows.length - 1) + rows.reduce((a, b) => a + b, 0) +
      n0(buttons.marginTop) + n0(buttons.marginBottom) + n0(buttons.gap) + n0(flat(c.record).minHeight) + n0(flat(c.notNow).minHeight);
    const scrolls = c.lines.every((l) => scrollOf(l, c.sheet)) && typeof c.box.maxHeight === 'number' && c.box.maxHeight <= H - 20;
    expect({ fitsOrScrolls: scrolls || least <= H, leastHeight: Math.round(least) })
      .toEqual({ fitsOrScrolls: true, leastHeight: Math.round(least) });
  });
});

const WINDOWS: [number, number][] = [[320, 568], [360, 640], [375, 667], [390, 844]];
const SCALES = [1, 1.3, 2];
const INSETS: Insets[] = [{ top: 20, bottom: 0 }, { top: 24, bottom: 0 }, { top: 47, bottom: 34 }];
const CELLS = [false, true].flatMap((coach) => WINDOWS.flatMap(([w, h]) => SCALES.flatMap((fs) => INSETS.map((inset) =>
  ({ who: coach ? 'coach' : 'member', coach, w, h, fs, inset })))));

describe('FIX-944R1 b: capped at the window less the top inset, the lines scrolling, in every window', () => {
  it.each(CELLS)('$who, $w x $h at $fs x text, insets $inset.top/$inset.bottom', async ({ coach, w, h, fs, inset }) => {
    const c = await draw({ coach, w, h, fs, insets: inset });
    expect({ maxHeight: c.box.maxHeight, linesScroll: c.lines.map((l) => Boolean(scrollOf(l, c.sheet))) })
      .toEqual({ maxHeight: h - inset.top, linesScroll: c.lines.map(() => true) });
  });
});

describe('FIX-944R1 c: where it fits (390 x 844), the card draws as before this round', () => {
  it.each([1, 1.3])('at %s x text: the same styles and the same order', async (fs) => {
    const c = await draw({ w: 390, h: 844, fs, insets: { top: 47, bottom: 34 } });
    const { maxHeight: _cap, paddingBottom, ...sheet } = c.box;
    const row = up(c.lines[0]);
    const { opacity: _r, ...record } = flat(c.record);
    const { opacity: _q, ...quiet } = flat(c.notNow);
    expect({
      sheet, paddingBottom,
      grab: flat(c.sheet.children[0] as TestInstance),
      title: flat(c.title),
      points: flat(up(row)),
      point: flat(row),
      wash: flat(row.children[0] as TestInstance),
      text: c.lines.map(flat),
      buttons: flat(up(c.record)),
      record, quiet,
      labels: [flat(screen.getByText('Record')), flat(screen.getByText('Not now'))],
      words: words(c.sheet),
    }).toEqual({
      sheet: BEFORE.sheet, paddingBottom: 34,
      grab: BEFORE.grab,
      title: BEFORE.title,
      points: BEFORE.points,
      point: BEFORE.point,
      wash: BEFORE.wash,
      text: c.lines.map(() => BEFORE.text),
      buttons: BEFORE.buttons,
      record: BEFORE.record, quiet: BEFORE.quiet,
      labels: [{ ...BEFORE.label, color: fp.onDeep }, { ...BEFORE.label, color: fp.forest }],
      words: ['Voice notes', ...linesFor(false), 'Record', 'Not now'],
    });
  });
});

describe('FIX-944R1 d: what the card does is kept', () => {
  it('Record calls onRecord once and Not now calls onClose once; the hardware back is onClose; onDismiss passes through', async () => {
    const onRecord = jest.fn();
    const onClose = jest.fn();
    const onDismiss = jest.fn();
    const c = await draw({ onRecord, onClose, onDismiss });
    expect({ back: c.modal.props.onRequestClose === onClose, dismiss: c.modal.props.onDismiss === onDismiss, transparent: c.modal.props.transparent })
      .toEqual({ back: true, dismiss: true, transparent: true });
    await fireEvent.press(c.record);
    expect([onRecord.mock.calls.length, onClose.mock.calls.length]).toEqual([1, 0]);
    await fireEvent.press(c.notNow);
    expect([onRecord.mock.calls.length, onClose.mock.calls.length]).toEqual([1, 1]);
  });

  it.each([false, true])('coach %s: the title is the header and the first thing a screen reader reaches; the sheet is the modal view', async (coach) => {
    const c = await draw({ coach, w: 320, h: 568, fs: 1.3, insets: { top: 20, bottom: 0 } });
    const order = hosts(c.sheet);
    const firstSpoken = order.find((n) => n.type === 'Text' || n.props.accessible === true || n.props.accessibilityRole != null);
    expect({ first: firstSpoken && textOf(firstSpoken), role: c.title.props.accessibilityRole, modal: c.sheet.props.accessibilityViewIsModal })
      .toEqual({ first: 'Voice notes', role: 'header', modal: true });
  });

  it.each([false, true])('coach %s: the grab, the title and both buttons stay outside the scroll, which has no indicator and no bounce while the lines fit', async (coach) => {
    const c = await draw({ coach, w: 320, h: 568, fs: 1.3, insets: { top: 20, bottom: 0 } });
    const scroll = scrollOf(c.lines[0], c.sheet);
    // Booleans, not tree nodes: a failure must print, and a node in a failed toEqual crashes jest's worker (M4).
    const insideScroll = [c.sheet.children[0] as TestInstance, c.title, c.record, c.notNow].map((n) => Boolean(scrollOf(n, c.sheet)));
    expect({
      scroll: Boolean(scroll),
      sameScroll: c.lines.every((l) => scrollOf(l, c.sheet) === scroll),
      insideScroll,
      indicator: scroll?.props.showsVerticalScrollIndicator,
      bounceWhileFits: scroll?.props.alwaysBounceVertical,
      grows: scroll ? flat(scroll).flexGrow : undefined,
    }).toEqual({ scroll: true, sameScroll: true, insideScroll: [false, false, false, false], indicator: false, bounceWhileFits: false, grows: 0 });
  });
});

describe('FIX-944R1 e: what the card does not do', () => {
  it.each([false, true])('coach %s: only its own words (a coach has no report line) and its three testIDs', async (coach) => {
    const c = await draw({ coach, w: 320, h: 568, fs: 1.3, insets: { top: 20, bottom: 0 } });
    const ids = hosts(c.modal).map((n) => n.props.testID).filter((id): id is string => typeof id === 'string');
    expect({ words: words(c.modal), report: screen.queryByText(REPORT) !== null, ids: [...new Set(ids)].sort() })
      .toEqual({ words: ['Voice notes', ...linesFor(coach), 'Record', 'Not now'], report: !coach, ids: [...IDS].sort() });
  });
});
