/**
 * CONSULT-PARITY-133: the consultation questions (prototype 03-36) against
 * the approved flow prototype. Roman's serif italic voice, serif wheels with
 * the band behind the selected value, quiet unit tabs, the large S1 / N3
 * grid, the B3 unit default from the phone's region, the P8 headline, and
 * the coachless copy (owner 15:29: no line promises a coach to a client
 * without one). Rendered at 360x800 and 390x844 through the test renderer.
 */
import React from 'react';
import { StyleProp, StyleSheet, TextStyle } from 'react-native';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import QuestionScreen, { goalWeightNote } from '../QuestionScreen';
import { ROMAN_VOICE_FONT, wheelOpacity } from '../components';
import { COACHLESS_COPY, SCREENS, screenById } from '../../../lib/consultation/definitions';
import { defaultMeasureUnit, fillCopy, type CopyContext } from '../../../lib/consultation/engine';
import { P8_COPY, REVEAL_COPY } from '../../../lib/consultation/copy';
import type { Answers, ScreenDef } from '../../../lib/consultation/types';

jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('@expo-google-fonts/cormorant-garamond', () => ({
  CormorantGaramond_400Regular_Italic: 1,
  useFonts: () => [true, null],
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ regionCode: 'GB' }] }));

const NOW = new Date(2026, 9, 8, 14, 0, 0);
const SIZES = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
] as const;

function renderScreen(id: string, answers: Answers = {}, ctx: CopyContext = { firstName: 'Maya', now: NOW }, size: { width: number; height: number } = SIZES[0]) {
  const screen = screenById(id) as ScreenDef;
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, ...size }, insets: { top: 24, left: 0, right: 0, bottom: 16 } }}>
      <QuestionScreen
        screen={screen}
        answers={answers}
        progress={null}
        ctx={ctx}
        now={NOW}
        onAnswer={jest.fn()}
        onNext={jest.fn()}
        onBack={jest.fn()}
        onFinishLater={jest.fn()}
      />
    </SafeAreaProvider>,
  );
}

/** Lines produced by helpers rather than the screen data (the sweep covers them too). */
const HELPER_LINES = [goalWeightNote(100, 172, 'fat_loss'), goalWeightNote(200, 172, 'fat_loss')].filter(Boolean);
const flat = (style: StyleProp<TextStyle>): TextStyle => StyleSheet.flatten(style) ?? {};

/** Every template string a screen shows. */
function screenStrings(screen: ScreenDef): string[] {
  return [screen.roman, screen.question, screen.sub, screen.why, screen.detail?.textLabel, screen.detail?.chipsLabel].filter(
    (t): t is string => typeof t === 'string',
  );
}

describe.each(SIZES)('consultation questions at %o', (size) => {
  it('Roman speaks in the serif italic voice, never clipped (03, 04, 06)', async () => {
    const r = await renderScreen('G1', {}, { firstName: 'Maya', now: NOW }, size);
    const style = flat(r.getByTestId('roman-line-text').props.style);
    expect(style.fontFamily).toBe(ROMAN_VOICE_FONT);
    expect(style.lineHeight as number).toBeGreaterThanOrEqual(1.2 * (style.fontSize as number));
  });

  it('B3 unit tabs are quiet text tabs: no filled tab next to the one forest button (08)', async () => {
    const r = await renderScreen('B3', {}, { firstName: 'Maya', now: NOW }, size);
    for (const u of ['imperial', 'metric']) {
      expect(flat(r.getByTestId(`unit-${u}`).props.style).backgroundColor).toBeUndefined();
    }
    // GB phone: metric by default; the selected tab carries the rule.
    expect(r.getByTestId('unit-metric').props.accessibilityState).toEqual({ selected: true });
    expect(flat(r.getByTestId('unit-metric-rule').props.style).backgroundColor).not.toBe('transparent');
    expect(flat(r.getByTestId('unit-imperial-rule').props.style).backgroundColor).toBe('transparent');
  });

  it('wheels are serif, the selected value is larger and the band sits behind it (07-09)', async () => {
    const r = await renderScreen('B4', { B3: { height_cm: 167.6, weight_lbs: 172, unit: 'imperial' } }, { firstName: 'Maya', now: NOW }, size);
    const wheel = r.getByTestId('wheel-goal');
    const selected = r.getByText('172 lb', { includeHiddenElements: true });
    const neighbour = r.getByText('171 lb', { includeHiddenElements: true });
    const sel = flat(selected.props.style);
    const near = flat(neighbour.props.style);
    expect(String(sel.fontFamily)).toMatch(/^CormorantGaramond/);
    expect(sel.fontSize as number).toBeGreaterThan(near.fontSize as number);
    expect(sel.opacity).toBe(1);
    expect(near.opacity).toBeLessThan(1);
    for (const st of [sel, near]) expect(st.lineHeight as number).toBeGreaterThanOrEqual(1.2 * (st.fontSize as number));
    // The band is the wheel's first child, so it paints behind the values.
    const json = wheel.children[0] as { props: { pointerEvents?: string } };
    expect(json.props.pointerEvents).toBe('none');
  });

  it('S1 and N3 use the large two-column grid with serif numerals (17, 23)', async () => {
    for (const id of ['S1', 'N3']) {
      const r = await renderScreen(id, {}, { firstName: 'Maya', now: NOW }, size);
      expect(flat(r.getByTestId('consult-chips-big').props.style).flexWrap).toBe('wrap');
      const chip = flat(r.getByTestId('consult-chip-3').props.style);
      expect(chip.minHeight).toBe(56);
      expect(chip.width).toBe('48.5%');
      await r.unmount();
    }
  });
});

describe('copy and defaults', () => {
  it('P8 opens with the prototype headline and Roman line (35)', async () => {
    const p8 = screenById('P8') as ScreenDef;
    expect(fillCopy(p8.question, { firstName: 'Maya' })).toBe('Thanks for answering honestly, Maya.');
    expect(p8.roman).toBe('That helps me keep you safe.');
  });

  it('B3 defaults from the region: US, Liberia, Myanmar imperial; elsewhere metric; unknown imperial', async () => {
    expect(defaultMeasureUnit('US')).toBe('imperial');
    expect(defaultMeasureUnit('lr')).toBe('imperial');
    expect(defaultMeasureUnit('MM')).toBe('imperial');
    expect(defaultMeasureUnit('GB')).toBe('metric');
    expect(defaultMeasureUnit('DE')).toBe('metric');
    expect(defaultMeasureUnit(null)).toBe('imperial');
  });

  it('wheel neighbours fade with distance', async () => {
    expect([0, 1, -1, 2, 5].map(wheelOpacity)).toEqual([1, 0.6, 0.6, 0.3, 0.3]);
  });

  it('every coachless variant replaces a line the consultation really shows', async () => {
    const shown = new Set<string>([...SCREENS.flatMap(screenStrings), ...P8_COPY.guidance, ...P8_COPY.next, ...Object.values(REVEAL_COPY), ...HELPER_LINES]);
    for (const key of Object.keys(COACHLESS_COPY)) expect(shown.has(key)).toBe(true);
  });

  it('a coachless client is never told about a coach, on any question, P8, reveal or paused line', async () => {
    const ctx: CopyContext = { firstName: 'Maya', coachless: true, coachName: 'Bradley', now: NOW };
    const lines = [...SCREENS.filter((s) => s.id !== 'P0').flatMap(screenStrings), ...P8_COPY.guidance, ...P8_COPY.next, ...Object.values(REVEAL_COPY), ...HELPER_LINES];
    for (const t of lines) expect(fillCopy(t, ctx)).not.toMatch(/coach|Bradley/i);
    // A coached client keeps the coach's name.
    expect(fillCopy('{Coach} can build around what you already like.', { coachName: 'Bradley' })).toBe(
      'Bradley can build around what you already like.',
    );
  });

  it('B4 long-road note: coached keeps the coach, coachless is never promised one (B-579-SOL-B-1)', async () => {
    const b3: Answers = { B3: { height_cm: 167.6, weight_lbs: 172, unit: 'imperial' }, G1: 'fat_loss', B4: 100 };
    const coached = await renderScreen('B4', b3, { firstName: 'Maya', coachName: 'Bradley', now: NOW });
    expect(coached.getByTestId('goal-weight-note').props.children).toBe("That's a long road. Bradley will set milestones with you.");
    await coached.unmount();
    const solo = await renderScreen('B4', b3, { firstName: 'Maya', coachless: true, now: NOW });
    expect(solo.getByTestId('goal-weight-note').props.children).toBe("That's a long road. Smaller milestones along the way will help.");
  });

  it('P8 for a coachless client drops the coach line and keeps the physician step', async () => {
    const r = await renderScreen('P8', { P1: 'yes' }, { firstName: 'Maya', coachless: true, now: NOW });
    expect(r.queryByText(/coach/i)).toBeNull();
    expect(r.getByText(/book a visit with your physician/)).toBeTruthy();
    expect(r.getByTestId('p8-physician-line')).toBeTruthy();
  });

  it('W1 names the coach for a coached client and nobody for a coachless one (03)', async () => {
    const w1 = screenById('W1') as ScreenDef;
    expect(fillCopy(w1.roman as string, { coachName: 'Bradley' })).toMatch(/^I'm Roman\. Before Bradley builds anything for you/);
    expect(fillCopy(w1.roman as string, { coachless: true })).toMatch(/^I'm Roman\. Before anything is built for you/);
  });
});
