import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { z } from 'zod';
import RomanAdjustmentCard from '../RomanAdjustmentCard';
import RomanAdjustmentsSection from '../RomanAdjustmentsSection';
import { ADJUST_CLIENT_UNDO_SECONDS, ADJUST_ERROR_FALLBACKS, adjustErrorView } from '../romanAdjustCopy';
import type { RomanAdjustment } from '../../../../api/romanAdjustApi';
import { captureError } from '../../../../services/sentry';

jest.mock('../../../../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../../../../ui/haptics/haptics.service', () => ({
  HapticService: {
    selection: jest.fn(async () => undefined),
    success: jest.fn(async () => undefined),
    warning: jest.fn(async () => undefined),
  },
}));

const NOW = Date.parse('2026-10-02T16:00:00Z');

function proposal(over: Partial<RomanAdjustment> = {}): RomanAdjustment {
  return {
    id: 'p1',
    status: 'pending',
    severity: 'moderate',
    roman_text:
      "Maya's recovery has dipped. Heart-rate variability is 18% below the usual and sleep has averaged 5.6 hours over the last 3 nights. I suggest trimming tomorrow's Lower Body A by 15%, from 18 to 15 sets. Reps and loads stay as you set them. Shall I apply it?",
    client: { id: 'c1', first_name: 'Maya' },
    workout: { assignment_id: 'a1', plan_name: 'Lower Body A', scheduled_for: '2026-10-03T16:00:00Z' },
    signals: [
      { key: 'hrv_drop', marked: false, value: 18, baseline: 60 },
      { key: 'short_sleep', marked: false, value: 5.6, baseline: null },
    ],
    proposed_change: {
      volume_pct: 15,
      sets_before: 18,
      sets_after: 15,
      exercises: [
        { order: 0, exercise_external_id: 'back-squat', sets_before: 5, sets_after: 4 },
        { order: 1, exercise_external_id: 'ex-x', sets_before: 4, sets_after: 3 },
      ],
    },
    applied_change: null,
    exercise_names: { 'back-squat': 'Back squat' },
    created_at: '2026-10-02T15:00:00Z',
    decided_at: null,
    undo_until: null,
    ...over,
  };
}

function applied(): RomanAdjustment {
  const p = proposal();
  return { ...p, status: 'approved', applied_change: p.proposed_change, decided_at: '2026-10-02T16:00:05Z', undo_until: '2026-10-02T16:10:05Z' };
}

function httpError(status: number, data?: unknown, headers?: Record<string, string>) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status, data, headers: headers ?? {} } });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.mocked(captureError).mockClear();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('RomanAdjustmentCard', () => {
  it("shows Roman's sentence, the evidence and the exact change; names fall back gracefully", async () => {
    const r = await render(<RomanAdjustmentCard proposal={proposal()} onSettled={jest.fn()} onChanged={jest.fn()} deps={{ now: () => NOW }} />);
    expect(r.getByText(/Maya's recovery has dipped/)).toBeTruthy();
    expect(r.getByText('HRV 18% below usual')).toBeTruthy();
    expect(r.getByText('Sleep 5.6 h a night')).toBeTruthy();
    expect(r.getByText('18 to 15 sets, 15% less volume')).toBeTruthy();
    await fireEvent.press(r.getByTestId('roman-adjust-card-summary'));
    expect(r.getByText('Back squat')).toBeTruthy();
    expect(r.getByText('Exercise 2')).toBeTruthy();
  });

  it('Approve waits the undo window before sending; Undo inside it sends nothing', async () => {
    const approve = jest.fn(async () => applied());
    const r = await render(<RomanAdjustmentCard proposal={proposal()} onSettled={jest.fn()} onChanged={jest.fn()} deps={{ approve, now: () => NOW }} />);
    await fireEvent.press(r.getByTestId('roman-adjust-card-approve'));
    expect(r.getByText(`Applying in ${ADJUST_CLIENT_UNDO_SECONDS} s.`)).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    await fireEvent.press(r.getByTestId('roman-adjust-card-undo-local'));
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(approve).not.toHaveBeenCalled();
    expect(r.getByTestId('roman-adjust-card-approve')).toBeTruthy();
  });

  it('Approve sends after the window and reports the new version', async () => {
    const approve = jest.fn(async () => applied());
    const onChanged = jest.fn();
    const r = await render(<RomanAdjustmentCard proposal={proposal()} onSettled={jest.fn()} onChanged={onChanged} deps={{ approve, now: () => NOW }} />);
    await fireEvent.press(r.getByTestId('roman-adjust-card-approve'));
    await act(async () => {
      jest.advanceTimersByTime(ADJUST_CLIENT_UNDO_SECONDS * 1000);
    });
    await waitFor(() => expect(approve).toHaveBeenCalledWith('p1'));
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' }));
  });

  it('an applied card offers the server undo while the window is open', async () => {
    const undo = jest.fn(async () => ({ ...applied(), status: 'undone' as const }));
    const onSettled = jest.fn();
    const r = await render(<RomanAdjustmentCard proposal={applied()} onSettled={onSettled} onChanged={jest.fn()} deps={{ undo, now: () => NOW + 60_000 }} />);
    expect(r.getByText('Applied. Maya will see 15 sets instead of 18.')).toBeTruthy();
    await fireEvent.press(r.getByTestId('roman-adjust-card-undo-server'));
    expect(undo).toHaveBeenCalledWith('p1');
    expect(onSettled).toHaveBeenCalledWith('p1', { refresh: false });
  });

  it('after the server window closes there is no Undo button', async () => {
    const r = await render(<RomanAdjustmentCard proposal={applied()} onSettled={jest.fn()} onChanged={jest.fn()} deps={{ now: () => NOW + 11 * 60_000 }} />);
    expect(r.queryByTestId('roman-adjust-card-undo-server')).toBeNull();
  });

  it('Edit with per-exercise steppers sends explicit set counts', async () => {
    const edit = jest.fn(async () => ({ ...applied(), status: 'edited' as const }));
    const r = await render(<RomanAdjustmentCard proposal={proposal()} onSettled={jest.fn()} onChanged={jest.fn()} deps={{ edit, now: () => NOW }} />);
    await fireEvent.press(r.getByTestId('roman-adjust-card-edit-open'));
    await fireEvent.press(r.getByTestId('roman-adjust-card-minus-0'));
    await fireEvent.press(r.getByTestId('roman-adjust-card-minus-0'));
    await fireEvent.press(r.getByTestId('roman-adjust-card-save'));
    await act(async () => {
      jest.advanceTimersByTime(ADJUST_CLIENT_UNDO_SECONDS * 1000);
    });
    await waitFor(() => expect(edit).toHaveBeenCalledWith('p1', { sets: [{ order: 0, sets: 3 }] }));
  });

  it('Edit with a percentage chip sends that percentage', async () => {
    const edit = jest.fn(async () => ({ ...applied(), status: 'edited' as const }));
    const r = await render(<RomanAdjustmentCard proposal={proposal()} onSettled={jest.fn()} onChanged={jest.fn()} deps={{ edit, now: () => NOW }} />);
    await fireEvent.press(r.getByTestId('roman-adjust-card-edit-open'));
    await fireEvent.press(r.getByTestId('roman-adjust-card-pct-25'));
    await fireEvent.press(r.getByTestId('roman-adjust-card-save'));
    await act(async () => {
      jest.advanceTimersByTime(ADJUST_CLIENT_UNDO_SECONDS * 1000);
    });
    await waitFor(() => expect(edit).toHaveBeenCalledWith('p1', { volume_pct: 25 }));
  });

  it('Dismiss asks why, then waits the window, then settles the card', async () => {
    const dismiss = jest.fn(async () => ({ ...proposal(), status: 'dismissed' as const }));
    const onSettled = jest.fn();
    const r = await render(<RomanAdjustmentCard proposal={proposal()} onSettled={onSettled} onChanged={jest.fn()} deps={{ dismiss, now: () => NOW }} />);
    await fireEvent.press(r.getByTestId('roman-adjust-card-dismiss'));
    await fireEvent.press(r.getByTestId('roman-adjust-card-reason-client_feels_fine'));
    expect(r.getByText(`Dismissing in ${ADJUST_CLIENT_UNDO_SECONDS} s.`)).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(ADJUST_CLIENT_UNDO_SECONDS * 1000);
    });
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith('p1', 'client_feels_fine'));
    expect(onSettled).toHaveBeenCalledWith('p1', { refresh: false });
  });

  it('a settled refusal (workout started) shows the server copy and asks the list to refresh', async () => {
    const msg = ADJUST_ERROR_FALLBACKS.ADJUSTMENT_WORKOUT_STARTED;
    const approve = jest.fn(async () => {
      throw httpError(409, { code: 'ADJUSTMENT_WORKOUT_STARTED', message: msg });
    });
    const onSettled = jest.fn();
    const r = await render(<RomanAdjustmentCard proposal={proposal()} onSettled={onSettled} onChanged={jest.fn()} deps={{ approve, now: () => NOW }} />);
    await fireEvent.press(r.getByTestId('roman-adjust-card-approve'));
    await act(async () => {
      jest.advanceTimersByTime(ADJUST_CLIENT_UNDO_SECONDS * 1000);
    });
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith('p1', { refresh: true, notice: msg }));
  });

  it('a refused, retryable request (429) keeps the card, shows specific copy and the actions again', async () => {
    const approve = jest.fn(async () => {
      throw httpError(429);
    });
    const onSettled = jest.fn();
    const r = await render(<RomanAdjustmentCard proposal={proposal()} onSettled={onSettled} onChanged={jest.fn()} deps={{ approve, now: () => NOW }} />);
    await fireEvent.press(r.getByTestId('roman-adjust-card-approve'));
    await act(async () => {
      jest.advanceTimersByTime(ADJUST_CLIENT_UNDO_SECONDS * 1000);
    });
    await waitFor(() => expect(r.getByTestId('roman-adjust-card-error')).toBeTruthy());
    expect(r.getByText(/Too many changes in a short time/)).toBeTruthy();
    expect(r.getByTestId('roman-adjust-card-approve')).toBeTruthy();
    expect(onSettled).not.toHaveBeenCalled();
  });

  // B-337-2 (Opus) / B-337-3 (Sol): a lost reply after Approve may still have been applied.
  it('a lost Approve reply does not say the workout is unchanged and asks the list to reload', async () => {
    const approve = jest.fn(async () => {
      throw Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED', request: {} });
    });
    const onSettled = jest.fn();
    const r = await render(<RomanAdjustmentCard proposal={proposal()} onSettled={onSettled} onChanged={jest.fn()} deps={{ approve, now: () => NOW }} />);
    await fireEvent.press(r.getByTestId('roman-adjust-card-approve'));
    await act(async () => {
      jest.advanceTimersByTime(ADJUST_CLIENT_UNDO_SECONDS * 1000);
    });
    await waitFor(() => expect(onSettled).toHaveBeenCalled());
    const [id, opts] = onSettled.mock.calls[0];
    expect(id).toBe('p1');
    expect(opts.refresh).toBe(true);
    expect(opts.notice).toMatch(/not certain whether the change was applied/);
    expect(opts.notice).not.toMatch(/unchanged/i);
  });

  it('a lost server Undo reply does not claim either outcome and asks the list to reload', async () => {
    const undo = jest.fn(async () => {
      throw new Error('Network Error');
    });
    const onSettled = jest.fn();
    const r = await render(<RomanAdjustmentCard proposal={applied()} onSettled={onSettled} onChanged={jest.fn()} deps={{ undo, now: () => NOW + 60_000 }} />);
    await fireEvent.press(r.getByTestId('roman-adjust-card-undo-server'));
    await waitFor(() => expect(onSettled).toHaveBeenCalled());
    expect(onSettled.mock.calls[0][1]).toEqual({ refresh: true, notice: expect.stringMatching(/not certain whether the change was undone/) });
  });
});

describe('adjustErrorView', () => {
  it('known codes use the server message, or the local fallback when it is missing', () => {
    expect(adjustErrorView(httpError(409, { code: 'ADJUSTMENT_WORKOUT_CHANGED', message: 'Server copy.' }), 'approve')).toEqual({
      code: 'ADJUSTMENT_WORKOUT_CHANGED',
      message: 'Server copy.',
      refresh: true,
    });
    expect(adjustErrorView(httpError(409, { code: 'ADJUSTMENT_UNDO_EXPIRED' }), 'undo')).toEqual({
      code: 'ADJUSTMENT_UNDO_EXPIRED',
      message: ADJUST_ERROR_FALLBACKS.ADJUSTMENT_UNDO_EXPIRED,
      refresh: false,
    });
  });

  it('no response on Dismiss: connection copy, no Sentry noise', () => {
    const v = adjustErrorView(new Error('Network Error'), 'dismiss');
    expect(v.message).toBe('The server could not be reached to dismiss the suggestion. Your workouts are unchanged. Check your connection, then try again.');
    expect(v.refresh).toBe(false);
    expect(captureError).not.toHaveBeenCalled();
  });

  // B-337-2 (Opus) / B-337-3 (Sol): no outcome claim for a change request without a coded refusal.
  const zodAfter2xx = () => z.object({ id: z.string() }).safeParse({}).error as z.ZodError;
  const timeout = () => Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED', request: {} });
  it.each([
    ['timeout', 'approve', timeout()],
    ['timeout', 'edit', timeout()],
    ['timeout', 'undo', timeout()],
    ['500', 'approve', httpError(500, { statusCode: 500, message: 'Internal server error' })],
    ['502', 'edit', httpError(502)],
    ['503', 'undo', httpError(503)],
    ['unreadable 2xx reply', 'approve', zodAfter2xx()],
    ['unreadable 2xx reply', 'edit', zodAfter2xx()],
  ] as const)('%s on %s: says the result is not confirmed and reloads the list', (_label, action, err) => {
    const v = adjustErrorView(err, action);
    expect(v.message).not.toMatch(/unchanged/i);
    expect(v.message).toMatch(/not certain whether/);
    expect(v.refresh).toBe(true);
    expect(v.code).toBeNull();
  });

  it('a coded refusal or a 4xx still says the workouts are unchanged where that is true', () => {
    expect(adjustErrorView(httpError(400), 'approve').message).toMatch(/Your workouts are unchanged/);
    expect(adjustErrorView(httpError(400), 'approve').refresh).toBe(false);
    expect(adjustErrorView(httpError(502), 'dismiss').message).toMatch(/Your workouts are unchanged/);
  });

  it('a failed load never claims anything about the workouts', () => {
    for (const err of [new Error('Network Error'), httpError(500), httpError(503, { code: 'ADJUSTMENTS_UNAVAILABLE' }), zodAfter2xx()]) {
      expect(adjustErrorView(err, 'load').message).not.toMatch(/unchanged/i);
    }
  });

  // A-337-1 (Sol): the raw ZodError text quotes the received values; only a fixed message goes to Sentry.
  it('contract drift sends a fixed error to Sentry, never the ZodError or its received values', () => {
    const drift = z.object({ key: z.enum(['hrv_drop']) }).safeParse({ key: 'sleep 3.1 h, HRV 22' }).error as z.ZodError;
    adjustErrorView(drift, 'approve');
    expect(captureError).toHaveBeenCalledTimes(1);
    const [sent, extras] = jest.mocked(captureError).mock.calls[0];
    expect(sent).not.toBeInstanceOf(z.ZodError);
    expect(JSON.stringify([String(sent), extras])).not.toContain('sleep 3.1');
  });

  it('an unrecognised response code is not forwarded to Sentry unless it is a plain code', () => {
    adjustErrorView(httpError(500, { code: 'maya@example.com 5.6 h' }), 'load');
    adjustErrorView(httpError(500, { code: 'SOME_NEW_CODE' }), 'load');
    const calls = jest.mocked(captureError).mock.calls;
    expect(calls[0][0]).not.toHaveProperty('response');
    expect(calls[0][1]).toEqual({ where: 'roman_adjust.load', status: 500, code: undefined });
    expect(calls[1][1]).toEqual({ where: 'roman_adjust.load', status: 500, code: 'SOME_NEW_CODE' });
  });

  // B-655-2 mirror: a changed workout gets no new suggestion, so the copy must not promise one.
  it('the workout-changed fallback does not promise a new suggestion', () => {
    expect(ADJUST_ERROR_FALLBACKS.ADJUSTMENT_WORKOUT_CHANGED).not.toMatch(/new suggestion/i);
  });

  it('unknown 500: reference + support path + Sentry without the response body', () => {
    const v = adjustErrorView(httpError(500, { message: 'boom maya@example.com' }, { 'x-request-id': 'abcd1234-ef56-7890' }), 'edit');
    expect(v.message).toMatch(/quote reference abcd1234\.$/);
    expect(v.message).toMatch(/contact .+@/);
    expect(v.message).not.toContain('boom');
    expect(v.message).not.toMatch(/unchanged/i);
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), { where: 'roman_adjust.edit', status: 500, code: undefined });
    expect(String(jest.mocked(captureError).mock.calls[0][0])).not.toContain('boom');
  });

  it('contract drift is reported and explained', () => {
    const err = (() => {
      try {
        z.object({ a: z.string() }).parse({});
      } catch (e) {
        return e;
      }
      return null;
    })();
    const v = adjustErrorView(err, 'load');
    expect(v.message).toMatch(/could not read the reply/);
    expect(captureError).toHaveBeenCalled();
  });

  it('every message follows the house voice', () => {
    const all = [
      ...Object.values(ADJUST_ERROR_FALLBACKS),
      adjustErrorView(new Error('x'), 'undo').message,
      adjustErrorView(httpError(401), 'load').message,
      adjustErrorView(httpError(403), 'load').message,
      adjustErrorView(httpError(429), 'load').message,
      adjustErrorView(httpError(502), 'dismiss').message,
    ];
    for (const m of all) expect(m).not.toMatch(/!|\bwe\b|\bus\b|something went wrong|oops/i);
  });
});

describe('RomanAdjustmentsSection', () => {
  it('kill switch off (enabled false): renders nothing', async () => {
    const load = jest.fn(async () => ({ enabled: false, proposals: [] }));
    const r = await render(<RomanAdjustmentsSection load={load} />);
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(r.queryByTestId('roman-adjust-section')).toBeNull();
  });

  it('lists suggestions; a settled refusal removes the card and keeps the reason on screen', async () => {
    jest.useRealTimers();
    const msg = ADJUST_ERROR_FALLBACKS.ADJUSTMENT_WORKOUT_STARTED;
    const load = jest
      .fn()
      .mockResolvedValueOnce({ enabled: true, proposals: [proposal()] })
      .mockResolvedValue({ enabled: true, proposals: [] });
    const approve = jest.fn(async () => {
      throw httpError(409, { code: 'ADJUSTMENT_WORKOUT_STARTED', message: msg });
    });
    const r = await render(<RomanAdjustmentsSection load={load} deps={{ approve, now: () => NOW }} />);
    await waitFor(() => expect(r.getByTestId('roman-adjust-card-p1')).toBeTruthy());
    jest.useFakeTimers();
    await fireEvent.press(r.getByTestId('roman-adjust-card-p1-approve'));
    await act(async () => {
      jest.advanceTimersByTime(ADJUST_CLIENT_UNDO_SECONDS * 1000);
    });
    jest.useRealTimers();
    await waitFor(() => expect(r.getByTestId('roman-adjust-section-notice')).toBeTruthy());
    expect(r.getByText(msg)).toBeTruthy();
    expect(r.queryByTestId('roman-adjust-card-p1')).toBeNull();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it('a lost Approve reply reloads the list so the card shows what the server applied', async () => {
    jest.useRealTimers();
    const load = jest
      .fn()
      .mockResolvedValueOnce({ enabled: true, proposals: [proposal()] })
      .mockResolvedValue({ enabled: true, proposals: [applied()] });
    const approve = jest.fn(async () => {
      throw new Error('Network Error');
    });
    const r = await render(<RomanAdjustmentsSection load={load} deps={{ approve, now: () => NOW + 60_000 }} />);
    await waitFor(() => expect(r.getByTestId('roman-adjust-card-p1')).toBeTruthy());
    jest.useFakeTimers();
    await fireEvent.press(r.getByTestId('roman-adjust-card-p1-approve'));
    await act(async () => {
      jest.advanceTimersByTime(ADJUST_CLIENT_UNDO_SECONDS * 1000);
    });
    jest.useRealTimers();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(r.getByText('Applied. Maya will see 15 sets instead of 18.')).toBeTruthy());
    expect(r.getByTestId('roman-adjust-section-notice')).toBeTruthy();
    expect(r.queryByText(/unchanged/i)).toBeNull();
  });

  it('a load failure says what happened and offers a retry that works', async () => {
    const load = jest
      .fn()
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValue({ enabled: true, proposals: [proposal()] });
    const r = await render(<RomanAdjustmentsSection load={load} />);
    await waitFor(() => expect(r.getByTestId('roman-adjust-section-error')).toBeTruthy());
    expect(r.getByText(/could not be reached to load Roman's suggestions/)).toBeTruthy();
    await fireEvent.press(r.getByTestId('roman-adjust-section-retry'));
    await waitFor(() => expect(r.getByTestId('roman-adjust-card-p1')).toBeTruthy());
  });
});
