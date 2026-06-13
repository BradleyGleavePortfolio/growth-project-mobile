/**
 * EventCard — render + helper tests (v2-3).
 *
 * Covers:
 *   - Renders the title, the state badge label, and the RSVP summary.
 *   - Tapping fires onPress with the event.
 *   - A provisional (optimistic) event renders the "Saving…" treatment and is
 *     non-interactive (disabled).
 *   - The `formatEventStart` / `rsvpSummary` pure helpers degrade gracefully.
 *
 * useTheme is mocked to the real light tokens so semanticColors keys resolve
 * without standing up the ThemeProvider (mirrors the v1-5 screen-test harness).
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

import EventCard, {
  formatEventStart,
  rsvpSummary,
  stateMeta,
} from '../EventCard';
import type { CommunityEvent } from '../../../api/communityEventsApi';

function makeEvent(overrides: Partial<CommunityEvent> = {}): CommunityEvent {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    workspace_id: '22222222-2222-4222-8222-222222222222',
    cohort_id: null,
    created_by_user_id: '33333333-3333-4333-8333-333333333333',
    title: 'Live Q&A',
    description: null,
    state: 'scheduled',
    starts_at: '2026-07-01T18:00:00.000Z',
    ends_at: null,
    external_url: null,
    reflected_at: null,
    canceled: false,
    rsvp_counts: { going: 12, maybe: 3, declined: 1, attended: 0, missed: 0 },
    viewer_rsvp_status: null,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('EventCard', () => {
  it('renders the title, state badge, and rsvp summary', async () => {
    const { getByText, getByTestId } = await render(
      <EventCard event={makeEvent()} onPress={jest.fn()} testID="card" />,
    );
    expect(getByTestId('card')).toBeTruthy();
    expect(getByText('Live Q&A')).toBeTruthy();
    expect(getByText('Scheduled')).toBeTruthy();
    expect(getByText('12 going · 3 maybe')).toBeTruthy();
  });

  it('wraps the card in a listitem while keeping the press target a button', async () => {
    const { getByTestId, UNSAFE_getByProps } = await render(
      <EventCard event={makeEvent()} onPress={jest.fn()} testID="card" />,
    );
    // The inner press target keeps button semantics.
    expect(getByTestId('card').props.accessibilityRole).toBe('button');
    // An outer wrapper supplies listitem semantics for assistive tech (RN
    // types list/listitem via the W3C `role` prop).
    expect(UNSAFE_getByProps({ role: 'listitem' })).toBeTruthy();
  });

  it('fires onPress with the event when tapped', async () => {
    const onPress = jest.fn();
    const event = makeEvent();
    const { getByTestId } = await render(
      <EventCard event={event} onPress={onPress} testID="card" />,
    );
    await fireEvent.press(getByTestId('card'));
    expect(onPress).toHaveBeenCalledWith(event);
  });

  it('renders a provisional event as saving and disabled', async () => {
    const onPress = jest.fn();
    const event = makeEvent({ id: 'optimistic:abc' });
    const { getByText, getByTestId } = await render(
      <EventCard event={event} onPress={onPress} testID="card" />,
    );
    expect(getByText('Saving…')).toBeTruthy();
    await fireEvent.press(getByTestId('card'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('shows the canceled label over the lifecycle state when canceled', async () => {
    const { getByText, queryByText } = await render(
      <EventCard event={makeEvent({ canceled: true })} onPress={jest.fn()} />,
    );
    expect(getByText('Canceled')).toBeTruthy();
    expect(queryByText('Scheduled')).toBeNull();
  });

  it('falls back to "No RSVPs yet" when there are none', async () => {
    const { getByText } = await render(
      <EventCard
        event={makeEvent({
          rsvp_counts: {
            going: 0,
            maybe: 0,
            declined: 0,
            attended: 0,
            missed: 0,
          },
        })}
        onPress={jest.fn()}
      />,
    );
    expect(getByText('No RSVPs yet')).toBeTruthy();
  });
});

describe('stateMeta (F5 unknown-state safety + F13 lifecycle labels)', () => {
  it('maps each known lifecycle state to its status-honest label', () => {
    const table: Array<[string, string]> = [
      ['scheduled', 'Scheduled'],
      ['tomorrow', 'Tomorrow'],
      ['live', 'Live now'],
      ['replay', 'Replay available'],
      ['reflected', 'Recap posted'],
    ];
    table.forEach(([state, label]) => {
      expect(stateMeta(state).label).toBe(label);
      // Every entry resolves a real glyph (never undefined).
      expect(stateMeta(state).icon).toBeTruthy();
    });
  });

  it('degrades a hostile / unknown state to a neutral fallback (no crash)', () => {
    expect(stateMeta('definitely-not-a-state').label).toBe('Event');
    expect(stateMeta('definitely-not-a-state').icon).toBe('calendar-outline');
    // An empty string and an upstream typo also degrade calmly.
    expect(stateMeta('').label).toBe('Event');
    expect(stateMeta('LIVE').label).toBe('Event');
  });

  it('renders the fallback label on a card given an out-of-contract state', async () => {
    // Cast through the public string overload using a plain typed assertion.
    const hostile = makeEvent({ state: 'archived' as CommunityEvent['state'] });
    const { getByText } = await render(<EventCard event={hostile} onPress={jest.fn()} />);
    expect(getByText('Event')).toBeTruthy();
  });
});

describe('formatEventStart', () => {
  it('degrades to an em dash for an unparseable timestamp', () => {
    expect(formatEventStart('not-a-date')).toBe('—');
  });

  it('formats a valid timestamp into a date · time string', () => {
    const out = formatEventStart('2026-07-01T18:00:00.000Z');
    expect(out).toContain('·');
    expect(out.length).toBeGreaterThan(3);
  });
});

describe('rsvpSummary', () => {
  it('lists only the non-zero going / maybe counts', () => {
    expect(
      rsvpSummary(
        makeEvent({
          rsvp_counts: {
            going: 5,
            maybe: 0,
            declined: 2,
            attended: 0,
            missed: 0,
          },
        }),
      ),
    ).toBe('5 going');
  });

  it('returns an empty string when there are no going/maybe RSVPs', () => {
    expect(
      rsvpSummary(
        makeEvent({
          rsvp_counts: {
            going: 0,
            maybe: 0,
            declined: 4,
            attended: 0,
            missed: 0,
          },
        }),
      ),
    ).toBe('');
  });
});
