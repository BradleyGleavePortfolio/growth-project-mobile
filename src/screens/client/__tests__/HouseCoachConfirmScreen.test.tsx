/** SWITCH-CONFIRM-M (owner #166-5): the one-coach confirm page in front of the house coach's packages. */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const mockApi = { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() };
jest.mock('../../../services/api', () => ({ __esModule: true, default: mockApi }));

const Screen: typeof import('../HouseCoachConfirmScreen').default = require('../HouseCoachConfirmScreen').default;
const HOUSE = { id: 'house-1', firstName: 'Bradley' };
const nav = { goBack: jest.fn(), navigate: jest.fn() };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mount = (from: { id: string; firstName: string } | null) => render(<Screen route={{ key: 'c', name: 'HouseCoachConfirm', params: { coach: HOUSE, from } } as any} navigation={nav as any} />);

beforeEach(async () => { jest.clearAllMocks(); await AsyncStorage.clear(); });

it('says one coach at a time and names the current coach; Continue opens the house coach packages', async () => {
  const s = await mount({ id: 'coach-1', firstName: 'Jordan' });
  expect(s.getByText("TGP's Top Rated Coach")).toBeTruthy();
  expect(s.getByText('One coach at a time')).toBeTruthy();
  expect(s.getByText('For now, each TGP client has one coach at a time.')).toBeTruthy();
  expect(s.getByText('Jordan stops being your coach once you pay, and no longer sees your logs.')).toBeTruthy();
  expect(s.queryByText(/trial|free/i)).toBeNull();
  for (const id of ['house-confirm-continue', 'house-confirm-not-now', 'house-coach-back']) {
    expect(s.getByTestId(id).props.accessibilityLabel).toBeTruthy();
  }
  await fireEvent.press(s.getByTestId('house-confirm-continue'));
  expect(nav.navigate.mock.calls).toEqual([['HouseCoach', { coach: HOUSE }]]);
  expect(nav.goBack).not.toHaveBeenCalled();
});

it('W-168-HC: the house coach\'s monogram is his full initials, and Continue carries his full name on', async () => {
  const coach = { ...HOUSE, fullName: 'Bradley Gleave' };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = await render(<Screen route={{ key: 'c', name: 'HouseCoachConfirm', params: { coach, from: null } } as any} navigation={nav as any} />);
  expect(s.getByText('BG')).toBeTruthy();
  await fireEvent.press(s.getByTestId('house-confirm-continue'));
  expect(nav.navigate.mock.calls).toEqual([['HouseCoach', { coach }]]);
});

it.each([['Not now', 'house-confirm-not-now'], ['Back', 'house-coach-back']])('%s goes back and changes nothing', async (_l, id) => {
  const s = await mount(null);
  expect(s.getByText('Your current coach stops being your coach once you pay, and no longer sees your logs.')).toBeTruthy();
  await fireEvent.press(s.getByTestId(id));
  expect(nav.goBack).toHaveBeenCalledTimes(1);
  expect(nav.navigate).not.toHaveBeenCalled();
  for (const fn of Object.values(mockApi)) expect(fn).not.toHaveBeenCalled();
  expect(await AsyncStorage.getAllKeys()).toEqual([]);
});
