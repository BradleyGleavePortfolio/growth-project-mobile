/**
 * GOAL-937-M (agent 203; owner #197-E3, 203-D20 op 1): the deep-gold safety card and its drawn Safety tag on the three
 * coach surfaces SAFETY-GOLD-M (m#937) restyled: a client's file (SafetyAlertCard), Command Center > Actions
 * (ActionQueueScreen's safety rows through AlertRow) and the safety alert screen (CoachSafetyAlertScreen).
 * GOAL: TAN-MOCK ctx#441, third panel, handoffs/op-197/renders/tan-mock/src/contrast.py @ 3e43773e:
 *   :94 card fill #FFF8EC, border "2px solid #6B4F1A", tag fill #6B4F1A, tag words #FFF8EC;
 *   :67 .card radius 16, padding 16, gap 12;
 *   :68 .chip inline-flex, gap 6, Inter 600 13, padding 5 x 11, radius 12;
 *   :80 the tag is a 13 x 13 shield outline then the word "Safety", under the card's line.
 * Look only: who is alerted, which words show (never the client's words for a crisis alert), what a screen reader
 * says, every tap, every testID and every ph-no-capture area stay as on main 8efe38e0.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, waitFor, within } from '@testing-library/react-native';

jest.mock('../ui/haptics/haptics.service', () => ({
  HapticService: { selection: jest.fn(), softImpact: jest.fn(), success: jest.fn(), warning: jest.fn(), error: jest.fn() },
}));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name, color, size }: { name: string; color: string; size: number }) =>
    jest.requireActual('react').createElement(jest.requireActual('react-native').Text, { testID: `icon-${name}`, style: { color, fontSize: size } }, ''),
}));
jest.mock('../services/commandCenterApi', () => ({
  ...jest.requireActual('../services/commandCenterApi'),
  commandCenterApi: { getActionQueue: jest.fn(), dismissAlert: jest.fn(), getSafetyAlert: jest.fn() },
}));

import { safetyGold } from '../theme/safetyGold';
import { colors, lightTokens, radius } from '../theme/tokens';
import { Colors } from '../constants/colors';
import { commandCenterApi, type ActionQueueItem } from '../services/commandCenterApi';
import { SafetyAlertCard } from '../screens/coach/client-detail/SafetyAlertCard';
import ActionQueueScreen from '../screens/coach/command-center/ActionQueueScreen';
import CoachSafetyAlertScreen, { SAFETY_ALERT_SUMMARY } from '../screens/coach/CoachSafetyAlertScreen';
import AlertRow from '../components/command-center/AlertRow';

/** contrast.py:94 "2px solid #6B4F1A", read at 1 px = 1 pt (the source CSS wins; Needs you draws 2 on main). */
const EDGE = 2;
const TYPES = ['roman_urgent_reply', 'roman_eating_disorder_reply', 'roman_crisis_reply'] as const;
const SENT = '2026-11-04T14:41:00.000Z';
/** A neutral stand-in for the client's own words ([R22]): it describes them, never quotes a real message. */
const WORDS = 'A stand-in for the client message, described here and never quoted.';
const HIDDEN = { includeHiddenElements: true } as const;
const TAG = 'safety-tag';

type El = { props: Record<string, any>; parent: El | null };
const flat = (el: El) => StyleSheet.flatten(el.props.style) as Record<string, any>;
const textsOf = (els: El[]) => els.map((t) => t.props.children);

/** The drawn tag (contrast.py:68, :80, :94), hidden from screen readers under the REC (KT-7), never pressable. */
function expectDrawnTag(tag: El) {
  const box = flat(tag);
  expect(box.backgroundColor).toBe(safetyGold.chipFill);
  expect([box.flexDirection, box.alignItems, box.alignSelf, box.gap]).toEqual(['row', 'center', 'flex-start', 6]);
  expect([box.paddingVertical, box.paddingHorizontal, box.borderRadius]).toEqual([5, 11, radius.input]);
  expect([box.width, box.height]).toEqual([undefined, undefined]); // it grows at 130%
  const word = within(tag as never).getByText('Safety', HIDDEN) as unknown as El;
  const w = flat(word);
  expect([w.fontFamily, w.fontSize, w.color]).toEqual(['Inter_600SemiBold', 13, safetyGold.chipText]);
  expect(word.props.numberOfLines).toBeUndefined();
  const shield = within(tag as never).getByTestId('icon-shield-outline', HIDDEN) as unknown as El;
  expect([flat(shield).color, flat(shield).fontSize]).toEqual([safetyGold.chipText, 13]);
  expect(tag.props.accessibilityElementsHidden).toBe(true);
  expect(tag.props.importantForAccessibility).toBe('no-hide-descendants');
  expect(tag.props.onPress).toBeUndefined();
  expect(tag.props.accessibilityRole).toBeUndefined();
}

/** The drawn card edge: EDGE on all four sides, deep gold on every side, cream fill (contrast.py:94). */
function expectDrawnEdge(s: Record<string, any>) {
  expect(s.backgroundColor).toBe(safetyGold.card);
  expect(s.borderWidth).toBe(EDGE);
  expect(s.borderColor).toBe(safetyGold.edge);
  for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
    expect([side, s[`border${side}Width`] ?? s.borderWidth]).toEqual([side, EDGE]);
    expect([side, s[`border${side}Color`] ?? s.borderColor]).toEqual([side, safetyGold.edge]);
  }
  expect(s.borderRadius).toBe(radius.card);
}

function hasNoCaptureAncestor(el: El): boolean {
  for (let x: El | null = el; x; x = x.parent) if (x.props?.['ph-no-capture']) return true;
  return false;
}

const item = (alert_id: string, alert_type: string, client_name: string, message: string, quote: string | null): ActionQueueItem =>
  ({ alert_id, client_id: `c-${alert_id}`, client_name, alert_type, message, created_at: SENT, dismissed_at: null, quote, sent_at: SENT }) as ActionQueueItem;

const URGENT = 'Urgent: Roman sent Avery Cole a medical safety reply. Check in with them →';
const ED = 'Roman sent Sam Lee an eating-disorder safety reply. Check in with them →';
const CRISIS = 'Roman sent Maya a crisis safety reply. Please check in with them today.';

describe('GOAL-937-M: the client file card (SafetyAlertCard)', () => {
  it.each(TYPES)('%s: the drawn edge all round, the drawn tag under the line, words, spoken words and taps as on main', async (type) => {
    const onMessage = jest.fn();
    const { getByTestId } = await render(
      <SafetyAlertCard alert={{ alert_id: 'a', alert_type: type, created_at: SENT }} first="Avery" clientName="Avery Cole" onMessage={onMessage} onDismiss={jest.fn()} />,
    );
    const card = getByTestId('file-safety-alert') as unknown as El;
    expectDrawnEdge(flat(card));
    expect(card.props['ph-no-capture']).toBe(true);
    const tags = within(card as never).getAllByTestId(TAG, HIDDEN) as unknown as El[];
    expect(tags).toHaveLength(1);
    expectDrawnTag(tags[0]);
    // Seen: the line, then the tag under it, then the buttons (contrast.py:80). Spoken: main's words only.
    const seen = textsOf(within(card as never).getAllByText(/./, HIDDEN) as unknown as El[]);
    expect(seen.slice(1)).toEqual(['Safety', 'Message Avery', 'Dismiss']);
    const spoken = textsOf(within(card as never).getAllByText(/./) as unknown as El[]);
    expect(spoken).toEqual([seen[0], 'Message Avery', 'Dismiss']);
    expect(within(card as never).getByRole('button', { name: 'Dismiss alert for Avery Cole' })).toBeTruthy();
    expect(within(card as never).getByRole('button', { name: 'Message Avery' })).toBeTruthy();
    expect(flat(within(card as never).getByText('Message Avery') as unknown as El).color).toBe(lightTokens.accentText);
    expect(getByTestId('file-safety-message')).toBeTruthy();
    expect(getByTestId('file-safety-dismiss')).toBeTruthy();
    // The shield beside the line keeps safetyGold.text (main's); the tag's shield is the second one.
    const shields = within(card as never).getAllByTestId('icon-shield-outline', HIDDEN) as unknown as El[];
    expect(shields.map((s) => flat(s).color)).toEqual([safetyGold.text, safetyGold.chipText]);
  });
});

describe('GOAL-937-M: Command Center > Actions', () => {
  it('each safety card: the drawn edge on all four sides and the drawn tag under its words; the ordinary row is main\'s', async () => {
    (commandCenterApi.getActionQueue as jest.Mock).mockResolvedValue({ data: { total_pending: 4, items: [
      item('a1', 'roman_urgent_reply', 'Avery Cole', URGENT, WORDS),
      item('a2', 'roman_eating_disorder_reply', 'Sam Lee', ED, WORDS),
      item('a3', 'roman_crisis_reply', 'Maya Collins', CRISIS, WORDS), // a crisis alert never shows the words
      item('a4', 'missed_checkin', 'Noah Park', 'Missed two check-ins in a row.', null),
    ] } });
    const { getAllByTestId } = await render(<ActionQueueScreen onOpenSafetyAlert={jest.fn()} onSelectClient={jest.fn()} />);
    await waitFor(() => expect(getAllByTestId('command-center-safety-alert-row')).toHaveLength(3));
    const rows = getAllByTestId('command-center-safety-alert-row') as unknown as El[];
    const want = [
      { name: 'Avery Cole', label: `${URGENT.replace(/\s*→\s*$/, '.')} ${WORDS}`, seen: [URGENT, WORDS, 'Safety', 'Dismiss'] },
      { name: 'Sam Lee', label: `${ED.replace(/\s*→\s*$/, '.')} ${WORDS}`, seen: [ED, WORDS, 'Safety', 'Dismiss'] },
      { name: 'Maya Collins', label: CRISIS, seen: [CRISIS, 'Safety', 'Dismiss'] },
    ];
    rows.forEach((row, k) => {
      const s = flat(row);
      expectDrawnEdge(s); // radius.card 16 (AlertRow's radius.lg is the same 16)
      expect(s.borderLeftWidth).toBe(EDGE); // AlertRow's 3 pt left rule does not win
      expect(s.borderLeftColor).toBe(safetyGold.edge);
      expect(hasNoCaptureAncestor(row)).toBe(true);
      const tags = within(row as never).getAllByTestId(TAG, HIDDEN) as unknown as El[];
      expect(tags).toHaveLength(1);
      expectDrawnTag(tags[0]);
      expect(textsOf(within(row as never).getAllByText(/./, HIDDEN) as unknown as El[])).toEqual(want[k].seen);
      expect(row.props.accessibilityLabel).toBe(want[k].label); // AlertRow.tsx:73-77, main's words
      expect(within(row as never).getByRole('button', { name: `Dismiss alert for ${want[k].name}` })).toBeTruthy();
    });
    expect(within(rows[2] as never).queryByText(WORDS, HIDDEN)).toBeNull();
    expect(within(rows[2] as never).queryByTestId('command-center-alert-quote', HIDDEN)).toBeNull();
    const plainRow = getAllByTestId('command-center-action-queue-row')[0] as unknown as El;
    const plain = flat(plainRow);
    expect([plain.backgroundColor, plain.borderLeftColor, plain.borderLeftWidth]).toEqual([colors.cream, colors.camel, 3]);
    for (const k of ['borderWidth', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderColor']) expect([k, plain[k]]).toEqual([k, undefined]);
    expect(within(plainRow as never).queryAllByTestId(TAG, HIDDEN)).toHaveLength(0);
  });

  it.each([
    ['At risk (AtRiskScreen.tsx:116)', { clientName: 'Noah Park', message: 'Missed two check-ins in a row.', bucket: 'red' as const, testID: 'command-center-at-risk-row' }, Colors.earningsAccent, 1, 2],
    ['Money (MoneyScreen.tsx:635)', { clientName: 'Payment failed', message: 'A card payment did not go through.', messageLines: 6, actionLabel: 'Message Noah', testID: 'money-attention-x-1' }, colors.camel, 1, 3],
    ['the ordinary Actions row (ActionQueueScreen.tsx:170)', { clientName: 'Noah Park', message: 'Missed two check-ins in a row.', onDismiss: jest.fn(), testID: 'command-center-action-queue-row' }, colors.camel, 2, 2],
  ])('AlertRow without the new prop draws exactly as on main: %s', async (_where, props, accent, rowKids, contentKids) => {
    const { getByTestId, queryAllByTestId, toJSON } = await render(<AlertRow onPress={jest.fn()} {...props} />);
    const s = flat(getByTestId(props.testID) as unknown as El);
    expect([s.backgroundColor, s.borderRadius, s.borderLeftWidth, s.borderLeftColor]).toEqual([colors.cream, radius.lg, 3, accent]);
    for (const k of ['borderWidth', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderColor']) expect([k, s[k]]).toEqual([k, undefined]);
    expect(queryAllByTestId(TAG, HIDDEN)).toHaveLength(0);
    const tree = toJSON() as unknown as { children: Array<{ children: unknown[] }> };
    expect(tree.children).toHaveLength(rowKids); // the content column (+ Dismiss when given)
    expect(tree.children[0].children).toHaveLength(contentKids); // header, line (+ action label): no extra node
  });
});

describe('GOAL-937-M: the safety alert screen (CoachSafetyAlertScreen)', () => {
  const navigation = { navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true, getParent: () => ({ navigate: jest.fn() }) };

  it.each(TYPES)('%s: one drawn card holds the words (never for crisis), the fixed line and the tag; Message stays outside', async (alertType) => {
    const { getByTestId, queryByTestId, queryByText } = await render(
      <CoachSafetyAlertScreen
        route={{ key: 'k', name: 'CoachSafetyAlert', params: { alertType, clientId: 'c1', clientName: 'Avery Cole', quote: WORDS, sentAt: SENT } } as never}
        navigation={navigation as never}
      />,
    );
    const card = getByTestId('coach-safety-alert-card') as unknown as El;
    const s = flat(card);
    expectDrawnEdge(s);
    expect([s.padding, s.gap]).toEqual([16, 12]); // contrast.py:67
    expect(hasNoCaptureAncestor(card)).toBe(true);
    const summary = SAFETY_ALERT_SUMMARY[alertType].replace('{first name}', 'Avery');
    const line = within(card as never).getByTestId('coach-safety-alert-summary') as unknown as El;
    expect(line.props.children).toBe(summary);
    expect(flat(line).color).toBe(safetyGold.text);
    const tags = within(card as never).getAllByTestId(TAG, HIDDEN) as unknown as El[];
    expect(tags).toHaveLength(1);
    expectDrawnTag(tags[0]);
    const seen = textsOf(within(card as never).getAllByText(/./, HIDDEN) as unknown as El[]);
    const spoken = textsOf(within(card as never).getAllByText(/./) as unknown as El[]);
    if (alertType === 'roman_crisis_reply') {
      expect(queryByTestId('coach-safety-alert-quote')).toBeNull(); // #ROMAN-CRISIS-ALERT
      expect(queryByText(WORDS, HIDDEN)).toBeNull();
      expect(seen).toEqual([summary, 'Safety']);
      expect(spoken).toEqual([summary]);
    } else {
      const words = within(card as never).getByTestId('coach-safety-alert-quote') as unknown as El;
      expect(within(words as never).getByText(WORDS).props.selectable).toBe(true);
      expect(seen).toEqual([WORDS, summary, 'Safety']);
      expect(spoken).toEqual([WORDS, summary]);
    }
    expect(within(card as never).queryByTestId('coach-safety-alert-message')).toBeNull();
    expect(getByTestId('coach-safety-alert-message')).toBeTruthy();
  });

  it('opened by id: while the alert loads there is no card and no tag (a control)', async () => {
    (commandCenterApi.getSafetyAlert as jest.Mock).mockReturnValue(new Promise(() => undefined));
    const { getByTestId, queryByTestId, queryAllByTestId } = await render(
      <CoachSafetyAlertScreen route={{ key: 'k', name: 'CoachSafetyAlert', params: { alertId: 'a9' } } as never} navigation={navigation as never} />,
    );
    expect(getByTestId('coach-safety-alert-loading')).toBeTruthy();
    expect(queryByTestId('coach-safety-alert-card')).toBeNull();
    expect(queryAllByTestId(TAG, HIDDEN)).toHaveLength(0);
  });

  it('the fixed line in deep gold on the cream card passes 4.5:1 (it now sits on the card, not the page)', () => {
    const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = (hex: string) => { const h = hex.replace('#', ''); return 0.2126 * lin(parseInt(h.slice(0, 2), 16)) + 0.7152 * lin(parseInt(h.slice(2, 4), 16)) + 0.0722 * lin(parseInt(h.slice(4, 6), 16)); };
    const [hi, lo] = [lum(safetyGold.text), lum(safetyGold.card)].sort((x, y) => y - x);
    expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});
