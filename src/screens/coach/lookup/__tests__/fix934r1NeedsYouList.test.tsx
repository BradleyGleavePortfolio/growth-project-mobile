/**
 * FIX-934R1 (agent 198), class-first siblings of LS-934 B2 and LO-934 B3 / LS-934 B4 on the Needs you list:
 * verified alerts stay over a roster that is loading or failed, and NY-16 "Joined {date}" is on every Gone quiet and
 * New this week row, never on a Routine row.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../../components/HapticPressable', () => jest.requireActual('react-native').Pressable);
jest.mock('../../../../ui', () => ({ useScreenInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

import NeedsYouList from '../NeedsYouList';
import type { NeedsAreas } from '../../../../utils/coach/needsYou';
import type { RosterClient } from '../../../../utils/coach/clientRoster';
import type { ActionQueueItem } from '../../../../services/commandCenterApi';

const person = (id: string, first: string, createdAt: string) =>
  ({ id, firstName: first, lastName: 'Lee', email: `${id}@example.com`, status: 'active', createdAt, activity: { lastActiveOn: '2026-10-28' } }) as unknown as RosterClient;
const safety = { alert_id: 's1', alert_type: 'roman_crisis_reply', client_id: 'a', client_name: 'Avery Cole', message: 'm', dismissed_at: null, created_at: '2026-11-05T10:00:00Z' } as ActionQueueItem;
const other = { alert_id: 'o1', alert_type: 'high_churn_risk', client_id: 'h', client_name: 'Hana Kim', message: 'Hana has a high churn risk this week.', dismissed_at: null, created_at: '2026-11-05T09:00:00Z' } as ActionQueueItem;
const noop = () => undefined;
const draw = (areas: NeedsAreas, over: Record<string, unknown> = {}) => render(
  <NeedsYouList
    {...({ areas, rosterCount: 3, loading: false, error: null, alertsFailed: false, refreshing: false, onRefresh: noop, onRetry: noop, onBack: noop,
      onOpenSafety: noop, onOpenAlert: noop, onOpenClient: noop, onAction: noop, now: new Date('2026-11-05T12:00:00Z'), ...over } as unknown as React.ComponentProps<typeof NeedsYouList>)}
  />,
);
const alertsOnly: NeedsAreas = { safety: [safety], alerts: [other], quiet: [], fresh: [], routine: [], attention: 2, routineCount: 0, total: 2 };

describe('FIX-934R1: verified alerts never wait on the roster (LS-934 B2, list side)', () => {
  it.each([
    ['loading', { loading: true }, 'needs-loading'],
    ['failed', { error: 'Clients did not load. Check the connection and try again.' }, 'needs-error'],
  ])('roster %s: the safety row and the other alert stay, the roster state sits under them', async (_k, over, held) => {
    const v = await draw(alertsOnly, over);
    expect([!!v.queryByTestId('needs-safety-s1'), !!v.queryByTestId('needs-alert-o1'), !!v.queryByTestId(held)]).toEqual([true, true, true]);
    // No count, roster size, search or switch the roster has not verified.
    expect([v.getByTestId('needs-title').props.children, !!v.queryByTestId('needs-search'), !!v.queryByText(/from your/)]).toEqual(['Needs you', false, false]);
  });
});

describe('FIX-934R1: NY-16 "Joined {date}" on the rows GOAL N1 draws it on (LO-934 B3)', () => {
  it.each([
    ['Gone quiet', 'quiet', true],
    ['New this week', 'fresh', true],
    ['Routine', 'routine', false],
  ] as const)('%s row: joined line %s', async (_label, key, shown) => {
    const c = person('c1', 'Maya', '2026-06-09T10:00:00.000Z');
    const reason = { text: key === 'routine' ? '1 new message' : key === 'fresh' ? 'New, no logs yet' : 'Last logged 8 days ago', action: key === 'routine' ? 'reply' : key === 'fresh' ? 'hello' : 'nudge', ok: false };
    const areas: NeedsAreas = {
      safety: [], alerts: [], quiet: [], fresh: [], routine: [], attention: key === 'routine' ? 0 : 1, routineCount: key === 'routine' ? 1 : 0, total: 1,
      [key]: [{ client: c, reason }],
    } as NeedsAreas;
    const v = await draw(areas);
    expect(!!v.queryByText('Joined Jun 9')).toBe(shown);
  });
  it('no createdAt: no joined line, and no made-up date', async () => {
    const c = { ...person('c2', 'Dev', ''), createdAt: undefined } as unknown as RosterClient;
    const areas: NeedsAreas = { safety: [], alerts: [], quiet: [{ client: c, reason: { text: 'Last logged 6 days ago', action: 'nudge', ok: false } }], fresh: [], routine: [], attention: 1, routineCount: 0, total: 1 };
    const v = await draw(areas);
    expect(v.queryByText(/^Joined/)).toBeNull();
  });
});
