/**
 * LS-913R3 B1: the retained C7 B_consent frame keeps "Before we start"
 * beside Back, outside the scrolling disclosure. Centering a second header
 * inside the body does not keep that header visible when the agreement is read.
 * GOAL: planning/MOCKUP3/C7/style-b/B_consent_ios390_100.png.
 * Owner O24 changes the ground only, not this header placement.
 */
import React from 'react';
import { render, within } from '@testing-library/react-native';
import QuestionScreen from '../QuestionScreen';
import { screenById } from '../../../lib/consultation/definitions';

jest.mock('../../../config/featureFlags', () => ({
  ...jest.requireActual('../../../config/featureFlags'),
  featureFlags: {
    ...jest.requireActual('../../../config/featureFlags').featureFlags,
    firstRunV2: true,
    consultTilesV2: true,
  },
}));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));

it('LS-913R3 B1: the C7 consent title stays in the fixed Back bar, not the reading scroller', async () => {
  const r = await render(
    <QuestionScreen
      screen={screenById('P0')!}
      answers={{}}
      progress={null}
      ctx={{ firstName: 'Maya', coachName: 'Sam', coachless: false }}
      now={new Date('2026-10-30T21:00:00Z')}
      onAnswer={jest.fn()}
      onNext={jest.fn()}
      onBack={jest.fn()}
      onFinishLater={null}
      consent={{ error: null }}
    />,
  );
  // The ordinary P0 screen and its real title rendered, so this is not a harness/load failure.
  expect(r.getByText('Before we start')).toBeTruthy();
  expect(r.getByTestId('consult-back')).toBeTruthy();
  expect(within(r.getByTestId('consult')).queryByText('Before we start')).not.toBeNull();
  expect(within(r.getByTestId('consult-scroll')).queryByText('Before we start')).toBeNull();
});
