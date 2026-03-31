/**
 * Google OAuth via Supabase + expo-auth-session.
 * 
 * Flow:
 * 1. Open Google's consent screen in a web browser
 * 2. User picks their Google account
 * 3. Google redirects back to Supabase with an auth code
 * 4. Supabase exchanges the code for a session
 * 5. We get the access_token and user data
 */
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// Ensure the browser session is completed when returning to the app
WebBrowser.maybeCompleteAuthSession();

const SUPABASE_URL = 'https://rpyfdsgxxltzutgqeouk.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJweWZkc2d4eGx0enV0Z3Flb3VrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MjE2OTAsImV4cCI6MjA4OTA5NzY5MH0.cH-yapSxmjdHgMlJiYEt6-uGzMTArgIs9tPVs29lUF0';

export interface GoogleAuthResult {
  success: boolean;
  access_token?: string;
  user?: {
    id: string;
    email: string;
    name: string;
    role?: string;
    coach_id?: string;
  };
  is_new_user?: boolean;
  error?: string;
}

export async function signInWithGoogle(): Promise<GoogleAuthResult> {
  try {
    // Build the redirect URI that Expo will use to return to our app
    const redirectUri = AuthSession.makeRedirectUri({
      scheme: 'tgp',
      path: 'auth/callback',
    });

    // Construct Supabase OAuth URL
    const supabaseAuthUrl =
      `${SUPABASE_URL}/auth/v1/authorize?provider=google` +
      `&redirect_to=${encodeURIComponent(redirectUri)}`;

    // Open the browser for Google sign-in
    const result = await WebBrowser.openAuthSessionAsync(
      supabaseAuthUrl,
      redirectUri,
    );

    if (result.type !== 'success' || !result.url) {
      return { success: false, error: 'Sign-in was cancelled' };
    }

    // Parse the tokens from the redirect URL
    // Supabase redirects with: #access_token=xxx&refresh_token=xxx&...
    const url = result.url;
    const hashFragment = url.split('#')[1];
    if (!hashFragment) {
      return { success: false, error: 'No auth data received' };
    }

    const params = new URLSearchParams(hashFragment);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');

    if (!accessToken) {
      return { success: false, error: 'No access token received' };
    }

    // Use the tokens to get the user from Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken || '',
    });

    if (sessionError || !sessionData.user) {
      return { success: false, error: sessionError?.message || 'Failed to set session' };
    }

    const supaUser = sessionData.user;

    // Now call our backend to upsert the user in our DB
    const { authApi } = await import('../services/api');
    
    // Store the token first so the API client can use it
    await AsyncStorage.setItem('supabase_token', accessToken);
    
    try {
      const response = await authApi.googleAuth(accessToken);
      const { user } = response.data;

      await AsyncStorage.setItem('user_data', JSON.stringify(user));

      return {
        success: true,
        access_token: accessToken,
        user,
        is_new_user: response.data.is_new_user,
      };
    } catch {
      // Backend call failed — but we still have Supabase auth
      // Store basic user data from Supabase directly
      const basicUser = {
        id: supaUser.id,
        email: supaUser.email || '',
        name: supaUser.user_metadata?.full_name || supaUser.email || '',
      };
      await AsyncStorage.setItem('user_data', JSON.stringify(basicUser));

      return {
        success: true,
        access_token: accessToken,
        user: basicUser,
        is_new_user: true,
      };
    }
  } catch (err: any) {
    return { success: false, error: err.message || 'Google sign-in failed' };
  }
}
