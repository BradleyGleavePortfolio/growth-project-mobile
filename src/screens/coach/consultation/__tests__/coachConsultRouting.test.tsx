/**
 * B02 routing: the coach gate (RootNavigator → CoachWizardNavigator, shown
 * while GET /coach/onboarding reads incomplete) opens the coach consultation
 * for every new coach; no money step comes before it. Seen in a test.
 */
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockPost = jest.fn();
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async () => Promise.reject(Object.assign(new Error('nf'), { response: { status: 404 } }))),
    put: jest.fn(async () => Promise.reject(Object.assign(new Error('nf'), { response: { status: 404 } }))),
    post: (...a: unknown[]) => mockPost(...a),
  },
}));
jest.mock('../../../../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('expo-web-browser', () => ({ __esModule: true, openAuthSessionAsync: jest.fn() }));
const mockPrefsSet = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../../../storage/mmkv', () => ({
  prefsStorage: { getStringAsync: jest.fn(async () => null), set: (...a: unknown[]) => mockPrefsSet(...a) },
}));
jest.mock('../../../../lib/userCache', () => ({
  readUserCache: jest.fn(async () => ({ id: 'c1', name: 'Jordan Reyes' })),
}));
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'c1', name: 'Jordan Reyes' }) }));
const mockEmit = jest.fn();
jest.mock('../../../../utils/authEvents', () => ({
  authEvents: { emit: (...a: unknown[]) => mockEmit(...a), subscribe: jest.fn(() => () => undefined) },
}));
const mockSignOut = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../../../services/authActions', () => ({ signOut: (...a: unknown[]) => mockSignOut(...a) }));

import CoachWizardNavigator from '../../../../navigation/CoachWizardNavigator';
import { draftKey } from '../../../../lib/coachConsultation/draft';

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('every new coach goes to the consultation (B02, prototype 77, 86)', () => {
  it('the coach gate opens K0 Welcome, not practice basics or Get paid', async () => {
    const r = await render(<CoachWizardNavigator />);
    await waitFor(() => expect(r.getByTestId('coach-consult-K0')).toBeTruthy());
    expect(r.getByTestId('coach-consult-K0-title').props.children).toBe('Welcome,\nJordan.');
    expect(r.queryByText(/Get paid|first package|Invite your first client/i)).toBeNull();
  });

  it('completing on today\'s backend finishes the old wizard record, then opens the coach app', async () => {
    await AsyncStorage.setItem(
      draftKey('c1'),
      JSON.stringify({ v: 1, step: 'K8', updatedAt: '2026-10-08T20:00:00.000Z', answers: { display_name: 'Jordan Reyes', clients_today: 'none' } }),
    );
    mockPost.mockImplementation(async (url: string) => {
      if (url === '/coach/consultation/complete') throw Object.assign(new Error('nf'), { response: { status: 404 } });
      if (url === '/coach/onboarding/start') return { data: { current_step: 1, step_data: {}, is_complete: false } };
      if (url.startsWith('/coach/onboarding/steps/')) {
        const n = Number(url.split('/').pop());
        return { data: { current_step: n, step_data: {}, is_complete: false } };
      }
      if (url === '/coach/onboarding/complete') return { data: { current_step: 6, step_data: {}, is_complete: true } };
      throw new Error(`unexpected ${url}`);
    });
    const r = await render(<CoachWizardNavigator />);
    await waitFor(() => expect(r.getByTestId('coach-step-K8')).toBeTruthy()); // K8 Practice ready is the last step
    await fireEvent.press(r.getByTestId('k8-show-me-around'));
    await waitFor(() => expect(mockEmit).toHaveBeenCalled());
    const urls = mockPost.mock.calls.map((c) => c[0]);
    expect(urls[0]).toBe('/coach/consultation/complete');
    expect(urls).toContain('/coach/onboarding/steps/6');
    expect(urls[urls.length - 1]).toBe('/coach/onboarding/complete');
    expect(urls.some((u: string) => /packages|connect|invite/.test(u))).toBe(false);
  });

  it('Finish later offers Sign out, confirmed first', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    const r = await render(<CoachWizardNavigator />);
    await waitFor(() => expect(r.getByTestId('coach-consult-K0')).toBeTruthy());
    await fireEvent.press(r.getByTestId('coach-consult-K0-cta'));
    await fireEvent.press(r.getByTestId('coach-consult-finish-later'));
    await fireEvent.press(r.getByTestId('coach-consult-paused-link'));
    const buttons = alert.mock.calls[0][2] ?? [];
    expect(mockSignOut).not.toHaveBeenCalled();
    buttons.find((b) => b.text === 'Sign out')?.onPress?.();
    expect(mockSignOut).toHaveBeenCalledWith('c1');
  });

  it('no route reaches the earlier wizard: only the gate mounts the navigator, and nothing opens its steps', () => {
    const fs = jest.requireActual<typeof import('fs')>('fs');
    const path = jest.requireActual<typeof import('path')>('path');
    const root = path.join(__dirname, '../../../..');
    const files: string[] = [];
    const walk = (d: string) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const f = path.join(d, e.name);
      if (e.isDirectory()) return e.name === '__tests__' ? undefined : walk(f);
      if (/\.tsx?$/.test(e.name)) files.push(f);
    });
    walk(root);
    const app = files.filter((f) => !f.endsWith('CoachWizardNavigator.tsx'));
    const hits = (re: RegExp) => app.filter((f) => re.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(root, f));
    expect(hits(/CoachSetupWizard/)).toEqual([]);
    expect(hits(/navigate\(\s*['"]CoachWizardStep/)).toEqual([]);
    expect(hits(/from '\.\/CoachWizardNavigator'/)).toEqual(['navigation/RootNavigator.tsx']);
  });
});
