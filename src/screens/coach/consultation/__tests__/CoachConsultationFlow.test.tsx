import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import CoachConsultationFlow from '../CoachConsultationFlow';
import { draftKey } from '../../../../lib/coachConsultation/draft';
import type { CoachConsultApi } from '../../../../lib/coachConsultation/api';
import { radius } from '../../../../theme/tokens';

jest.mock('../../../../services/api', () => ({ __esModule: true, default: {} }));

const USER = { name: 'Jordan Reyes' };

function makeApi(over: Partial<CoachConsultApi> = {}): jest.Mocked<CoachConsultApi> {
  return {
    load: jest.fn().mockResolvedValue(null),
    saveDraft: jest.fn().mockResolvedValue('unavailable'),
    complete: jest.fn().mockResolvedValue(undefined),
    ...over,
  } as jest.Mocked<CoachConsultApi>;
}

async function mount(api = makeApi(), onComplete = jest.fn()) {
  const utils = await render(<CoachConsultationFlow userId="c1" user={USER} api={api} onComplete={onComplete} />);
  await waitFor(() => expect(utils.queryByTestId('coach-consult-loading')).toBeNull());
  return { ...utils, api, onComplete };
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('coach consultation flow (prototype 77-79)', () => {
  it('K0 greets the coach by first name with one forest button', async () => {
    const { getByTestId, getByText } = await mount();
    expect(getByTestId('coach-consult-K0-title').props.children).toBe('Welcome,\nJordan.');
    expect(getByText(/I'm Roman\. Let's set up your practice/)).toBeTruthy();
    expect(getByTestId('coach-consult-K0-cta').props.accessibilityLabel).toBe('Set up my practice');
  });

  it('K1 opens prefilled from sign-up, previews the card and needs a name', async () => {
    const { getByTestId } = await mount();
    await fireEvent.press(getByTestId('coach-consult-K0-cta'));
    expect(getByTestId('coach-consult-K1-name').props.value).toBe('Jordan Reyes');
    await fireEvent.changeText(getByTestId('coach-consult-K1-business'), 'Reyes Strength');
    expect(getByTestId('coach-consult-K1-preview').props.accessibilityLabel).toBe(
      'Preview of your card: Jordan Reyes, Reyes Strength',
    );
    await fireEvent.changeText(getByTestId('coach-consult-K1-name'), '  ');
    expect(getByTestId('coach-consult-K1-cta').props.accessibilityState.disabled).toBe(true);
    const field = StyleSheet.flatten(getByTestId('coach-consult-K1-name').props.style);
    expect(field.borderRadius).toBe(radius.input);
  });

  it('K2 caps specialties at five with pill chips, then opens K3', async () => {
    const { getByTestId, queryByTestId, api, onComplete } = await mount();
    await fireEvent.press(getByTestId('coach-consult-K0-cta'));
    await fireEvent.press(getByTestId('coach-consult-K1-cta'));
    expect(getByTestId('coach-consult-K2-cta').props.accessibilityState.disabled).toBe(true);
    for (const v of ['strength', 'fat_loss', 'muscle', 'beginners', 'older', 'sports']) {
      await fireEvent.press(getByTestId(`coach-consult-K2-${v}`));
    }
    expect(getByTestId('coach-consult-K2-cap')).toBeTruthy();
    expect(getByTestId('coach-consult-K2-sports').props.accessibilityState.checked).toBe(false);
    expect(StyleSheet.flatten(getByTestId('coach-consult-K2-strength').props.style).borderRadius).toBe(radius.chip);
    // K3 (clients today) is required, so Continue opens it and nothing is sent yet.
    await fireEvent.press(getByTestId('coach-consult-K2-cta'));
    expect(api.complete).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(queryByTestId('coach-consult-K3')).toBeTruthy();
  });

  it('completes with every answer once the required ones are given', async () => {
    await AsyncStorage.setItem(
      draftKey('c1'),
      JSON.stringify({ v: 1, step: 'K4', updatedAt: '2026-10-08T20:00:00.000Z', answers: { display_name: 'Jordan Reyes', clients_today: 'none', specialties: [] } }),
    );
    const { getByTestId, api, onComplete } = await mount();
    await fireEvent.press(getByTestId('coach-consult-K4-skip'));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(api.complete).toHaveBeenCalledWith(expect.objectContaining({ display_name: 'Jordan Reyes', clients_today: 'none', specialties: [] }));
    expect(await AsyncStorage.getItem(draftKey('c1'))).toBeNull();
  });

  it('shows a specific problem with Try again when completion fails, and keeps the answers', async () => {
    await AsyncStorage.setItem(
      draftKey('c1'),
      JSON.stringify({ v: 1, step: 'K4', updatedAt: '2026-10-08T20:00:00.000Z', answers: { display_name: 'Jordan', clients_today: 'none' } }),
    );
    const api = makeApi({ complete: jest.fn().mockRejectedValueOnce(Object.assign(new Error('x'), { response: { status: 429 } })).mockResolvedValueOnce(undefined) });
    const { getByTestId, getByText, onComplete } = await mount(api);
    await fireEvent.press(getByTestId('coach-consult-K4-skip'));
    await waitFor(() => expect(getByTestId('coach-consult-problem')).toBeTruthy());
    expect(getByText('Too many tries in a row')).toBeTruthy();
    expect(getByText(/Your answers are kept on this phone\./)).toBeTruthy();
    await fireEvent.press(getByTestId('coach-consult-retry'));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
  });

  it('Finish later saves and pauses; Continue returns to the same step', async () => {
    const { getByTestId, api } = await mount();
    await fireEvent.press(getByTestId('coach-consult-K0-cta'));
    await fireEvent.press(getByTestId('coach-consult-finish-later'));
    expect(getByTestId('coach-consult-paused')).toBeTruthy();
    expect(api.saveDraft).toHaveBeenLastCalledWith(expect.objectContaining({ display_name: 'Jordan Reyes' }), 'K1');
    await fireEvent.press(getByTestId('coach-consult-resume'));
    expect(getByTestId('coach-consult-K1')).toBeTruthy();
  });

  it('resumes from the newer server draft', async () => {
    await AsyncStorage.setItem(
      draftKey('c1'),
      JSON.stringify({ v: 1, step: 'K1', updatedAt: '2026-10-08T19:00:00.000Z', answers: { display_name: 'Old' } }),
    );
    const api = makeApi({
      load: jest.fn().mockResolvedValue({
        status: 'in_progress',
        step: 'K2',
        updatedAt: '2026-10-08T20:00:00.000Z',
        answers: { display_name: 'Jordan Reyes', specialties: ['strength'] },
      }),
    });
    const { getByTestId } = await mount(api);
    expect(getByTestId('coach-consult-K2-strength').props.accessibilityState.checked).toBe(true);
  });
});
