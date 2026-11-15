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
  it('renders the preview line with N + audienceLabel + formatted date', async () => {
    const { getByTestId } = await render(<PushConfirmModal {...baseProps()} />);
    const text = getByTestId('push-confirm-preview').props.children as string;
    expect(text).toContain('Week 1 Program');
    expect(text).toContain('12');
    expect(text).toContain('active buyers');
    // formatFireAt → en-US weekday/month/day; 2999-09-01 is a Saturday.
    expect(text).toMatch(/September/);
  });

  it('falls back to a default audienceLabel when none is provided', async () => {
    const { getByTestId } = await render(
      <PushConfirmModal {...baseProps({ audienceLabel: undefined })} />,
    );
    expect(getByTestId('push-confirm-preview').props.children).toContain('buyers');
  });
});

describe('PushConfirmModal — confirm gating (error-prevention)', () => {
  it('confirm is DISABLED when fireAt is null', async () => {
    const { getByTestId } = await render(
      <PushConfirmModal {...baseProps({ fireAt: null })} />,
    );
    expect(getByTestId('push-confirm-submit').props.accessibilityState.disabled).toBe(
      true,
    );
  });

  it('confirm is DISABLED and empty-state shows when audienceCount === 0', async () => {
    const { getByTestId } = await render(
      <PushConfirmModal {...baseProps({ audienceCount: 0 })} />,
    );
    expect(getByTestId('push-confirm-submit').props.accessibilityState.disabled).toBe(
      true,
    );
    expect(getByTestId('push-confirm-empty')).toBeTruthy();
  });

  it('confirm is ENABLED with an audience and a future fireAt', async () => {
    const { getByTestId } = await render(<PushConfirmModal {...baseProps()} />);
    expect(getByTestId('push-confirm-submit').props.accessibilityState.disabled).toBe(
      false,
    );
  });

  it('submitting disables confirm', async () => {
    const { getByTestId } = await render(
      <PushConfirmModal {...baseProps({ submitting: true })} />,
    );
    expect(getByTestId('push-confirm-submit').props.accessibilityState.disabled).toBe(
      true,
    );
  });

  // R2 P1 defence-in-depth: a PAST `fireAt` arriving via props (not via the
  // picker) must NOT enable Confirm, using the same start-of-today basis as the
  // picker's minimumDate (`fireAt >= minimumDate` is required).
  it('confirm is DISABLED when a PAST fireAt is supplied via props', async () => {
    const past = new Date();
    past.setDate(past.getDate() - 1); // yesterday
    const { getByTestId } = await render(
      <PushConfirmModal {...baseProps({ fireAt: past })} />,
    );
    expect(getByTestId('push-confirm-submit').props.accessibilityState.disabled).toBe(
      true,
    );
  });

  it('pressing confirm with a PAST fireAt prop does NOT call onConfirm', async () => {
    const onConfirm = jest.fn();
    const past = new Date();
    past.setDate(past.getDate() - 1); // yesterday
    const { getByTestId } = await render(
      <PushConfirmModal {...baseProps({ onConfirm, fireAt: past })} />,
    );
    await fireEvent.press(getByTestId('push-confirm-submit'));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirm stays ENABLED for a future fireAt prop (no over-correction)', async () => {
    const future = new Date();
    future.setDate(future.getDate() + 7); // a week out
    const { getByTestId } = await render(
      <PushConfirmModal {...baseProps({ fireAt: future })} />,
    );
    expect(getByTestId('push-confirm-submit').props.accessibilityState.disabled).toBe(
      false,
    );
  });

  it('confirm is ENABLED when fireAt equals start-of-today (today or later basis)', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { getByTestId } = await render(
      <PushConfirmModal {...baseProps({ fireAt: today })} />,
    );
    expect(getByTestId('push-confirm-submit').props.accessibilityState.disabled).toBe(
      false,
    );
  });

  // R4 STALE-MIDNIGHT FIX (R2 P1): the past-date gate must re-derive
  // start-of-today on each render AND at confirm time, NOT memoize it once at
  // mount. Here a same-day `fireAt` is valid when the modal mounts, then the
  // wall clock advances past midnight (the chosen date is now "yesterday").
  //
  // This test proves the CALL-TIME hard guard in `handleConfirm` specifically.
  // The subtlety: if we rerendered FIRST, the render-time gate would already
  // have disabled the button, so `fireEvent.press` on a disabled
  // TouchableOpacity would no-op — and a mutant with the call-time guard
  // REMOVED would still "pass" (onConfirm never fires because the button is
  // disabled, not because of the guard). To actually exercise (and kill) that
  // mutant we must press Confirm while the button is STILL ENABLED from the
  // stale mount-time render — i.e. press AFTER advancing the clock but BEFORE
  // rerendering. Only the call-time re-derivation of start-of-today inside
  // `handleConfirm` can then stop onConfirm; removing it makes onConfirm fire
  // and this assertion fail.
  it('onConfirm is BLOCKED at call time when now crosses midnight before any rerender (kills no-call-time-guard mutant)', async () => {
    jest.useFakeTimers();
    try {
      // Mount "now" = mid-day on a fixed day; fireAt is later the SAME day.
      const mountNow = new Date('2025-06-15T12:00:00');
      jest.setSystemTime(mountNow);
      const fireAt = new Date('2025-06-15T18:00:00'); // valid at mount (today)
      const onConfirm = jest.fn();

      const { getByTestId } = await render(
        <PushConfirmModal {...baseProps({ fireAt, onConfirm })} />,
      );
      // Valid at mount: start-of-today is 2025-06-15 00:00 <= fireAt, so the
      // button is enabled and its captured press handler is "live".
      expect(
        getByTestId('push-confirm-submit').props.accessibilityState.disabled,
      ).toBe(false);

      // Advance the wall clock past midnight — it is now 2025-06-16, so the
      // previously-valid 2025-06-15 fireAt is now in the PAST. Crucially we do
      // NOT rerender, so the button is STILL rendered as enabled (the stale
      // mount-time render); fireEvent.press WILL invoke handleConfirm.
      jest.setSystemTime(new Date('2025-06-16T00:30:00'));
      expect(
        getByTestId('push-confirm-submit').props.accessibilityState.disabled,
      ).toBe(false);

      // CALL-TIME GUARD: pressing the still-enabled Confirm must NOT fire
      // onConfirm, because handleConfirm re-derives start-of-today at call time
      // and sees fireAt is now past. (Removing that guard => onConfirm fires =>
      // this fails: the mutant is killed.)
      await fireEvent.press(getByTestId('push-confirm-submit'));
      expect(onConfirm).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  // Companion to the above: the RENDER-TIME gate must also disable Confirm once
  // the component rerenders after the clock crosses midnight. A mount-time-
  // memoized minimumDate would (wrongly) keep the button enabled — this proves
  // the gate re-derives start-of-today on each render.
  it('confirm DISABLES on rerender after now advances past a same-day fireAt across midnight (render gate)', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2025-06-15T12:00:00'));
      const fireAt = new Date('2025-06-15T18:00:00'); // valid at mount (today)
      const onConfirm = jest.fn();

      const { getByTestId, rerender } = await render(
        <PushConfirmModal {...baseProps({ fireAt, onConfirm })} />,
      );
      expect(
        getByTestId('push-confirm-submit').props.accessibilityState.disabled,
      ).toBe(false);

      // Past midnight: the 2025-06-15 fireAt is now "yesterday".
      jest.setSystemTime(new Date('2025-06-16T00:30:00'));
      await rerender(<PushConfirmModal {...baseProps({ fireAt, onConfirm })} />);

      // Render-time gate must DISABLE Confirm against the FRESH start-of-today.
      expect(
        getByTestId('push-confirm-submit').props.accessibilityState.disabled,
      ).toBe(true);

      // And pressing the now-disabled button is a no-op (belt-and-braces).
      await fireEvent.press(getByTestId('push-confirm-submit'));
      expect(onConfirm).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('PushConfirmModal — date picker minimumDate (decision #6)', () => {
  it('passes minimumDate = start-of-today to the picker', async () => {
    await render(<PushConfirmModal {...baseProps()} />);
    expect(lastPicker.minimumDate).toBeInstanceOf(Date);
    const expected = new Date();
    expected.setHours(0, 0, 0, 0);
    expect(lastPicker.minimumDate?.getTime()).toBe(expected.getTime());
  });

  it('a past date selection does not propagate via onChangeFireAt', async () => {
    const onChangeFireAt = jest.fn();
    await render(<PushConfirmModal {...baseProps({ onChangeFireAt })} />);
    // Simulate the native picker emitting a past date (defence-in-depth: the
    // real picker physically blocks this via minimumDate, but the component
    // must also refuse to propagate it).
    const past = new Date('2000-01-01T00:00:00Z');
    lastPicker.onChange?.({ type: 'set' }, past);
    expect(onChangeFireAt).not.toHaveBeenCalled();
  });

  it('a valid future date selection propagates via onChangeFireAt', async () => {
    const onChangeFireAt = jest.fn();
    await render(<PushConfirmModal {...baseProps({ onChangeFireAt })} />);
    const future = new Date('2999-12-25T00:00:00Z');
    lastPicker.onChange?.({ type: 'set' }, future);
    expect(onChangeFireAt).toHaveBeenCalledWith(future);
  });

  it('a dismissed event does not propagate', async () => {
    const onChangeFireAt = jest.fn();
    await render(<PushConfirmModal {...baseProps({ onChangeFireAt })} />);
    lastPicker.onChange?.({ type: 'dismissed' }, undefined);
    expect(onChangeFireAt).not.toHaveBeenCalled();
  });
});

describe('PushConfirmModal — notify toggle (decision #9)', () => {
  it('reflects buyerNotify and fires onChangeBuyerNotify', async () => {
    const onChangeBuyerNotify = jest.fn();
    const { getByTestId } = await render(
      <PushConfirmModal {...baseProps({ buyerNotify: true, onChangeBuyerNotify })} />,
    );
    const sw = getByTestId('push-confirm-notify');
    expect(sw.props.value).toBe(true);
    await fireEvent(sw, 'valueChange', false);
    expect(onChangeBuyerNotify).toHaveBeenCalledWith(false);
  });
});

describe('PushConfirmModal — confirm / cancel actions', () => {
  it('onConfirm fires when confirm is enabled and pressed', async () => {
    const onConfirm = jest.fn();
    const { getByTestId } = await render(<PushConfirmModal {...baseProps({ onConfirm })} />);
    await fireEvent.press(getByTestId('push-confirm-submit'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('onConfirm does NOT fire when confirm is disabled (fireAt null)', async () => {
    const onConfirm = jest.fn();
    const { getByTestId } = await render(
      <PushConfirmModal {...baseProps({ onConfirm, fireAt: null })} />,
    );
    await fireEvent.press(getByTestId('push-confirm-submit'));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('onCancel fires when cancel is pressed', async () => {
    const onCancel = jest.fn();
    const { getByTestId } = await render(<PushConfirmModal {...baseProps({ onCancel })} />);
    await fireEvent.press(getByTestId('push-confirm-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
