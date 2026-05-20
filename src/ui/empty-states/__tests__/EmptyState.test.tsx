/**
 * EmptyState component library — unit + interaction tests.
 *
 * Coverage:
 *  1. Base EmptyState renders headline text.
 *  2. Base EmptyState renders body text when provided.
 *  3. Base EmptyState does NOT render body when omitted.
 *  4. CTA button fires onCta when pressed.
 *  5. No CTA button rendered when ctaLabel / onCta are absent.
 *  6. EmptyStateNoClients renders expected headline and CTA.
 *  7. EmptyStateNoWorkouts renders expected headline, no CTA.
 *  8. EmptyStateNoData renders custom headline override.
 *  9. EmptyStateNoResults interpolates query string into body.
 * 10. EmptyStateOffline renders retry CTA when handler provided.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// ─── Mock theme ───────────────────────────────────────────────────────────────

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: {
      primary:        '#2C4A36',
      textPrimary:    '#1A1A18',
      textSecondary:  '#3D3D3A',
      textMuted:      '#B1A89F',
      textOnPrimary:  '#F5EFE4',
      background:     '#F5EFE4',
      surface:        '#F1E8D5',
      border:         'rgba(176,141,87,0.2)',
    },
  }),
}));

// ─── Mock react-native-svg ────────────────────────────────────────────────────
// All SVG primitives are replaced with a pass-through View stub so tests run
// in the Jest environment without a native SVG renderer.

// ─── Mock side-effects of EmptyStateNoClients ────────────────────────────────
// The variant talks to coachApi.listInviteCodes() on mount, reads MMKV, and
// uses expo-clipboard. Stub these so the component renders deterministically
// in Jest without spinning up Expo native modules or hitting the network.

jest.mock('../../../services/api', () => ({
  coachApi: {
    listInviteCodes: jest.fn().mockResolvedValue({ data: [] }),
  },
}));

jest.mock('../../../storage/mmkv', () => ({
  prefsStorage: {
    getStringAsync: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(true),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));

jest.mock('react-native-svg', () => {
  // jest.mock factories are hoisted by babel-jest; safe to import from
  // jest-expo's React shim here.
  const ActualReact = jest.requireActual<typeof import('react')>('react');
  const { View: RNView } = jest.requireActual<typeof import('react-native')>('react-native');
  const Stub = ({ children }: { children?: React.ReactNode }) =>
    ActualReact.createElement(RNView, null, children);
  return {
    __esModule: true,
    default: Stub,
    Svg: Stub,
    Path: Stub,
    Circle: Stub,
    Line: Stub,
    Rect: Stub,
    G: Stub,
  };
});

// ─── Imports ──────────────────────────────────────────────────────────────────

import { EmptyState } from '../EmptyState';
import { EmptyStateNoClients } from '../EmptyStateNoClients';
import { EmptyStateNoWorkouts } from '../EmptyStateNoWorkouts';
import { EmptyStateNoData } from '../EmptyStateNoData';
import { EmptyStateNoResults } from '../EmptyStateNoResults';
import { EmptyStateOffline } from '../EmptyStateOffline';
import { IconChartEmpty } from '../icons';

// ─── Base EmptyState ───────────────────────────────────────────────────────────

describe('EmptyState — base component', () => {
  it('renders the headline', () => {
    const { getByTestId } = render(
      <EmptyState
        icon={<IconChartEmpty />}
        headline="Nothing here yet"
      />,
    );
    expect(getByTestId('empty-state-headline').props.children).toBe('Nothing here yet');
  });

  it('renders body text when provided', () => {
    const { getByTestId } = render(
      <EmptyState
        icon={<IconChartEmpty />}
        headline="Empty"
        body="Some supporting copy."
      />,
    );
    expect(getByTestId('empty-state-body').props.children).toBe('Some supporting copy.');
  });

  it('does NOT render body element when body is omitted', () => {
    const { queryByTestId } = render(
      <EmptyState icon={<IconChartEmpty />} headline="Empty" />,
    );
    expect(queryByTestId('empty-state-body')).toBeNull();
  });

  it('fires onCta when CTA button is pressed', () => {
    const onCta = jest.fn();
    const { getByTestId } = render(
      <EmptyState
        icon={<IconChartEmpty />}
        headline="Empty"
        ctaLabel="Get started"
        onCta={onCta}
      />,
    );
    fireEvent.press(getByTestId('empty-state-cta'));
    expect(onCta).toHaveBeenCalledTimes(1);
  });

  it('does NOT render a CTA when ctaLabel and onCta are absent', () => {
    const { queryByTestId } = render(
      <EmptyState icon={<IconChartEmpty />} headline="Empty" />,
    );
    expect(queryByTestId('empty-state-cta')).toBeNull();
  });

  it('CTA button has accessibilityRole="button"', () => {
    const { getByTestId } = render(
      <EmptyState
        icon={<IconChartEmpty />}
        headline="Empty"
        ctaLabel="Act"
        onCta={jest.fn()}
      />,
    );
    expect(getByTestId('empty-state-cta').props.accessibilityRole).toBe('button');
  });

  it('CTA button has accessibilityLabel matching ctaLabel', () => {
    const { getByTestId } = render(
      <EmptyState
        icon={<IconChartEmpty />}
        headline="Empty"
        ctaLabel="Invite client"
        onCta={jest.fn()}
      />,
    );
    expect(getByTestId('empty-state-cta').props.accessibilityLabel).toBe('Invite client');
  });
});

// ─── Variant: EmptyStateNoClients ─────────────────────────────────────────────

describe('EmptyStateNoClients', () => {
  it('renders the headline copy', async () => {
    const { findByTestId } = render(<EmptyStateNoClients />);
    const h = await findByTestId('empty-state-headline');
    expect(h.props.children).toBe('Your first client is one link away.');
  });

  it('fires onInvite when CTA pressed (notfound branch)', async () => {
    const onInvite = jest.fn();
    const { findByTestId } = render(<EmptyStateNoClients onInvite={onInvite} />);
    const cta = await findByTestId('empty-state-cta');
    fireEvent.press(cta);
    expect(onInvite).toHaveBeenCalledTimes(1);
  });
});

// ─── Variant: EmptyStateNoWorkouts ────────────────────────────────────────────

describe('EmptyStateNoWorkouts', () => {
  it('renders "No workouts yet" headline', () => {
    const { getByTestId } = render(<EmptyStateNoWorkouts />);
    expect(getByTestId('empty-state-headline').props.children).toBe('No workouts yet');
  });

  it('does not render a CTA (client cannot self-assign)', () => {
    const { queryByTestId } = render(<EmptyStateNoWorkouts />);
    expect(queryByTestId('empty-state-cta')).toBeNull();
  });
});

// ─── Variant: EmptyStateNoData ────────────────────────────────────────────────

describe('EmptyStateNoData', () => {
  it('renders default headline', () => {
    const { getByTestId } = render(<EmptyStateNoData />);
    expect(getByTestId('empty-state-headline').props.children).toBe('Nothing here yet');
  });

  it('renders custom headline when provided', () => {
    const { getByTestId } = render(<EmptyStateNoData headline="No progress data" />);
    expect(getByTestId('empty-state-headline').props.children).toBe('No progress data');
  });
});

// ─── Variant: EmptyStateNoResults ────────────────────────────────────────────

describe('EmptyStateNoResults', () => {
  it('renders "No results" headline', () => {
    const { getByTestId } = render(<EmptyStateNoResults query="bicep" />);
    expect(getByTestId('empty-state-headline').props.children).toBe('No results');
  });

  it('interpolates the query into body copy', () => {
    const { getByTestId } = render(<EmptyStateNoResults query="squat" />);
    const body = getByTestId('empty-state-body').props.children as string;
    expect(body).toContain('squat');
  });

  it('fires onClearSearch when CTA pressed', () => {
    const onClear = jest.fn();
    const { getByTestId } = render(
      <EmptyStateNoResults query="test" onClearSearch={onClear} />,
    );
    fireEvent.press(getByTestId('empty-state-cta'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

// ─── Variant: EmptyStateOffline ───────────────────────────────────────────────

describe('EmptyStateOffline', () => {
  it('renders "You are offline" headline', () => {
    const { getByTestId } = render(<EmptyStateOffline />);
    expect(getByTestId('empty-state-headline').props.children).toBe('You are offline');
  });

  it('renders "Try again" CTA when onRetry provided', () => {
    const onRetry = jest.fn();
    const { getByTestId } = render(<EmptyStateOffline onRetry={onRetry} />);
    fireEvent.press(getByTestId('empty-state-cta'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not render CTA when onRetry is absent', () => {
    const { queryByTestId } = render(<EmptyStateOffline />);
    expect(queryByTestId('empty-state-cta')).toBeNull();
  });
});
