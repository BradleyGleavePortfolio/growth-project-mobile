/**
 * Push priming after the tour (prototype 61-62, TOUR-133): offered once, only
 * when the OS can still ask; only "Turn on notifications" shows the OS dialog;
 * either answer is stored under the Home push card's key, so the client is
 * never asked twice.
 */
const mockGetPerms = jest.fn();
jest.mock('expo-notifications', () => ({ getPermissionsAsync: () => mockGetPerms() }));
const mockRegister = jest.fn();
jest.mock('../../services/pushNotifications', () => ({
  registerForPushNotifications: (o: unknown) => mockRegister(o),
}));
const mockUpdate = jest.fn(async (_t: string) => undefined);
jest.mock('../../services/api', () => ({ usersApi: { updatePushToken: (t: string) => mockUpdate(t) } }));
const mockPrefs: Record<string, string> = {};
jest.mock('../../storage/mmkv', () => ({
  prefsStorage: {
    getStringAsync: async (k: string) => mockPrefs[k] ?? null,
    set: async (k: string, v: string) => {
      mockPrefs[k] = v;
    },
  },
}));
jest.mock('../../components/home/PushPermissionCard', () => ({
  pushPrimerDismissedKey: (u: string) => `push_primer_dismissed:${u}`,
}));

import { answerPushPriming, shouldOfferPushPriming } from '../pushPriming';

beforeEach(() => {
  for (const k of Object.keys(mockPrefs)) delete mockPrefs[k];
  mockGetPerms.mockReset().mockResolvedValue({ status: 'undetermined', canAskAgain: true });
  mockRegister.mockReset().mockResolvedValue({ token: 'ExponentPushToken[x]' });
  mockUpdate.mockClear();
});

describe('shouldOfferPushPriming', () => {
  it('offers when the OS can still ask and the account has not answered', async () => {
    expect(await shouldOfferPushPriming('u1')).toBe(true);
  });

  it('never offers without a user, once granted, once the OS cannot ask, or after an answer', async () => {
    expect(await shouldOfferPushPriming(null)).toBe(false);
    mockGetPerms.mockResolvedValueOnce({ status: 'granted', canAskAgain: true });
    expect(await shouldOfferPushPriming('u1')).toBe(false);
    mockGetPerms.mockResolvedValueOnce({ status: 'denied', canAskAgain: false });
    expect(await shouldOfferPushPriming('u1')).toBe(false);
    mockPrefs['push_primer_dismissed:u1'] = 'true';
    expect(await shouldOfferPushPriming('u1')).toBe(false);
  });

  it('a permissions error means no card, never a crash', async () => {
    mockGetPerms.mockRejectedValueOnce(new Error('native module missing'));
    expect(await shouldOfferPushPriming('u1')).toBe(false);
  });
});

describe('answerPushPriming', () => {
  it('Turn on notifications shows the OS dialog, registers the token and records the answer', async () => {
    await answerPushPriming('u1', true);
    expect(mockRegister).toHaveBeenCalledWith({ requestPermission: true });
    expect(mockUpdate).toHaveBeenCalledWith('ExponentPushToken[x]');
    expect(mockPrefs['push_primer_dismissed:u1']).toBe('true');
  });

  it('Not now never touches the OS dialog, and is remembered (the Home card stays away too)', async () => {
    await answerPushPriming('u1', false);
    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockPrefs['push_primer_dismissed:u1']).toBe('true');
    expect(await shouldOfferPushPriming('u1')).toBe(false);
  });

  it('a declined OS dialog still closes the card for good', async () => {
    mockRegister.mockResolvedValueOnce({ token: null });
    await answerPushPriming('u1', true);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockPrefs['push_primer_dismissed:u1']).toBe('true');
  });
});
