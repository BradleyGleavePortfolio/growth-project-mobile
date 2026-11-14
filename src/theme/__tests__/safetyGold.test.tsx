/**
 * SAFETY-GOLD-M (owner #197-E3, 11-04: "lets go with the proposed gold for the buttons/safety status"): the urgent,
 * eating-disorder and crisis alerts wear safety gold (src/theme/safetyGold.ts) outside Coach Home and Needs you:
 *   - the client file's SafetyAlertCard: #FFF8EC fill, deep gold #6B4F1A edge and shield; Message stays forest;
 *   - Command Center > Actions: each safety card on #FFF8EC with the deep gold edge (other rows keep camel on cream);
 *   - CoachSafetyAlertScreen: the message on the #FFF8EC card with the deep gold edge, the fixed line in deep gold.
 * Colours only: the words, layout and taps are the ones coachSafetyAlert.test.tsx and clientFileSafetyCard157 test.
 * Every colour pair drawn on these surfaces has a contrast gate below (WCAG 2.1: words 4.5:1, marks and edges 3:1).
 */
import React from 'react';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { StyleSheet } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('../../ui/haptics/haptics.service', () => ({
  HapticService: { selection: jest.fn(), softImpact: jest.fn(), success: jest.fn(), warning: jest.fn(), error: jest.fn() },
}));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name, color }: { name: string; color: string }) =>
    jest.requireActual('react').createElement(jest.requireActual('react-native').Text, { testID: `icon-${name}`, style: { color } }, ''),
}));
jest.mock('../../services/commandCenterApi', () => ({
  ...jest.requireActual('../../services/commandCenterApi'),
  commandCenterApi: { getActionQueue: jest.fn(), dismissAlert: jest.fn(), getSafetyAlert: jest.fn() },
}));

import { safetyGold } from '../safetyGold';
import { colors, gold, lightTokens } from '../tokens';
import { commandCenterApi, type ActionQueueItem } from '../../services/commandCenterApi';
import { SafetyAlertCard } from '../../screens/coach/client-detail/SafetyAlertCard';
import ActionQueueScreen from '../../screens/coach/command-center/ActionQueueScreen';
import CoachSafetyAlertScreen from '../../screens/coach/CoachSafetyAlertScreen';

function lin(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function lum(hex: string): number {
  const h = hex.replace('#', '');
  return 0.2126 * lin(parseInt(h.slice(0, 2), 16)) + 0.7152 * lin(parseInt(h.slice(2, 4), 16)) + 0.0722 * lin(parseInt(h.slice(4, 6), 16));
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const WORDS = 4.5;
const MARK = 3;
const PAGE = lightTokens.bgPrimary; // #F7FAF7, the page under all three surfaces

describe('safety gold: the shared file', () => {
  it('is the owner-approved deep gold, byte for byte the file NEEDS-YOU-M ships (m#934)', () => {
    expect(safetyGold).toEqual({ edge: gold[800], chipFill: gold[800], chipText: '#FFF8EC', card: '#FFF8EC', text: gold[800] });
    expect(gold[800]).toBe('#6B4F1A');
    const bytes = readFileSync(join(__dirname, '..', 'safetyGold.ts'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('581e429a94fd730057cd8795fb6d2dfd4eee2a8b3211be9b47ea0a149a070acf');
  });
});

describe('safety gold: a contrast gate for each colour pair', () => {
  // [what, foreground, background, floor]
  const pairs: Array<[string, string, string, number]> = [
    ['card edge on the page', safetyGold.edge, PAGE, MARK],
    ['card edge on the card', safetyGold.edge, safetyGold.card, MARK],
    ['file card shield on the card', safetyGold.text, safetyGold.card, MARK],
    ['alert screen fixed line on the page', safetyGold.text, PAGE, WORDS],
    ['Safety chip words on the chip', safetyGold.chipText, safetyGold.chipFill, WORDS],
    ['Safety chip on the card', safetyGold.chipFill, safetyGold.card, MARK],
    ['file card line (textPrimary) on the card', lightTokens.textPrimary, safetyGold.card, WORDS],
    ['file card Message (forest) on the card', lightTokens.accentText, safetyGold.card, WORDS],
    ['file card Dismiss (textMuted) on the card', lightTokens.textMuted, safetyGold.card, WORDS],
    ['Actions line 1 (ink) on the card', colors.ink, safetyGold.card, WORDS],
    ['Actions quote (textMuted) on the card', lightTokens.textMuted, safetyGold.card, WORDS],
    ['Actions DISMISS (graphite) on the card', colors.graphite, safetyGold.card, WORDS],
    ['alert screen message (textPrimary) on the card', lightTokens.textPrimary, safetyGold.card, WORDS],
  ];
  it.each(pairs)('%s', (_what, fg, bg, floor) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(floor);
  });
  it('the old camel edge it replaces in Actions was under 3:1 on the cream card', () => {
    expect(contrast(colors.camel, colors.cream)).toBeLessThan(MARK);
  });
});

const SENT = '2026-11-04T14:41:00.000Z';
const QUOTE = 'A neutral stand-in that describes an urgent client message and never quotes one.';
const item = (alert_id: string, alert_type: string, client_name: string, message: string, quote: string | null): ActionQueueItem =>
  ({ alert_id, client_id: `c-${alert_id}`, client_name, alert_type, message, created_at: SENT, dismissed_at: null, quote, sent_at: SENT }) as ActionQueueItem;

describe('safety gold on the three surfaces', () => {
  it.each(['roman_urgent_reply', 'roman_eating_disorder_reply', 'roman_crisis_reply'] as const)(
    'client file card (%s): #FFF8EC fill, deep gold edge and shield, Message stays forest',
    async (type) => {
      const { getByTestId, getByText } = await render(
        <SafetyAlertCard alert={{ alert_id: 'a', alert_type: type, created_at: SENT }} first="Avery" clientName="Avery Cole" onMessage={jest.fn()} onDismiss={jest.fn()} />,
      );
      const card = StyleSheet.flatten(getByTestId('file-safety-alert').props.style);
      expect(card.backgroundColor).toBe(safetyGold.card);
      expect(card.borderColor).toBe(safetyGold.edge);
      expect(StyleSheet.flatten(getByTestId('icon-shield-outline').props.style).color).toBe(safetyGold.text);
      expect(StyleSheet.flatten(getByText('Message Avery').props.style).color).toBe(lightTokens.accentText);
    },
  );

  it('Actions: every safety card on #FFF8EC with the deep gold edge; an ordinary row keeps camel on cream', async () => {
    (commandCenterApi.getActionQueue as jest.Mock).mockResolvedValue({ data: { total_pending: 4, items: [
      item('a1', 'roman_urgent_reply', 'Avery Cole', 'Urgent: Roman sent Avery Cole a medical safety reply. Check in with them →', QUOTE),
      item('a2', 'roman_eating_disorder_reply', 'Sam Lee', 'Roman sent Sam Lee an eating-disorder safety reply. Check in with them →', null),
      item('a3', 'roman_crisis_reply', 'Maya Collins', 'Roman sent Maya a crisis safety reply. Please check in with them today.', null),
      item('a4', 'missed_checkin', 'Noah Park', 'Missed two check-ins in a row.', null),
    ] } });
    const { getAllByTestId } = await render(<ActionQueueScreen onOpenSafetyAlert={jest.fn()} onSelectClient={jest.fn()} />);
    await waitFor(() => expect(getAllByTestId('command-center-safety-alert-row')).toHaveLength(3));
    for (const row of getAllByTestId('command-center-safety-alert-row')) {
      const s = StyleSheet.flatten(row.props.style);
      expect(s.backgroundColor).toBe(safetyGold.card);
      expect(s.borderLeftColor).toBe(safetyGold.edge);
    }
    const plain = StyleSheet.flatten(getAllByTestId('command-center-action-queue-row')[0].props.style);
    expect(plain.backgroundColor).toBe(colors.cream);
    expect(plain.borderLeftColor).toBe(colors.camel);
  });

  it.each([
    ['roman_urgent_reply', QUOTE],
    ['roman_eating_disorder_reply', QUOTE],
    ['roman_crisis_reply', null],
  ] as const)('alert screen (%s): the message on the gold-edged card, the fixed line in deep gold', async (alertType, quote) => {
    const navigation = { navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true, getParent: () => ({ navigate: jest.fn() }) };
    const { getByTestId, queryByTestId } = await render(
      <CoachSafetyAlertScreen
        route={{ key: 'k', name: 'CoachSafetyAlert', params: { alertType, clientId: 'c1', clientName: 'Avery Cole', quote, sentAt: SENT } } as never}
        navigation={navigation as never}
      />,
    );
    expect(StyleSheet.flatten(getByTestId('coach-safety-alert-summary').props.style).color).toBe(safetyGold.text);
    if (quote) {
      const box = StyleSheet.flatten(getByTestId('coach-safety-alert-card').props.style);
      expect(box.backgroundColor).toBe(safetyGold.card);
      expect(box.borderColor).toBe(safetyGold.edge);
    } else {
      expect(queryByTestId('coach-safety-alert-quote')).toBeNull(); // a crisis alert never shows the client's words
    }
  });
});
