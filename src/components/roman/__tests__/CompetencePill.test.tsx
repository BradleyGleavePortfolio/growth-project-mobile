/**
 * CompetencePill — ED.6 "coach-is-watching" micro-signal.
 *
 * Pins:
 *   1. Hidden when `reviewedAt` is null (absence is the signal — not an
 *      empty state).
 *   2. Each relative-time bucket renders Roman's straight, butler-register
 *      sentence (brief §Relative time): just now / N hours ago / earlier today /
 *      yesterday / N days ago / {Month D}.
 *   3. Surface controls "this" vs "this thread".
 *   4. Voice doctrine: no exclamation, no emoji, no contractions, subject is
 *      always "Your coach" (Roman is the butler, not the reviewer).
 *
 * `now` is injected for deterministic bucketing. The component reads the theme
 * through useTheme's default context (no provider wrapper needed — same as the
 * RomanAvatar test).
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import CompetencePill from '../CompetencePill';

// A fixed reference clock: 2026-06-14T15:00:00 local. All fixtures below are
// expressed relative to this instant.
const NOW = new Date('2026-06-14T15:00:00');

function iso(d: Date): string {
  return d.toISOString();
}
function minutesAgo(n: number): string {
  return iso(new Date(NOW.getTime() - n * 60_000));
}
function hoursAgo(n: number): string {
  return iso(new Date(NOW.getTime() - n * 3_600_000));
}
function daysAgo(n: number): string {
  return iso(new Date(NOW.getTime() - n * 86_400_000));
}

async function textOf(reviewedAt: string | null, surface: 'checkIn' | 'thread' = 'checkIn') {
  const { queryByTestId } = await render(
    <CompetencePill
      reviewedAt={reviewedAt}
      surface={surface}
      now={NOW}
      testID="pill"
    />,
  );
  const node = queryByTestId('pill');
  return node ? (node.props.accessibilityLabel as string) : null;
}

describe('CompetencePill', () => {
  it('renders nothing when reviewedAt is null', async () => {
    const { queryByTestId } = await render(
      <CompetencePill reviewedAt={null} now={NOW} testID="pill" />,
    );
    expect(queryByTestId('pill')).toBeNull();
  });

  describe('relative-time buckets (surface=checkIn)', () => {
    it('< 1 hour → "just now"', async () => {
      expect(await textOf(minutesAgo(20))).toBe('Your coach reviewed this just now.');
    });

    it('N hours ago (same day)', async () => {
      expect(await textOf(hoursAgo(2))).toBe('Your coach reviewed this 2 hours ago.');
    });

    it('singular "1 hour ago"', async () => {
      // 90 minutes back is still the same calendar day and < 24h → "1 hour ago".
      expect(await textOf(minutesAgo(90))).toBe('Your coach reviewed this 1 hour ago.');
    });

    it('yesterday', async () => {
      expect(await textOf(daysAgo(1))).toBe('Your coach reviewed this yesterday.');
    });

    it('within 7 days → "N days ago"', async () => {
      expect(await textOf(daysAgo(4))).toBe('Your coach reviewed this 4 days ago.');
    });

    it('older than 7 days → "{Month D}"', async () => {
      // 40 days before 2026-06-14 → early May.
      const label = await textOf(daysAgo(40));
      expect(label).toMatch(/^Your coach reviewed this on May \d{1,2}\.$/);
    });
  });

  it('surface=thread names "this thread"', async () => {
    expect(await textOf(hoursAgo(2), 'thread')).toBe(
      'Your coach reviewed this thread 2 hours ago.',
    );
  });

  describe('voice doctrine', () => {
    const samples = [
      minutesAgo(10),
      hoursAgo(3),
      daysAgo(1),
      daysAgo(5),
      daysAgo(40),
    ];

    it('never uses an exclamation mark or emoji', async () => {
      const emoji =
        /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
      for (const s of samples) {
        for (const surface of ['checkIn', 'thread'] as const) {
          const label = (await textOf(s, surface))!;
          expect(label).not.toMatch(/!/);
          expect(label).not.toMatch(emoji);
        }
      }
    });

    it('uses no contractions and always names "Your coach"', async () => {
      for (const s of samples) {
        const label = (await textOf(s))!;
        expect(label).not.toMatch(/'/); // no apostrophes → no contractions
        expect(label.startsWith('Your coach reviewed')).toBe(true);
      }
    });
  });
});
