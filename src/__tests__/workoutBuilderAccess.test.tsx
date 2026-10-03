/**
 * S-MWB-4 (OR-112-18): the builder tells a coach why a save was refused for
 * access (403 from the backend's owner and visibility gate) instead of the
 * offline "saved on device, will sync" promise, which would be false: a
 * refused save never syncs on its own.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => {
  function Icon() {
    return null;
  }
  return { Ionicons: Icon };
});
jest.mock('../theme/ThemeProvider', () => {
  const { lightTokens } = jest.requireActual('../theme/tokens');
  return { __esModule: true, useTheme: () => ({ semanticColors: lightTokens }) };
});
jest.mock('../screens/client/wearables/components/useReduceMotion', () => ({
  __esModule: true,
  useReduceMotion: () => false,
}));

import AutosaveStatusPill from '../components/workout/AutosaveStatusPill';
import { WorkoutAutosaveApiError } from '../api/workoutAutosaveApi';
import { refusalCodeOf } from '../hooks/useAutosave';
import {
  AUTOSAVE_REFUSAL_COPY,
  describeAutosaveRefusal,
} from '../screens/coach/workoutBuilderAccess';

function forbidden(data: unknown) {
  return new WorkoutAutosaveApiError(
    'forbidden',
    403,
    'workout autosave request failed (403)',
    undefined,
    { isAxiosError: true, response: { status: 403, data } },
  );
}

describe('refusalCodeOf', () => {
  it('reads the machine code off the refused response', () => {
    expect(refusalCodeOf(forbidden({ code: 'client_not_assigned', message: 'x' }))).toBe(
      'client_not_assigned',
    );
  });
  it('is null for a body without a code, a non-API error, or no response', () => {
    expect(refusalCodeOf(forbidden({ message: 'No access' }))).toBeNull();
    expect(refusalCodeOf(forbidden('plain text'))).toBeNull();
    expect(refusalCodeOf(new Error('x'))).toBeNull();
    expect(
      refusalCodeOf(new WorkoutAutosaveApiError('forbidden', 403, 'x', undefined, undefined)),
    ).toBeNull();
  });
});

describe('describeAutosaveRefusal', () => {
  it.each(Object.keys(AUTOSAVE_REFUSAL_COPY))('maps %s to its own copy', (code) => {
    const text = describeAutosaveRefusal({ status: 403, code });
    expect(text).toBe(AUTOSAVE_REFUSAL_COPY[code as keyof typeof AUTOSAVE_REFUSAL_COPY]);
    expect(text).toMatch(/not saved\. /);
    expect(text).not.toMatch(/!|\bwe\b|\bus\b|went wrong/i);
  });
  it('an unknown or missing code is still a definite access refusal', () => {
    expect(describeAutosaveRefusal({ status: 403, code: null })).toBe(
      AUTOSAVE_REFUSAL_COPY.plan_access_denied,
    );
    expect(describeAutosaveRefusal({ status: 403, code: 'something_new' })).toBe(
      AUTOSAVE_REFUSAL_COPY.plan_access_denied,
    );
  });
});

describe('AutosaveStatusPill refused', () => {
  it('a refused save never claims it will sync', async () => {
    const screen = await render(
      <AutosaveStatusPill status="offline" lastSavedAt={null} refused onPress={() => {}} />,
    );
    expect(screen.getByText('Not saved — no edit access')).toBeTruthy();
    expect(screen.queryByText('Offline — saved on device, will sync')).toBeNull();
  });
  it('without a refusal the offline copy is unchanged', async () => {
    const screen = await render(<AutosaveStatusPill status="offline" lastSavedAt={null} />);
    expect(screen.getByText('Offline — saved on device, will sync')).toBeTruthy();
  });
});
