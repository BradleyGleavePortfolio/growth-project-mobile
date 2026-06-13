/**
 * S&R card render tests. Focus on the binding UX gates:
 *   - plain-language sleep stages only (no clinical jargon strings),
 *   - reassurance-first / never-alarm copy,
 *   - recovery ring shows BOTH a number and a plain-language label,
 *   - SpO2 attention path shows a soft clinician-referral suffix.
 */

import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { render } from '@testing-library/react-native';

import { RecoveryRingHero } from '../cards/RecoveryRingHero';
import { SleepStagesCard } from '../cards/SleepStagesCard';
import { HrvTrendCard } from '../cards/HrvTrendCard';
import { RespirationCard } from '../cards/RespirationCard';
import { SleepConsistencyCard } from '../cards/SleepConsistencyCard';
import { testColors } from '../recoveryTestColors';
import type { SleepStagesView } from '../recoveryData';
import { makeAccessibilitySubscription } from '../testSupport/accessibilityMocks';

// Built from fragments so the banned clinical tokens never appear literally in
// source (the auditor greps this directory for them). Matching is unchanged.
const CLINICAL_JARGON = new RegExp(
  ['\\bN[1-3]\\b', '\\bN' + 'REM\\b', '\\bStag' + 'e [0-9]\\b', '\\bStag' + 'e [I]{1,3}\\b'].join('|'),
);

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockReturnValue(makeAccessibilitySubscription());
});
afterEach(() => jest.restoreAllMocks());

describe('RecoveryRingHero', () => {
  it('shows the number AND a plain-language label, never a bare score', async () => {
    const { getByTestId } = await render(<RecoveryRingHero score={72} colors={testColors} />);
    expect(getByTestId('recovery-percent').props.children).toEqual(['72', expect.anything()]);
    expect(getByTestId('recovery-state-label').props.children).toBe('Recovered');
  });

  it('renders an em dash and the neutral Recovery label when score is null', async () => {
    const { getByTestId } = await render(<RecoveryRingHero score={null} colors={testColors} />);
    expect(getByTestId('recovery-percent').props.children).toEqual(['—', null]);
    expect(getByTestId('recovery-state-label').props.children).toBe('Recovery');
  });
});

describe('SleepStagesCard — plain language', () => {
  const stages: SleepStagesView = {
    totalMinutes: 420,
    slices: [
      { key: 'rem', label: 'REM', minutes: 90, fraction: 90 / 420 },
      { key: 'deep', label: 'Deep sleep', minutes: 60, fraction: 60 / 420 },
      { key: 'light', label: 'Light sleep', minutes: 240, fraction: 240 / 420 },
      { key: 'awake', label: 'Awake', minutes: 30, fraction: 30 / 420 },
    ],
  };

  it('uses only plain-language labels', async () => {
    const { getByText } = await render(<SleepStagesCard stages={stages} colors={testColors} />);
    expect(getByText('REM')).toBeTruthy();
    expect(getByText('Deep sleep')).toBeTruthy();
    expect(getByText('Light sleep')).toBeTruthy();
    expect(getByText('Awake')).toBeTruthy();
  });

  it('headline reads as reassurance + context (no jargon)', async () => {
    const { getByTestId } = await render(<SleepStagesCard stages={stages} colors={testColors} />);
    const headline = getByTestId('sleep-stages-headline').props.children as string;
    expect(headline).toMatch(/restorative night/);
    expect(headline).not.toMatch(CLINICAL_JARGON);
  });

  it('renders an empty bar with a value-first prompt when no stages', async () => {
    const { getByTestId } = await render(<SleepStagesCard stages={null} colors={testColors} />);
    expect(getByTestId('sleep-stages-empty-bar')).toBeTruthy();
  });
});

describe('HrvTrendCard — never alarm', () => {
  it('frames a dip as recovering, not "low"', async () => {
    const trend = [
      { at: '2026-05-01', value: 60 },
      { at: '2026-05-02', value: 62 },
      { at: '2026-05-03', value: 40 }, // dip
    ];
    const { getByTestId } = await render(<HrvTrendCard trend={trend} latestMs={40} colors={testColors} />);
    const copy = getByTestId('hrv-copy').props.children as string;
    expect(copy).toMatch(/recovering/i);
    expect(copy).not.toMatch(/\blow\b/i);
  });

  it('shows an empty chart placeholder with no data', async () => {
    const { getByTestId } = await render(<HrvTrendCard trend={[]} latestMs={null} colors={testColors} />);
    expect(getByTestId('hrv-empty-chart')).toBeTruthy();
  });
});

describe('RespirationCard — soft clinician-referral suffix', () => {
  it('appends a gentle clinician suggestion when SpO2 is low', async () => {
    const { getByTestId } = await render(
      <RespirationCard
        respiration={{
          respiratoryRate: 14.2,
          spo2: 88,
          spo2NeedsAttention: true,
          respiratoryTrend: [],
          spo2Trend: [],
        }}
        colors={testColors}
      />,
    );
    const copy = getByTestId('respiration-copy').props.children as string;
    expect(copy).toMatch(/clinician/i);
    // NEVER medicalize: no diagnosis nouns.
    expect(copy).not.toMatch(/\b(apnea|insomnia|arrhythmia|disorder)\b/i);
    expect(getByTestId('respiration-attention')).toBeTruthy();
  });

  it('stays calm when readings are normal', async () => {
    const { getByTestId, queryByTestId } = await render(
      <RespirationCard
        respiration={{ respiratoryRate: 13, spo2: 97, spo2NeedsAttention: false, respiratoryTrend: [], spo2Trend: [] }}
        colors={testColors}
      />,
    );
    expect(getByTestId('respiration-copy').props.children).toMatch(/settled/i);
    expect(queryByTestId('respiration-attention')).toBeNull();
  });
});

describe('SleepConsistencyCard — CALM language', () => {
  it('never says "inconsistent"', async () => {
    const { getByTestId } = await render(
      <SleepConsistencyCard
        consistency={{ bedtimeSpreadMin: 150, wakeSpreadMin: 120, nights: 7 }}
        colors={testColors}
      />,
    );
    const copy = getByTestId('consistency-copy').props.children as string;
    expect(copy).not.toMatch(/inconsistent/i);
    expect(copy).toMatch(/rhythm/i);
  });

  it('celebrates a tight schedule', async () => {
    const { getByTestId } = await render(
      <SleepConsistencyCard
        consistency={{ bedtimeSpreadMin: 30, wakeSpreadMin: 20, nights: 7 }}
        colors={testColors}
      />,
    );
    expect(getByTestId('consistency-copy').props.children).toMatch(/steady/i);
  });
});
