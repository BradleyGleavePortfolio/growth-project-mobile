import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { User, AuthToken, ClientProfile } from '../types';
import { mockHash, mockVerify, createToken, isTokenValid } from '../utils/auth';
import { getUserByEmail, getUserById, createUser, getCoachUser } from '../db/userDb';
import { getProfileByUserId, createProfile } from '../db/profileDb';
import { authEvents } from '../utils/authEvents';

const AUTH_TOKEN_KEY = 'gp_auth_token';
const AUTH_USER_KEY = 'gp_auth_user';

interface AuthStore {
  currentUser: User | null;
  authToken: AuthToken | null;
  clientProfile: ClientProfile | null;
  role: 'coach' | 'client' | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  bootstrapAuth: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  registerClient: (data: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
  }) => Promise<void>;
  refreshProfile: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  currentUser: null,
  authToken: null,
  clientProfile: null,
  role: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,

  bootstrapAuth: async () => {
    try {
      set({ isLoading: true, error: null });

      const tokenStr = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
      if (!tokenStr) {
        set({ isLoading: false, isAuthenticated: false });
        return;
      }

      const token: AuthToken = JSON.parse(tokenStr);
      if (!isTokenValid(token)) {
        await AsyncStorage.multiRemove([AUTH_TOKEN_KEY, AUTH_USER_KEY]);
        set({ isLoading: false, isAuthenticated: false });
        return;
      }

      const user = await getUserById(token.userId);
      if (!user || user.status !== 'active') {
        await AsyncStorage.multiRemove([AUTH_TOKEN_KEY, AUTH_USER_KEY]);
        set({ isLoading: false, isAuthenticated: false });
        return;
      }

      let profile: ClientProfile | null = null;
      if (user.role === 'client') {
        profile = await getProfileByUserId(user.id);
      }

      set({
        currentUser: user,
        authToken: token,
        clientProfile: profile,
        role: user.role,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err) {
      set({ isLoading: false, isAuthenticated: false, error: 'Failed to restore session' });
    }
  },

  signIn: async (email: string, password: string) => {
    try {
      set({ isLoading: true, error: null });

      const user = await getUserByEmail(email);
      if (!user) {
        set({ isLoading: false, error: 'Invalid email or password' });
        return;
      }

      if (!mockVerify(password, user.passwordHash)) {
        set({ isLoading: false, error: 'Invalid email or password' });
        return;
      }

      const token = createToken(user.id, user.role);
      await AsyncStorage.setItem(AUTH_TOKEN_KEY, JSON.stringify(token));

      let profile: ClientProfile | null = null;
      if (user.role === 'client') {
        profile = await getProfileByUserId(user.id);
      }

      set({
        currentUser: user,
        authToken: token,
        clientProfile: profile,
        role: user.role,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err) {
      set({ isLoading: false, error: 'Sign in failed. Please try again.' });
    }
  },

  signOut: async () => {
    try {
      await AsyncStorage.multiRemove([
        AUTH_TOKEN_KEY,     // gp_auth_token (legacy)
        AUTH_USER_KEY,      // gp_auth_user (legacy)
        'supabase_token',   // real Supabase JWT
        'supabase_refresh_token', // refresh token for auto-renewal
        'user_data',        // real user data
        'needs_role_selection',
        'onboarding_complete',
        'macro_targets',
        'pending_email',
      ]);
      // Emit auth event so RootNavigator re-evaluates → shows login
      authEvents.emit();
      set({
        currentUser: null,
        authToken: null,
        clientProfile: null,
        role: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
      });
    } catch (err) {
    }
  },

  registerClient: async (data) => {
    try {
      set({ isLoading: true, error: null });

      const existing = await getUserByEmail(data.email);
      if (existing) {
        set({ isLoading: false, error: 'An account with this email already exists' });
        return;
      }

      const coach = await getCoachUser();
      if (!coach) {
        set({ isLoading: false, error: 'System error: no coach found' });
        return;
      }

      const user = await createUser({
        email: data.email,
        passwordHash: mockHash(data.password),
        firstName: data.firstName,
        lastName: data.lastName,
        role: 'client',
        coachId: coach.id,
      });

      const profile = await createProfile(user.id, coach.id);
      const token = createToken(user.id, 'client');
      await AsyncStorage.setItem(AUTH_TOKEN_KEY, JSON.stringify(token));

      set({
        currentUser: user,
        authToken: token,
        clientProfile: profile,
        role: 'client',
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err) {
      set({ isLoading: false, error: 'Registration failed. Please try again.' });
    }
  },

  refreshProfile: async () => {
    const { currentUser } = get();
    if (!currentUser || currentUser.role !== 'client') return;
    const profile = await getProfileByUserId(currentUser.id);
    set({ clientProfile: profile });
  },

  clearError: () => set({ error: null }),
}));
