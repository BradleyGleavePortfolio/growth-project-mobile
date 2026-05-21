/**
 * EmptyState component library — unit + interaction tests.
 *
 * Coverage:
 *  1. Base EmptyState renders headline text.
 *  2. Base EmptyState renders body text when provided.
 *  3. Base EmptyState does NOT render body when omitted.
 *  4. CTA button fires onCta when pressed.
 *  5. No CTA button rendered when ctaLabel / onCta are absent.
 *  6. EmptyStateNoWorkouts renders expected headline, no CTA.
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
// EmptyStateNoClients was rewritten in 8cbde42 (security hardening v1) from a
// thin wrapper over the base EmptyState into a richer invite-code surface
// (MMKV-hydrated invite code + share / copy actions + Settings-nudge fallback).
// It no longer renders the base EmptyState's `empty-state-headline` /
// `empty-state-cta` testIDs. The old assertions here tested a contract that no
// longer exists. Wiring of the onInvite prop into the screen is covered by
// src/screens/coach/__tests__/InviteCtaWiring.test.ts; the new component's
// internal testIDs (`invite-code-block`, `share-code-btn`,
// `empty-no-clients-settings-btn`, …) are the contract the screen tests
// against now.

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
