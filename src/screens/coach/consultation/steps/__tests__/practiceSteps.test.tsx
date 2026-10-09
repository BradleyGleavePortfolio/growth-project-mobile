/**
 * K5-K8 step components (prototype 82-85) against the CoachStepProps
 * contract: what each step saves, when it moves on, the real join link with
 * share / copy / later, the import offer and the practice-ready summary.
 */
import React from 'react';
import { Share } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CoachStepProps } from '../../types';

let mockUserId = 'coach_1';
jest.mock('../../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: mockUserId }) }));
const mockInviteLink = jest.fn();
jest.mock('../../../../../api/coachSetupApi', () => ({ coachSetupApi: { inviteLink: () => mockInviteLink() } }));
const mockCopy = jest.fn();
jest.mock('expo-clipboard', () => ({ setStringAsync: (v: string) => mockCopy(v) }));
const mockPrefsSet = jest.fn<Promise<void>, [string, string]>(async () => undefined);
jest.mock('../../../../../storage/mmkv', () => ({ prefsStorage: { set: (k: string, v: string) => mockPrefsSet(k, v) } }));
jest.mock('../../../../../services/sentry', () => ({ captureError: jest.fn(), setSentryUser: jest.fn() }));
jest.mock('../../../../../services/api', () => ({ __esModule: true, default: {} }));

import K5ProgrammingStyle from '../K5ProgrammingStyle';
import { STEP_MS } from '../../../../consultation/components';
import K6PersonalLink from '../K6PersonalLink';
import K7ImportOffer from '../K7ImportOffer';
import K8PracticeReady from '../K8PracticeReady';
import CoachConsultationFlow from '../../CoachConsultationFlow';
import { STEP_COMPONENTS } from '../../registry';

it('the default registry carries K5-K8', () => {
  expect(Object.keys(STEP_COMPONENTS)).toEqual(['K0', 'K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8']);
});
import { draftKey } from '../../../../../lib/coachConsultation/draft';
import type { CoachConsultApi } from '../../../../../lib/coachConsultation/api';

const LINK = { code: 'GP-RS7K2Q', url: 'https://app.trygrowthproject.com/join/GP-RS7K2Q' };

function props(over: Partial<CoachStepProps> = {}): CoachStepProps {
  return {
    answers: {},
    setAnswers: jest.fn(),
    onNext: jest.fn(),
    onBack: jest.fn(),
    onFinishLater: jest.fn(),
    progress: { chapter: 4, position: 2, count: 2, total: 5 },
    eyebrow: 'Your practice · 4 of 5',
    firstName: 'Jordan',
    completing: false,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = 'coach_1';
  mockInviteLink.mockResolvedValue(LINK);
  mockCopy.mockResolvedValue(true);
});

describe('K5 Programming style', () => {
  it('shows the question and three rows, saves the tap and moves on a moment later; a second tap changes it', async () => {
    jest.useFakeTimers();
    const p = props();
    const ui = await render(<K5ProgrammingStyle {...p} />);
    expect(ui.getByText('How do you usually build programs?')).toBeTruthy();
    expect(ui.getByText('Your practice · 4 of 5')).toBeTruthy();
    ['I write my own', 'I adapt templates', "I'd like help building them"].forEach((t) => expect(ui.getByText(t)).toBeTruthy());
    await fireEvent.press(ui.getByTestId('k5-templates'));
    await fireEvent.press(ui.getByTestId('k5-own'));
    expect(p.setAnswers).toHaveBeenNthCalledWith(1, { programming_style: 'templates' });
    expect(p.setAnswers).toHaveBeenLastCalledWith({ programming_style: 'own' });
    expect(p.onNext).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(STEP_MS);
    });
    expect(p.onNext).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('shows the saved choice, and Skip clears it and moves on', async () => {
    const b = props({ answers: { programming_style: 'own' } });
    const ui2 = await render(<K5ProgrammingStyle {...b} />);
    expect(ui2.getByTestId('k5-own').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    await fireEvent.press(ui2.getByTestId('k5-skip'));
    expect(b.setAnswers).toHaveBeenCalledWith({ programming_style: undefined });
    expect(b.onNext).toHaveBeenCalledTimes(1);
  });
});

describe('K6 Your personal link', () => {
  it('shows the real link, its code and a QR, and shares it through the system sheet', async () => {
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction } as never);
    const p = props({ progress: { chapter: 5, position: 1, count: 1, total: 5 }, eyebrow: 'Your practice · 5 of 5' });
    const ui = await render(<K6PersonalLink {...p} />);
    await waitFor(() => expect(ui.getByTestId('k6-url')).toBeTruthy());
    expect(ui.getByText('app.trygrowthproject.com/join/GP-RS7K2Q')).toBeTruthy();
    expect(ui.getByTestId('k6-code').props.children).toBe('GP-RS7K2Q');
    expect(ui.getByTestId('k6-qr')).toBeTruthy();
    expect(ui.getByText('Anyone who opens this joins your roster directly.')).toBeTruthy();
    await fireEvent.press(ui.getByTestId('k6-share'));
    expect(shareSpy).toHaveBeenCalledWith({ message: `Join my coaching on The Growth Project: ${LINK.url}` });
    expect(p.setAnswers).toHaveBeenCalledWith({ link_shared: true });
    expect(mockPrefsSet).toHaveBeenCalledWith(expect.stringContaining('coach_1'), 'true');
    expect(p.onNext).toHaveBeenCalledTimes(1);
    shareSpy.mockRestore();
  });

  it('stays when the share sheet is dismissed; Copy copies the url; Later moves on', async () => {
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction } as never);
    const p = props();
    const ui = await render(<K6PersonalLink {...p} />);
    await waitFor(() => expect(ui.getByTestId('k6-url')).toBeTruthy());
    await fireEvent.press(ui.getByTestId('k6-share'));
    expect(p.onNext).not.toHaveBeenCalled();
    await fireEvent.press(ui.getByTestId('k6-copy'));
    expect(mockCopy).toHaveBeenCalledWith(LINK.url);
    expect(p.setAnswers).toHaveBeenCalledWith({ link_shared: true });
    expect(ui.getByText('Copied')).toBeTruthy();
    await fireEvent.press(ui.getByTestId('k6-later'));
    expect(p.onNext).toHaveBeenCalledTimes(1);
    shareSpy.mockRestore();
  });

  it('names a failed load and loads again on Try again', async () => {
    mockInviteLink.mockRejectedValueOnce(Object.assign(new Error('x'), { response: { status: 503, data: {} } }));
    const p = props();
    const ui = await render(<K6PersonalLink {...p} />);
    await waitFor(() => expect(ui.getByTestId('k6-error')).toBeTruthy());
    expect(ui.queryByTestId('k6-share')).toBeNull();
    await fireEvent.press(ui.getByTestId('k6-retry'));
    await waitFor(() => expect(ui.getByTestId('k6-url')).toBeTruthy());
    expect(mockInviteLink).toHaveBeenCalledTimes(2);
  });
});

describe('K7 Import offer', () => {
  it('records the choice locally and moves on either way', async () => {
    const a = props();
    const ui = await render(<K7ImportOffer {...a} />);
    expect(ui.getByText('Bring your existing clients over?')).toBeTruthy();
    expect(ui.getByText('You can do this later from Settings > Import my records.')).toBeTruthy();
    await fireEvent.press(ui.getByTestId('k7-show-me'));
    expect(a.setAnswers).toHaveBeenCalledWith({ import_choice: 'show_me' });
    expect(a.onNext).toHaveBeenCalledTimes(1);
    const b = props();
    const ui2 = await render(<K7ImportOffer {...b} />);
    await fireEvent.press(ui2.getByTestId('k7-later'));
    expect(b.setAnswers).toHaveBeenCalledWith({ import_choice: 'later' });
  });
});

describe('K8 Practice ready', () => {
  const answers = {
    display_name: 'Jordan Reyes',
    business_name: 'Reyes Strength',
    specialties: ['strength' as const, 'fat_loss' as const, 'beginners' as const],
    clients_today: 'none' as const,
  };

  it('summarises the card, specialties and link, with no bar and no Finish later', async () => {
    const p = props({ answers, progress: null, eyebrow: 'Your practice' });
    const ui = await render(<K8PracticeReady {...p} />);
    expect(ui.getByText('Your practice is ready.')).toBeTruthy();
    expect(ui.getByText('Jordan Reyes, Reyes Strength.')).toBeTruthy();
    expect(ui.getByText('Strength, fat loss and beginners.')).toBeTruthy();
    expect(ui.getByText('Your link is ready to share.')).toBeTruthy();
    expect(ui.getByText('Next is your Clients page. Share your link there to bring in your first client.')).toBeTruthy();
    expect(ui.queryByText('Finish later')).toBeNull();
    await fireEvent.press(ui.getByTestId('k8-show-me-around'));
    expect(p.onNext).toHaveBeenCalledTimes(1);
  });

  it('falls back to the first name, leaves out skipped specialties, and holds still while completing', async () => {
    const p = props({ answers: { clients_today: 'none' }, progress: null, completing: true });
    const ui = await render(<K8PracticeReady {...p} />);
    expect(ui.getByText('Jordan.')).toBeTruthy();
    expect(ui.queryByTestId('k8-specialties')).toBeNull();
    expect(ui.getByTestId('k8-show-me-around-spinner')).toBeTruthy();
    await fireEvent.press(ui.getByTestId('k8-show-me-around'));
    expect(p.onNext).not.toHaveBeenCalled();
    expect(ui.queryByTestId('coach-consult-topbar-back')).toBeNull(); // no back while completing
  });
});

describe('K5-K8 in the flow (default registry, nothing injected)', () => {
  async function walk(importOn: boolean) {
    await AsyncStorage.setItem(
      draftKey('c1'),
      JSON.stringify({ v: 1, step: 'K2', updatedAt: '2026-10-08T20:00:00.000Z', answers: { display_name: 'Jordan Reyes', clients_today: '1_10' } }),
    );
    const api: jest.Mocked<CoachConsultApi> = {
      load: jest.fn().mockResolvedValue(null),
      saveDraft: jest.fn().mockResolvedValue('unavailable'),
      complete: jest.fn().mockResolvedValue(undefined),
    };
    const onComplete = jest.fn();
    const ui = await render(
      <CoachConsultationFlow
        userId="c1"
        user={{ name: 'Jordan Reyes' }}
        api={api}
        onComplete={onComplete}
        importOn={importOn}
      />,
    );
    await waitFor(() => expect(ui.getByTestId('coach-consult-K2-skip')).toBeTruthy());
    await fireEvent.press(ui.getByTestId('coach-consult-K2-skip'));
    await waitFor(() => expect(ui.getByTestId('coach-consult-K3')).toBeTruthy()); // clients today kept from the draft
    await fireEvent.press(ui.getByTestId('coach-consult-K3-1_10'));
    await waitFor(() => expect(ui.getByTestId('coach-consult-K4')).toBeTruthy());
    await fireEvent.press(ui.getByTestId('coach-consult-K4-skip'));
    expect(ui.getByTestId('coach-step-K5')).toBeTruthy();
    await fireEvent.press(ui.getByTestId('k5-own'));
    await waitFor(() => expect(ui.getByTestId('k6-url')).toBeTruthy());
    await fireEvent.press(ui.getByTestId('k6-later'));
    return { ui, api, onComplete };
  }

  it('walks K5, K6 and K8 to completion with the importer off, sending the programming style', async () => {
    const { ui, api, onComplete } = await walk(false);
    expect(ui.queryByTestId('coach-step-K7')).toBeNull();
    expect(ui.getByText('Jordan Reyes.')).toBeTruthy();
    expect(ui.getByText('Your link is ready to share.')).toBeTruthy();
    await fireEvent.press(ui.getByTestId('k8-show-me-around'));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(api.complete).toHaveBeenCalledWith(expect.objectContaining({ programming_style: 'own', clients_today: '1_10' }));
  });

  it('after a failed link load and Later, K8 points to Settings instead of claiming the link is ready', async () => {
    mockInviteLink.mockRejectedValue(Object.assign(new Error('x'), { response: { status: 503, data: {} } }));
    mockUserId = 'coach_2'; // a coach whose link never loaded on this phone
    await AsyncStorage.setItem(draftKey('c2'), JSON.stringify({ v: 1, step: 'K6', updatedAt: '2026-10-08T20:00:00.000Z', answers: { display_name: 'Ana', clients_today: 'none' } }));
    const api = { load: jest.fn().mockResolvedValue(null), saveDraft: jest.fn().mockResolvedValue('unavailable'), complete: jest.fn() };
    const ui = await render(<CoachConsultationFlow userId="c2" user={{ name: 'Ana' }} api={api} onComplete={jest.fn()} />);
    await waitFor(() => expect(ui.getByTestId('k6-error')).toBeTruthy());
    await fireEvent.press(ui.getByTestId('k6-later'));
    expect(ui.getByText('Your link is in Settings > Invite Codes.')).toBeTruthy();
  });

  it('offers K7 between K6 and K8 when the importer is on and the coach has clients', async () => {
    const { ui } = await walk(true);
    expect(ui.getByTestId('coach-step-K7')).toBeTruthy();
    await fireEvent.press(ui.getByTestId('k7-later'));
    expect(ui.getByTestId('coach-step-K8')).toBeTruthy();
  });
});
