import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import CoachConsultationFlow from '../CoachConsultationFlow';
import { draftKey } from '../../../../lib/coachConsultation/draft';
import type { CoachConsultApi } from '../../../../lib/coachConsultation/api';
import { radius } from '../../../../theme/tokens';

jest.mock('../../../../services/api', () => ({ __esModule: true, default: {} }));

function makeApi(): jest.Mocked<CoachConsultApi> {
  return {
    load: jest.fn().mockResolvedValue(null),
    saveDraft: jest.fn().mockResolvedValue('unavailable'),
    complete: jest.fn().mockResolvedValue(undefined),
  } as jest.Mocked<CoachConsultApi>;
}

async function openAt(step: string, answers: Record<string, unknown>) {
  await AsyncStorage.setItem(draftKey('c1'), JSON.stringify({ v: 1, step, updatedAt: '2026-10-08T20:00:00.000Z', answers }));
  const api = makeApi();
  const onComplete = jest.fn();
  const r = await render(<CoachConsultationFlow userId="c1" user={{ name: 'Jordan Reyes' }} api={api} onComplete={onComplete} />);
  await waitFor(() => expect(r.queryByTestId('coach-consult-loading')).toBeNull());
  return { ...r, api, onComplete };
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('coach consultation K3 and K4 (prototype 80, 81)', () => {
  it('K3 asks practice size as one choice, moves on by itself and has no Skip', async () => {
    const r = await openAt('K3', { display_name: 'Jordan Reyes' });
    expect(r.getByText('How many clients do you coach today?')).toBeTruthy();
    expect(r.getByText('Your practice · 3 of 5')).toBeTruthy();
    expect(r.queryByText('Skip')).toBeNull();
    const chip = r.getByTestId('coach-consult-K3-1_10');
    expect(chip.props.accessibilityRole).toBe('radio');
    expect(StyleSheet.flatten(chip.props.style).borderRadius).toBe(radius.chip);
    await fireEvent.press(chip);
    await waitFor(() => expect(r.getByTestId('coach-consult-K4')).toBeTruthy());
  });

  it('K3 Back before the auto-advance stays on K2', async () => {
    const r = await openAt('K3', { display_name: 'Jordan Reyes' });
    await fireEvent.press(r.getByTestId('coach-consult-K3-none'));
    await fireEvent.press(r.getByLabelText('Back'));
    expect(r.getByTestId('coach-consult-K2')).toBeTruthy();
    await new Promise((res) => setTimeout(res, 400));
    expect(r.queryByTestId('coach-consult-K4')).toBeNull();
  });

  it('K4 picks a coaching touch, then the consultation completes with every answer', async () => {
    const r = await openAt('K4', { display_name: 'Jordan Reyes', clients_today: '1_10', specialties: ['strength'] });
    expect(r.getByText('How hands-on do you like to be?')).toBeTruthy();
    expect(r.getByText('Your practice · 4 of 5')).toBeTruthy();
    expect(r.getByTestId('coach-consult-K4-close').props.accessibilityLabel).toBe('Close guidance. Frequent check-ins');
    await fireEvent.press(r.getByTestId('coach-consult-K4-balanced'));
    await waitFor(() => expect(r.onComplete).toHaveBeenCalledTimes(1));
    expect(r.api.complete).toHaveBeenCalledWith(
      expect.objectContaining({ display_name: 'Jordan Reyes', clients_today: '1_10', specialties: ['strength'], coaching_touch: 'balanced' }),
    );
  });

  it('K4 Skip leaves the coaching touch unset', async () => {
    const r = await openAt('K4', { display_name: 'Jordan Reyes', clients_today: 'none', coaching_touch: 'close' });
    await fireEvent.press(r.getByTestId('coach-consult-K4-skip'));
    await waitFor(() => expect(r.onComplete).toHaveBeenCalled());
    expect(r.api.complete.mock.calls[0][0].coaching_touch).toBeUndefined();
  });
});
