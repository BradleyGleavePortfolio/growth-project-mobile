import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { coachApi, deletionApi, notificationsApi, profileApi } from '../../../services/api';
import { successTap } from '../../../utils/haptics';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest'),
);

jest.mock('../../../services/api', () => ({
  __esModule: true,
  profileApi: {
    get: jest.fn(async () => ({ data: { bio: null } })),
    update: jest.fn(async () => ({ data: {} })),
  },
  coachApi: { getClients: jest.fn(async () => ({ data: [] })) },
  notificationsApi: {
    getPreferences: jest.fn(async () => ({ data: {} })),
    updatePreferences: jest.fn(async () => ({ data: {} })),
  },
  deletionApi: { getDeletionStatus: jest.fn(async () => ({ data: { state: 'none' } })) },
  AccountStatus: {},
}));

jest.mock('../../../services/authActions', () => ({
  signOut: jest.fn(async () => undefined),
}));

jest.mock('../../../lib/money/headCoachRole', () => ({
  useHeadCoachHandlesMoney: () => false,
}));

jest.mock('../../../utils/haptics', () => ({
  mediumTap: jest.fn(),
  warningTap: jest.fn(),
  successTap: jest.fn(),
}));

jest.mock('../../../utils/supabaseAuth', () => ({
  updateSupabasePassword: jest.fn(async () => ({ ok: true })),
}));

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: {
      background: '#000',
      surface: '#111',
      surfaceElevated: '#222',
      border: '#333',
      primary: '#0af',
      primaryDark: '#08c',
      textPrimary: '#fff',
      textSecondary: '#ccc',
      textMuted: '#888',
      textOnPrimary: '#000',
      error: '#f33',
      success: '#3f3',
    },
  }),
}));

jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-1', firstName: 'Taylor', lastName: 'Coach', email: 'coach@example.com', role: 'coach' }),
}));

jest.mock('../../../config/env', () => ({
  helpUrl: () => 'https://example.com/help',
}));

jest.mock('../../../config/featureFlags', () => ({
  featureFlags: { extensionImport: false, romanChat: false, consultationOnboarding: false },
}));

jest.mock('../../../components/BiometricUnlockSetting', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../../../components/roman/RomanAvatar', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../settings/BookingOptionsEntry', () => ({ BookingOptionsEntry: () => null }));
jest.mock('../settings/SettingsToggles', () => ({ SettingsToggles: () => null }));
jest.mock('../settings/BillingSection', () => ({ BillingSection: () => null }));
jest.mock('../settings/DangerZone', () => ({ DangerZone: () => null }));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, addListener: jest.fn(() => jest.fn()) }),
}));

const SAVE_ERROR = 'The bio was not saved. Check the connection and try again.';
const BIO_CACHE_KEY = 'gp_coach_bio_coach-1';

beforeEach(() => {
  jest.clearAllMocks();
  (profileApi.get as jest.Mock).mockResolvedValue({ data: { bio: null } });
  (profileApi.update as jest.Mock).mockResolvedValue({ data: {} });
  (coachApi.getClients as jest.Mock).mockResolvedValue({ data: [] });
  (notificationsApi.getPreferences as jest.Mock).mockResolvedValue({ data: {} });
  (deletionApi.getDeletionStatus as jest.Mock).mockResolvedValue({ data: { state: 'none' } });
});

describe('coach Settings truthfulness', () => {
  it('does not offer Meal Templates from Settings in v1', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SettingsScreen = require('../SettingsScreen').default;
    const screen = await render(<SettingsScreen />);

    expect(screen.queryByLabelText('Open meal templates')).toBeNull();
    expect(screen.getByText('Workout Builder')).toBeTruthy();
    expect(screen.getByLabelText('Open booking inbox')).toBeTruthy();
  });

  it('keeps a rejected bio edit open without caching or confirming it', async () => {
    (profileApi.update as jest.Mock).mockRejectedValueOnce(new Error('Request failed'));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SettingsScreen = require('../SettingsScreen').default;
    const screen = await render(<SettingsScreen />);

    await fireEvent.press(screen.getByLabelText('Edit bio'));
    const editor = screen.getByPlaceholderText('Tell your clients about yourself...');
    await fireEvent.changeText(editor, 'New bio');
    await fireEvent.press(screen.getByLabelText('Save bio'));

    await waitFor(() => expect(screen.getByText(SAVE_ERROR)).toBeTruthy());
    expect(screen.getByPlaceholderText('Tell your clients about yourself...').props.value).toBe('New bio');
    expect(profileApi.update).toHaveBeenCalledWith({ bio: 'New bio' });
    expect(AsyncStorage.setItem).not.toHaveBeenCalledWith(BIO_CACHE_KEY, 'New bio');
    expect(successTap).not.toHaveBeenCalled();
    expect(screen.getByText('Edit Bio')).toBeTruthy();
  });

  it('caches and confirms a bio only after the API accepts it', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SettingsScreen = require('../SettingsScreen').default;
    const screen = await render(<SettingsScreen />);

    await fireEvent.press(screen.getByLabelText('Edit bio'));
    await fireEvent.changeText(screen.getByPlaceholderText('Tell your clients about yourself...'), 'Accepted bio');
    await fireEvent.press(screen.getByLabelText('Save bio'));

    await waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalledWith(BIO_CACHE_KEY, 'Accepted bio'));
    expect(profileApi.update).toHaveBeenCalledWith({ bio: 'Accepted bio' });
    expect(successTap).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Edit Bio')).toBeNull();
  });
});
