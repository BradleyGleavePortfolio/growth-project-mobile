import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import WelcomeScreen from '../screens/auth/WelcomeScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import CreateAccountScreen from '../screens/auth/CreateAccountScreen';
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen';
import ResetPasswordScreen from '../screens/auth/ResetPasswordScreen';
import RoleSelectionScreen from '../screens/auth/RoleSelectionScreen';
import type { SignupRoleNoticeKind } from '../lib/signupRoleNotice';
import AcceptInviteScreen from '../screens/auth/AcceptInviteScreen';
import AuthCallbackScreen from '../screens/auth/AuthCallbackScreen';
import SupportInboxScreen from '../screens/support/SupportInboxScreen';
import { Colors } from '../constants/colors';

export type AuthStackParamList = {
  Welcome: undefined;
  Login: { email?: string } | undefined;
  // CreateAccount accepts an invite_code param when arriving from a deep link
  // (`tgp://join/<code>` or `https://app.trygrowthproject.com/join/<code>`).
  // Email Pipeline v1 also passes `email` when bouncing from
  // AcceptInviteScreen so the signup form is prefilled.
  CreateAccount: { invite_code?: string; email?: string } | undefined;
  ForgotPassword: undefined;
  // Audit fix CR-1: ResetPassword consumes the access_token + refresh_token
  // pair Supabase puts in the recovery email URL fragment. Both must be
  // present for the form to submit; missing tokens render an expired-link
  // empty state. See screens/auth/ResetPasswordScreen.tsx.
  ResetPassword: { access_token?: string; refresh_token?: string } | undefined;
  // `inviteAttachError` is set when signup succeeded but the backend said
  // `invite_attached:false`; RoleSelection then shows the enter-code retry
  // state with friendly copy and the code prefilled.
  // `signupNotice` (C13) names a plain fact about the role request that the
  // user must see once (see lib/signupRoleNotice); RoleSelection also reads
  // the persisted copy, so the param is a fast path, not the only carrier.
  RoleSelection:
    | { inviteAttachError?: string; inviteCode?: string; signupNotice?: SignupRoleNoticeKind }
    | undefined;
  // Email Pipeline v1 — public accept screen. Reachable via:
  //   tgp://invite/accept/:token
  //   https://app.trygrowthproject.com/invite/accept/:token
  AcceptInvite: { token: string };
  // Idempotent landing for a stray `tgp://auth/callback` (OAuth redirect URI).
  AuthCallback: undefined;
  // In-app support (Crisp; initCrisp runs at app start regardless of auth).
  // Registered here so signup notices that say "contact support" can open
  // it before the user has reached Settings (#306 fix round 2).
  SupportInbox: undefined;
};

const Stack = createNativeStackNavigator<AuthStackParamList>();

export default function AuthNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <Stack.Screen name="Welcome" component={WelcomeScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="CreateAccount" component={CreateAccountScreen} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
      <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
      <Stack.Screen name="RoleSelection" component={RoleSelectionScreen} />
      <Stack.Screen name="AcceptInvite" component={AcceptInviteScreen} />
      <Stack.Screen name="AuthCallback" component={AuthCallbackScreen} />
      <Stack.Screen name="SupportInbox" component={SupportInboxScreen} />
    </Stack.Navigator>
  );
}
