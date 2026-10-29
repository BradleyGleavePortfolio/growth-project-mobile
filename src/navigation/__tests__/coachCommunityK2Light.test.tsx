/**
 * FIN-868R5 B3: the K2 coach pages (Home, Inbox, Cohorts, a cohort) are drawn
 * light (bone, cream, forest). With the phone theme dark, every themed part
 * inside them (the Ack pill, the triage card, Roman's empty and error states,
 * the create and invite modals) must keep the light tokens: no dark part on a
 * light page. Other coach pages keep following the phone theme.
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { ThemeContext, useTheme, type Theme } from '../../theme/ThemeProvider';
import { darkTokens, lightTokens } from '../../theme/tokens';
import type { AckStateDto } from '../../api/coachCommunityApi';
import CoachAckBadge from '../../components/community/CoachAckBadge';
import { coachCommunityScreenLayout } from '../CoachCommunityNavigator';

jest.mock('../../components/community/CommunityTermsGate', () => () => null);
jest.mock('../../screens/community/CoachCommunityHomeScreen', () => () => null);
jest.mock('../../screens/community/CoachCommunityInboxScreen', () => () => null);
jest.mock('../../screens/community/CoachCommunityCohortsScreen', () => () => null);
jest.mock('../../screens/community/CoachCommunityCohortDetailScreen', () => () => null);
jest.mock('../../screens/community/CoachCommunityPostDetailScreen', () => () => null);
jest.mock('../../screens/community/CoachCommunityModerationScreen', () => () => null);
jest.mock('../../screens/community/CoachCommunityEventsScreen', () => () => null);
jest.mock('../../screens/community/CommunityWearablePromptsScreen', () => () => null);

const K2 = [
  'CoachCommunityHome',
  'CoachCommunityInbox',
  'CoachCommunityCohorts',
  'CoachCommunityCohortDetail',
];

let phone: Theme;
function Grab(): null {
  phone = useTheme();
  return null;
}

function Probe(): React.ReactElement {
  const t = useTheme();
  return <Text testID="probe">{`${t.colorScheme} ${t.semanticColors.bgSurface}`}</Text>;
}

/** The phone in dark mode: the app theme with the dark tokens. */
async function darkPhone(): Promise<Theme> {
  await render(<Grab />);
  return { ...phone, semanticColors: darkTokens, colorScheme: 'dark' };
}

/** Every colour a rendered tree paints (text, fill, border, icon). */
function coloursIn(node: unknown, out: string[] = []): string[] {
  if (node == null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((n) => coloursIn(n, out));
    return out;
  }
  const { props = {}, children } = node as { props?: Record<string, unknown>; children?: unknown };
  const style = (StyleSheet.flatten(props.style as never) ?? {}) as Record<string, unknown>;
  for (const v of [...Object.values(style), props.color]) {
    if (typeof v === 'string' && v.startsWith('#')) out.push(v.toUpperCase());
  }
  return coloursIn(children, out);
}

const DARK_ONLY = new Set(
  Object.entries(darkTokens)
    .filter(([k, v]) => typeof v === 'string' && v !== (lightTokens as unknown as Record<string, unknown>)[k])
    .map(([, v]) => String(v).toUpperCase()),
);

const acked: AckStateDto = {
  state: 'acked',
  seen_at: '2026-10-28T09:00:00.000Z',
  acked_at: '2026-10-28T09:05:00.000Z',
  replied_at: null,
  sla: { sla_state: 'breached', elapsed_ms: 1, soft_target_ms: 1, hard_target_ms: 1 },
};

it.each(K2)('%s keeps the light tokens when the phone theme is dark', async (name) => {
  const dark = await darkPhone();
  await render(
    <ThemeContext.Provider value={dark}>
      {coachCommunityScreenLayout({ route: { name }, children: <Probe /> })}
    </ThemeContext.Provider>,
  );
  expect(screen.getByTestId('probe')).toHaveTextContent(`light ${lightTokens.bgSurface}`);
});

it('a coach page outside K2 (a post) still follows the phone theme', async () => {
  const dark = await darkPhone();
  await render(
    <ThemeContext.Provider value={dark}>
      {coachCommunityScreenLayout({ route: { name: 'CoachCommunityPostDetail' }, children: <Probe /> })}
    </ThemeContext.Provider>,
  );
  expect(screen.getByTestId('probe')).toHaveTextContent(`dark ${darkTokens.bgSurface}`);
});

it('the Ack pill and Overdue chip on the inbox paint no dark-only colour on a dark phone', async () => {
  const dark = await darkPhone();
  const tree = await render(
    <ThemeContext.Provider value={dark}>
      {coachCommunityScreenLayout({
        route: { name: 'CoachCommunityInbox' },
        children: <CoachAckBadge ack={acked} testID="badge" />,
      })}
    </ThemeContext.Provider>,
  );
  const painted = coloursIn(tree.toJSON());
  expect(painted.length).toBeGreaterThan(0);
  expect(painted.filter((c) => DARK_ONLY.has(c))).toEqual([]);
});
