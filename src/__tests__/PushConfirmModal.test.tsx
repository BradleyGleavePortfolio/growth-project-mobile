// src/__tests__/PushConfirmModal.test.tsx
//
// PR-17 M4 — PushConfirmModal tests.
//
// Covers the graded UI Bible behaviours from PR17_M4_BRIEF.md:
//   - preview line renders N + audienceLabel + the formatted fire date;
//   - confirm DISABLED when fireAt is null OR audienceCount === 0 (and the
//     calm empty-state shows for a zero audience);
//   - date picker carries minimumDate = today so PAST dates are un-selectable
//     (error-prevention, decision #6) — an attempted past selection does not
//     enable confirm / does not propagate;
//   - the notify toggle reflects `buyerNotify` and fires onChangeBuyerNotify;
//   - onConfirm / onCancel fire on the right presses;
//   - `submitting` disables confirm.
//
// RTL-only: mounts the modal directly and drives it through props + interactions.

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

const SEMANTIC_COLORS = {
  bgPrimary: '#F5EFE4',
  bgSurface: '#FFFDF8',
  textPrimary: '#1A1A18',
  textMuted: '#78736E',
  accent: '#4A0404',
  border: '#DCD5CC',
};

jest.mock('../theme/useTheme', () => ({
  useTheme: () => ({ semanticColors: SEMANTIC_COLORS, colors: SEMANTIC_COLORS }),
}));

jest.mock('../utils/haptics', () => ({
  lightTap: jest.fn(),
  mediumTap: jest.fn(),
  warningTap: jest.fn(),
  successTap: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => {
  const React2 = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, ...rest }: { children?: React.ReactNode }) =>
      React2.createElement(View, rest, children),
    SafeAreaProvider: ({ children }: { children?: React.ReactNode }) =>
      React2.createElement(View, null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

// Mock the native date picker with a controllable harness: it exposes its
// `minimumDate` via a testID prop and lets a test simulate a "set" event with
// an arbitrary date (including a past one) by invoking the captured onChange.
let lastPicker: {
  minimumDate?: Date;
  onChange?: (event: unknown, date?: Date) => void;
} = {};
jest.mock('@react-native-community/datetimepicker', () => {
  const React2 = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: { minimumDate?: Date; onChange?: (e: unknown, d?: Date) => void }) => {
      lastPicker = { minimumDate: props.minimumDate, onChange: props.onChange };
      return React2.createElement(View, { testID: 'mock-datetimepicker' });
    },
  };
});

import PushConfirmModal, {
  PushConfirmModalProps,
} from '../screens/coach/payments/contents/PushConfirmModal';

function baseProps(over: Partial<PushConfirmModalProps> = {}): PushConfirmModalProps {
  return {
    visible: true,
    contentTitle: 'Week 1 Program',
    audienceCount: 12,
    audienceLabel: 'active buyers',
    buyerNotify: true,
    onChangeBuyerNotify: jest.fn(),
    fireAt: new Date('2999-09-01T09:00:00Z'),
    onChangeFireAt: jest.fn(),
    onConfirm: jest.fn(),
    onCancel: jest.fn(),
    submitting: false,
    ...over,
  };
}

beforeEach(() => {
  lastPicker = {};
});

describe('PushConfirmModal — preview copy (decision #10)', () => {
  it('renders the preview line with N + audienceLabel + formatted date', () => {
    const { getByTestId } = render(<PushConfirmModal {...baseProps()} />);
    const text = getByTestId('push-confirm-preview').props.children as string;
    expect(text).toContain('Week 1 Program');
    expect(text).toContain('12');
    expect(text).toContain('active buyers');
    // formatFireAt → en-US weekday/month/day; 2999-09-01 is a Saturday.
    expect(text).toMatch(/September/);
  });

  it('falls back to a default audienceLabel when none is provided', () => {
    const { getByTestId } = render(
      <PushConfirmModal {...baseProps({ audienceLabel: undefined })} />,
    );
    expect(getByTestId('push-confirm-preview').props.children).toContain('buyers');
  });
});

describe('PushConfirmModal — confirm gating (error-prevention)', () => {
  it('confirm is DISABLED when fireAt is null', () => {
    const { getByTestId } = render(
      <PushConfirmModal {...baseProps({ fireAt: null })} />,
    );
    expect(getByTestId('push-confirm-submit').props.accessibilityState.disabled).toBe(
      true,
    );
  });

  it('confirm is DISABLED and empty-state shows when audienceCount === 0', () => {
    const { getByTestId } = render(
      <PushConfirmModal {...baseProps({ audienceCount: 0 })} />,
    );
    expect(getByTestId('push-confirm-submit').props.accessibilityState.disabled).toBe(
      true,
    );
    expect(getByTestId('push-confirm-empty')).toBeTruthy();
  });

  it('confirm is ENABLED with an audience and a future fireAt', () => {
    const { getByTestId } = render(<PushConfirmModal {...baseProps()} />);
    expect(getByTestId('push-confirm-submit').props.accessibilityState.disabled).toBe(
      false,
    );
  });

  it('submitting disables confirm', () => {
    const { getByTestId } = render(
      <PushConfirmModal {...baseProps({ submitting: true })} />,
    );
    expect(getByTestId('push-confirm-submit').props.accessibilityState.disabled).toBe(
      true,
    );
  });
});

describe('PushConfirmModal — date picker minimumDate (decision #6)', () => {
  it('passes minimumDate = start-of-today to the picker', () => {
    render(<PushConfirmModal {...baseProps()} />);
    expect(lastPicker.minimumDate).toBeInstanceOf(Date);
    const expected = new Date();
    expected.setHours(0, 0, 0, 0);
    expect(lastPicker.minimumDate?.getTime()).toBe(expected.getTime());
  });

  it('a past date selection does not propagate via onChangeFireAt', () => {
    const onChangeFireAt = jest.fn();
    render(<PushConfirmModal {...baseProps({ onChangeFireAt })} />);
    // Simulate the native picker emitting a past date (defence-in-depth: the
    // real picker physically blocks this via minimumDate, but the component
    // must also refuse to propagate it).
    const past = new Date('2000-01-01T00:00:00Z');
    lastPicker.onChange?.({ type: 'set' }, past);
    expect(onChangeFireAt).not.toHaveBeenCalled();
  });

  it('a valid future date selection propagates via onChangeFireAt', () => {
    const onChangeFireAt = jest.fn();
    render(<PushConfirmModal {...baseProps({ onChangeFireAt })} />);
    const future = new Date('2999-12-25T00:00:00Z');
    lastPicker.onChange?.({ type: 'set' }, future);
    expect(onChangeFireAt).toHaveBeenCalledWith(future);
  });

  it('a dismissed event does not propagate', () => {
    const onChangeFireAt = jest.fn();
    render(<PushConfirmModal {...baseProps({ onChangeFireAt })} />);
    lastPicker.onChange?.({ type: 'dismissed' }, undefined);
    expect(onChangeFireAt).not.toHaveBeenCalled();
  });
});

describe('PushConfirmModal — notify toggle (decision #9)', () => {
  it('reflects buyerNotify and fires onChangeBuyerNotify', () => {
    const onChangeBuyerNotify = jest.fn();
    const { getByTestId } = render(
      <PushConfirmModal {...baseProps({ buyerNotify: true, onChangeBuyerNotify })} />,
    );
    const sw = getByTestId('push-confirm-notify');
    expect(sw.props.value).toBe(true);
    fireEvent(sw, 'valueChange', false);
    expect(onChangeBuyerNotify).toHaveBeenCalledWith(false);
  });
});

describe('PushConfirmModal — confirm / cancel actions', () => {
  it('onConfirm fires when confirm is enabled and pressed', () => {
    const onConfirm = jest.fn();
    const { getByTestId } = render(<PushConfirmModal {...baseProps({ onConfirm })} />);
    fireEvent.press(getByTestId('push-confirm-submit'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('onConfirm does NOT fire when confirm is disabled (fireAt null)', () => {
    const onConfirm = jest.fn();
    const { getByTestId } = render(
      <PushConfirmModal {...baseProps({ onConfirm, fireAt: null })} />,
    );
    fireEvent.press(getByTestId('push-confirm-submit'));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('onCancel fires when cancel is pressed', () => {
    const onCancel = jest.fn();
    const { getByTestId } = render(<PushConfirmModal {...baseProps({ onCancel })} />);
    fireEvent.press(getByTestId('push-confirm-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
