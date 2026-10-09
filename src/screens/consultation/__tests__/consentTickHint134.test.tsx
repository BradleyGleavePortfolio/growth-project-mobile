/**
 * SHOTS-134B 6 (CLIENT-POLISH-134 b): on a 360x800 phone the P0 box 1 sits
 * below the fold, so Continue looked disabled for no visible reason. A short
 * line next to the disabled Continue says why; it goes once box 1 is ticked.
 * It is not part of the consent text, so the recorded copy and hash do not move.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import ConsultationFlow, { ConsultationApi } from '../ConsultationFlow';
import { CONSENT_TICK_HINT } from '../QuestionScreen';
import { NOW } from '../../../lib/consultation/__fixtures__/consultFixtures';
import { makeApi, resetStores, seedLocal } from '../../../lib/consultation/__fixtures__/flowHarness';
import { CONSENT_COPY_SHA256, consentCopyText } from '../../../lib/consultation/copy';

jest.mock('../../../services/api', () => ({ __esModule: true, default: {} }));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../../services/sentry', () => ({
  ...jest.requireActual('../../../services/sentry'),
  captureError: jest.fn(),
}));
jest.mock('../../../tutorial/tutorialStore', () => ({ startClientTutorial: jest.fn(() => true) }));

function renderFlow(api: ConsultationApi) {
  return render(
    <ConsultationFlow
      userId="u1"
      firstName="Maya"
      coachName={null}
      api={api}
      onFinished={jest.fn()}
      now={() => NOW}
      autoAdvanceMs={0}
      prepMinMs={0}
    />,
  );
}

beforeEach(async () => {
  await resetStores();
});

it('says why Continue is disabled, sits in the pinned footer, and goes once box 1 is ticked', async () => {
  await seedLocal({}, 'P0');
  const r = await renderFlow(makeApi());
  await waitFor(() => r.getByTestId('consult-screen-P0'));
  const hint = r.getByTestId('consent-tick-hint');
  expect(hint.props.children).toBe(CONSENT_TICK_HINT);
  expect(CONSENT_TICK_HINT).toBe('Tick the first box above to continue.');
  expect(r.getByTestId('consult-continue').props.accessibilityState?.disabled).toBe(true);
  // In the pinned footer with Continue, not in the scrolled agreement text.
  const inFooter = (start: ReturnType<typeof r.getByTestId>) => {
    for (let node = start.parent; node; node = node.parent) {
      if (typeof node.props.testID === 'string' && /footer/i.test(node.props.testID)) return true;
    }
    return false;
  };
  expect(inFooter(hint)).toBe(true);
  expect(inFooter(r.getByTestId('consult-continue'))).toBe(true);
  expect(inFooter(r.getByTestId('consent-checkbox'))).toBe(false);

  await fireEvent.press(r.getByTestId('consent-checkbox'));
  expect(r.queryByTestId('consent-tick-hint')).toBeNull();
  expect(r.getByTestId('consult-continue').props.accessibilityState?.disabled).toBe(false);

  await fireEvent.press(r.getByTestId('consent-checkbox'));
  expect(r.getByTestId('consent-tick-hint')).toBeTruthy();
});

it('is not part of the recorded consent text, so the copy version and hash stay', () => {
  expect(consentCopyText()).not.toContain(CONSENT_TICK_HINT);
  expect(CONSENT_COPY_SHA256).toMatch(/^[0-9a-f]{64}$/);
});
