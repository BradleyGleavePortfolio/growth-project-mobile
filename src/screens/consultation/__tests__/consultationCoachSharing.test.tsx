/**
 * B-SHARE-GUEST-127: a share-link buyer's account is linked to the coach by
 * the web checkout, so no join screen printed the coach-sharing sentence.
 * The consultation's agreement (P0) prints it directly above the Continue the
 * client already taps, and that Continue records it. Without a notice (current
 * production, or a client who already decided) P0 is unchanged.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import ConsultationFlow, { ConsultationApi } from '../ConsultationFlow';
import { NOW } from '../../../lib/consultation/__fixtures__/consultFixtures';
import { makeApi, resetStores, seedLocal } from '../../../lib/consultation/__fixtures__/flowHarness';

jest.mock('../../../services/api', () => ({ __esModule: true, default: {} }));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../../services/sentry', () => ({
  ...jest.requireActual('../../../services/sentry'),
  captureError: jest.fn(),
}));
jest.mock('../../../tutorial/tutorialStore', () => ({ startClientTutorial: jest.fn(() => true) }));

const V1 = 'coach_sharing_join_v1';
const SENTENCE =
  'Joining shares your workouts, food logs, weigh-ins and check-ins with Alex Rivera. Change this any time in Settings > Privacy.';

function renderFlow(api: ConsultationApi) {
  return render(
    <ConsultationFlow
      userId="u1"
      firstName="Maya"
      coachName="Alex Rivera"
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

describe('coach sharing on the consultation agreement (P0)', () => {
  it('prints the sentence above Continue and records it on that Continue, once', async () => {
    const accept = jest.fn(async () => true);
    const api = makeApi({
      getCoachSharingNotice: jest.fn(async () => ({ version: V1, coachName: 'Alex Rivera' })),
      acceptCoachSharingNotice: accept,
    });
    await seedLocal({}, 'P0');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    await waitFor(() => expect(r.getByTestId('consent-coach-sharing')).toBeTruthy());
    expect(r.getByText(SENTENCE)).toBeTruthy();
    expect(accept).not.toHaveBeenCalled();

    await fireEvent.press(r.getByTestId('consent-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    expect(accept).toHaveBeenCalledTimes(1);
    expect(accept).toHaveBeenCalledWith(V1);

    // Back to P0 and Continue again: recorded once only.
    await fireEvent.press(r.getByTestId('consult-back'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    expect(accept).toHaveBeenCalledTimes(1);
  });

  it('no notice (current production, or already decided): no sentence and nothing sent', async () => {
    const accept = jest.fn(async () => true);
    const api = makeApi({
      getCoachSharingNotice: jest.fn(async () => null),
      acceptCoachSharingNotice: accept,
    });
    await seedLocal({}, 'P0');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(r.queryByTestId('consent-coach-sharing')).toBeNull();
    await fireEvent.press(r.getByTestId('consent-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    expect(accept).not.toHaveBeenCalled();
  });
});
