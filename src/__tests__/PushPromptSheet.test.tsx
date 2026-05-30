// src/__tests__/PushPromptSheet.test.tsx
//
// PR-17 M3 — PushPromptSheet (the "prompt each time" bottom sheet).
//
// Covers the M3 acceptance surface:
//   • renders when `visible`, hidden when not
//   • fires onPushExisting / onFutureOnly / onDismiss on the right presses
//   • weaves the contentTitle into the warm copy
//   • each mode variant renders its own explainer copy
//   • optional audienceHint renders only when provided
//
// RTL-only: mounts the sheet directly and drives it through props/interactions.

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// Minimal semantic-token map matching SemanticTokens — the sheet reads
// `semanticColors` off useTheme(). The forest/bone/ink brand tokens it also
// uses come from the real ../theme/tokens module (not mocked here).
const SEMANTIC_COLORS = {
  bgPrimary: '#F5EFE4',
  bgSurface: '#FFFDF8',
  textPrimary: '#1A1A18',
  textMuted: '#78736E',
  accent: '#4A0404',
  border: '#DCD5CC',
};

jest.mock('../theme/useTheme', () => ({
  useTheme: () => ({ semanticColors: SEMANTIC_COLORS }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import {
  PushPromptSheet,
  PushPromptSheetProps,
  PushPromptMode,
} from '../screens/coach/payments/contents/PushPromptSheet';

function baseProps(over: Partial<PushPromptSheetProps> = {}): PushPromptSheetProps {
  return {
    visible: true,
    contentTitle: 'Week 1 Program',
    mode: 'new_content',
    onPushExisting: jest.fn(),
    onFutureOnly: jest.fn(),
    onDismiss: jest.fn(),
    ...over,
  };
}

describe('PushPromptSheet — visibility', () => {
  it('renders the sheet and its choices when visible', () => {
    const { getByTestId } = render(<PushPromptSheet {...baseProps()} />);
    expect(getByTestId('push-prompt-sheet')).toBeTruthy();
    expect(getByTestId('push-prompt-existing')).toBeTruthy();
    expect(getByTestId('push-prompt-future')).toBeTruthy();
    expect(getByTestId('push-prompt-dismiss')).toBeTruthy();
  });

  it('does not render sheet content when not visible', () => {
    // RN <Modal visible={false}> renders nothing of its children.
    const { queryByTestId } = render(
      <PushPromptSheet {...baseProps({ visible: false })} />,
    );
    expect(queryByTestId('push-prompt-existing')).toBeNull();
    expect(queryByTestId('push-prompt-future')).toBeNull();
  });
});

describe('PushPromptSheet — choice handlers', () => {
  it('fires onPushExisting when the primary button is pressed', () => {
    const onPushExisting = jest.fn();
    const { getByTestId } = render(
      <PushPromptSheet {...baseProps({ onPushExisting })} />,
    );
    fireEvent.press(getByTestId('push-prompt-existing'));
    expect(onPushExisting).toHaveBeenCalledTimes(1);
  });

  it('fires onFutureOnly when the secondary button is pressed', () => {
    const onFutureOnly = jest.fn();
    const { getByTestId } = render(
      <PushPromptSheet {...baseProps({ onFutureOnly })} />,
    );
    fireEvent.press(getByTestId('push-prompt-future'));
    expect(onFutureOnly).toHaveBeenCalledTimes(1);
  });

  it('fires onDismiss from the close affordance', () => {
    const onDismiss = jest.fn();
    const { getByTestId } = render(
      <PushPromptSheet {...baseProps({ onDismiss })} />,
    );
    fireEvent.press(getByTestId('push-prompt-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not cross-fire handlers (one choice = one callback)', () => {
    const onPushExisting = jest.fn();
    const onFutureOnly = jest.fn();
    const onDismiss = jest.fn();
    const { getByTestId } = render(
      <PushPromptSheet
        {...baseProps({ onPushExisting, onFutureOnly, onDismiss })}
      />,
    );
    fireEvent.press(getByTestId('push-prompt-existing'));
    expect(onPushExisting).toHaveBeenCalledTimes(1);
    expect(onFutureOnly).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('PushPromptSheet — copy', () => {
  it('weaves the contentTitle into the explainer copy', () => {
    const { getByText } = render(
      <PushPromptSheet {...baseProps({ contentTitle: 'Strength Block' })} />,
    );
    // The title appears (in curly quotes) within the explainer line.
    expect(getByText(/Strength Block/)).toBeTruthy();
  });

  it('renders the fixed warm title', () => {
    const { getByText } = render(<PushPromptSheet {...baseProps()} />);
    expect(getByText('Share this update?')).toBeTruthy();
  });

  it('falls back to neutral phrasing when contentTitle is blank', () => {
    const { getByText } = render(
      <PushPromptSheet {...baseProps({ contentTitle: '   ' })} />,
    );
    // The explainer line (distinct from the fixed title) uses the neutral
    // "this update" phrasing when no title is supplied.
    expect(getByText(/Send this update to the buyers who already own/i)).toBeTruthy();
  });

  const modeCases: Array<{ mode: PushPromptMode; matcher: RegExp }> = [
    { mode: 'new_content', matcher: /Send .* to the buyers who already own/i },
    { mode: 'cadence_edit', matcher: /Apply the new timing/i },
    { mode: 'full_edit', matcher: /Share your changes/i },
  ];

  modeCases.forEach(({ mode, matcher }) => {
    it(`renders mode-specific copy for "${mode}"`, () => {
      const { getByText } = render(
        <PushPromptSheet {...baseProps({ mode })} />,
      );
      expect(getByText(matcher)).toBeTruthy();
    });
  });
});

describe('PushPromptSheet — optional audienceHint', () => {
  it('renders the audienceHint when provided', () => {
    const { getByTestId } = render(
      <PushPromptSheet
        {...baseProps({ audienceHint: '12 buyers already own this' })}
      />,
    );
    expect(getByTestId('push-prompt-audience-hint')).toBeTruthy();
  });

  it('omits the audienceHint node when not provided', () => {
    const { queryByTestId } = render(<PushPromptSheet {...baseProps()} />);
    expect(queryByTestId('push-prompt-audience-hint')).toBeNull();
  });
});
