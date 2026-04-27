import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, Typography, Spacing, Radius, Shadow } from '../../theme';
import { authApi, InvitePreview } from '../../services/api';
import { secureStorage } from '../../services/secureStorage';
import { track } from '../../lib/analytics';

interface Props {
  navigation: any;
  route?: { params?: { invite_code?: string } };
}

type Step = 'register' | 'verify';

export default function CreateAccountScreen({ navigation, route }: Props) {
  const [step, setStep] = useState<Step>('register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [inviteCode, setInviteCode] = useState(route?.params?.invite_code ?? '');
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [requireInviteCode, setRequireInviteCode] = useState(true);
  const [googleEnabled, setGoogleEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [error, setError] = useState('');

  // Pull policy from backend so the signup form matches the live invite-gating
  // rule. If the request fails, fall back to the strictest setting (require
  // invite code) so we never accidentally let a codeless client through.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await authApi.getSignupPolicy();
        if (!mounted) return;
        setRequireInviteCode(res.data?.require_invite_code ?? true);
        setGoogleEnabled(res.data?.google_signin_enabled ?? true);
      } catch {
        if (!mounted) return;
        setRequireInviteCode(true);
        setGoogleEnabled(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Auto-preview when an invite code is prefilled from a deep link.
  useEffect(() => {
    if (route?.params?.invite_code) {
      previewCode(route.params.invite_code);
    }
  }, [route?.params?.invite_code]);

  const previewCode = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) {
      setInvitePreview(null);
      return;
    }
    setPreviewLoading(true);
    try {
      // Prefer the public preview endpoint (no auth, returns coach branding).
      // Fall back to the legacy validate endpoint if preview is unavailable.
      try {
        const res = await authApi.getInvitePreview(trimmed);
        setInvitePreview(res.data ?? null);
      } catch {
        const res = await authApi.validateInviteCode(trimmed);
        setInvitePreview(res.data ?? null);
      }
    } catch {
      setInvitePreview(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const validatePassword = (pw: string) => {
    if (pw.length < 8) return 'Password must be at least 8 characters';
    if (!/[A-Z]/.test(pw)) return 'Password must contain at least 1 uppercase letter';
    if (!/[0-9]/.test(pw)) return 'Password must contain at least 1 number';
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pw)) return 'Password must contain at least 1 special character';
    return null;
  };

  const handleRegister = async () => {
    if (!name || !email || !password) {
      setError('Please complete the required fields');
      return;
    }

    const trimmedCode = inviteCode.trim();

    if (requireInviteCode && !trimmedCode) {
      setError('An invite code from your coach is required to join.');
      return;
    }

    const pwError = validatePassword(password);
    if (pwError) {
      setError(pwError);
      return;
    }

    setLoading(true);
    setError('');

    if (trimmedCode) {
      try {
        const res = await authApi.validateInviteCode(trimmedCode);
        if (!res.data?.valid) {
          setError('That invite code is not valid. Please check with your coach.');
          setLoading(false);
          return;
        }
        setInvitePreview(res.data);
      } catch {
        setError('Could not verify the invite code. Check your connection and try again.');
        setLoading(false);
        return;
      }
    }

    try {
      // When an invite code is present, prefer the dedicated signup-with-code
      // route so the backend can stamp coachId atomically. Falls back to the
      // legacy /auth/register for codeless flows when policy allows it.
      if (trimmedCode) {
        await authApi.signupWithCode({
          name,
          email,
          password,
          phone: phone || undefined,
          invite_code: trimmedCode,
        });
      } else {
        await authApi.register({
          name,
          email,
          password,
          phone: phone || undefined,
        });
      }

      await AsyncStorage.setItem('pending_email', email);
      track('signed_up', { method: 'email', has_invite_code: !!trimmedCode });
      setStep('verify');
    } catch (err: any) {
      const backendMessage = err.response?.data?.message;
      if (backendMessage) {
        setError(backendMessage);
      } else if (err.message === 'Network Error' || !err.response) {
        setError('Cannot reach server. Check your internet connection.');
      } else {
        setError('Registration failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCheckVerified = async () => {
    setVerifyLoading(true);
    setError('');

    try {
      const loginRes = await authApi.login({ email, password });
      const { access_token, refresh_token, user } = loginRes.data;

      await secureStorage.setItem('supabase_token', access_token);
      if (refresh_token) await secureStorage.setItem('supabase_refresh_token', refresh_token);
      await AsyncStorage.setItem('user_data', JSON.stringify(user));

      await AsyncStorage.setItem('needs_role_selection', 'true');

      navigation.replace('RoleSelection');
    } catch (err: any) {
      const msg = err.response?.data?.message || '';
      if (msg.toLowerCase().includes('email') || msg.toLowerCase().includes('confirm')) {
        setError('Email not yet verified. Open the link we sent and try again.');
      } else {
        setError('Could not sign in. Please try again.');
      }
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleGoogleSignup = async () => {
    const trimmedCode = inviteCode.trim();
    if (requireInviteCode && !trimmedCode) {
      setError('Enter your coach invite code before continuing with Google.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { signInWithGoogle } = await import('../../utils/googleAuth');
      const result = await signInWithGoogle({ inviteCode: trimmedCode || undefined });

      if (!result.success) {
        if (result.error !== 'Sign-in was cancelled') {
          const msg = result.error || 'Google sign-in was unsuccessful';
          setError(msg);
          Alert.alert('Google sign-in unavailable', msg);
        }
        return;
      }

      await AsyncStorage.setItem('needs_role_selection', 'true');
      navigation.replace('RoleSelection');
    } catch (err: any) {
      setError('Google sign-in was unsuccessful. Try again.');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'verify') {
    return (
      <View style={styles.container}>
        <View style={styles.verifyContent}>
          <Text style={styles.verifyTitle}>Check your inbox</Text>
          <Text style={styles.verifyBody}>
            We sent a verification link to{'\n'}
            <Text style={styles.emailHighlight}>{email}</Text>
          </Text>
          <Text style={styles.verifySubBody}>
            Confirm the link, then return here to continue.
          </Text>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.verifyButton, verifyLoading && styles.buttonDisabled]}
            onPress={handleCheckVerified}
            disabled={verifyLoading}
          >
            {verifyLoading ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <Text style={styles.verifyButtonText}>I verified my email</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setStep('register')} style={styles.backLink}>
            <Text style={styles.backLinkText}>Use a different email</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">Join your coach</Text>
          <Text style={styles.subtitle}>
            {requireInviteCode
              ? 'Enter the invite code your coach shared to begin.'
              : 'Create your account to begin.'}
          </Text>
        </View>

        {error ? (
          <View style={styles.errorBox} accessible accessibilityRole="alert" accessibilityLiveRegion="assertive">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>
            {requireInviteCode ? 'INVITE CODE' : 'INVITE CODE (OPTIONAL)'}
          </Text>
          <TextInput
            style={styles.input}
            value={inviteCode}
            onChangeText={(v) => {
              setInviteCode(v);
              setInvitePreview(null);
            }}
            onBlur={() => previewCode(inviteCode)}
            placeholder="From your coach"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel="Coach invite code"
          />
          {previewLoading ? (
            <Text style={styles.invitePreviewMuted}>Checking code…</Text>
          ) : invitePreview?.valid ? (
            <Text style={styles.invitePreviewOk}>
              You will be paired with{' '}
              {invitePreview.business_name || invitePreview.coach_name || 'your coach'}.
            </Text>
          ) : invitePreview && !invitePreview.valid ? (
            <Text style={styles.invitePreviewBad}>
              {invitePreview.reason || 'This code is not currently active.'}
            </Text>
          ) : null}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>FULL NAME</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Your full name"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="words"
            accessibilityLabel="Full name"
            textContentType="name"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>EMAIL</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@email.com"
            placeholderTextColor={Colors.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Email"
            textContentType="emailAddress"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>PASSWORD</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Min 8 chars, 1 upper, 1 number, 1 special"
            placeholderTextColor={Colors.textMuted}
            secureTextEntry
            accessibilityLabel="Password"
            accessibilityHint="Minimum 8 characters, 1 uppercase, 1 number, 1 special"
            textContentType="newPassword"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>PHONE (OPTIONAL)</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="Your phone number"
            placeholderTextColor={Colors.textMuted}
            keyboardType="phone-pad"
            accessibilityLabel="Phone number, optional"
            textContentType="telephoneNumber"
          />
        </View>

        <TouchableOpacity
          style={[styles.registerButton, loading && styles.buttonDisabled]}
          onPress={handleRegister}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Create account"
          accessibilityState={{ disabled: loading, busy: loading }}
        >
          {loading ? (
            <ActivityIndicator color={Colors.white} />
          ) : (
            <Text style={styles.registerButtonText}>Create account</Text>
          )}
        </TouchableOpacity>

        {googleEnabled && (
          <>
            <View style={styles.divider} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              style={styles.googleButton}
              onPress={handleGoogleSignup}
              accessibilityRole="button"
              accessibilityLabel="Continue with Google"
            >
              <Text style={styles.googleG}>G</Text>
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </TouchableOpacity>
          </>
        )}

        <View style={styles.signupRow}>
          <Text style={styles.signupText}>Already have an account? </Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('Login')}
            accessibilityRole="link"
            accessibilityLabel="Sign in"
          >
            <Text style={styles.signupLink}>Sign in</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flexGrow: 1, padding: Spacing.lg },
  header: { marginTop: Spacing.xl, marginBottom: Spacing.xl },
  title: { ...Typography.h1, marginBottom: Spacing.xs },
  subtitle: { ...Typography.body },
  errorBox: {
    backgroundColor: 'rgba(231, 76, 60, 0.1)',
    borderRadius: Radius.sm,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.error,
  },
  errorText: { color: Colors.error, fontSize: 14 },
  inputGroup: { marginBottom: Spacing.md },
  inputLabel: { ...Typography.label, marginBottom: Spacing.xs },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    fontSize: 16,
    color: Colors.dark,
    ...Shadow.card,
  },
  invitePreviewOk: { fontSize: 13, color: Colors.primary, marginTop: 6 },
  invitePreviewBad: { fontSize: 13, color: Colors.error, marginTop: 6 },
  invitePreviewMuted: { fontSize: 13, color: Colors.textMuted, marginTop: 6 },
  registerButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    padding: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.sm,
    ...Shadow.button,
  },
  buttonDisabled: { opacity: 0.6 },
  registerButtonText: { ...Typography.button, color: Colors.white },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: Spacing.lg,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { marginHorizontal: Spacing.sm, color: Colors.textMuted, fontSize: 14 },
  googleButton: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.card,
  },
  googleG: { fontSize: 18, fontWeight: '700', marginRight: Spacing.sm, color: Colors.dark },
  googleButtonText: { ...Typography.button, color: Colors.dark },
  signupRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: Spacing.xl,
    marginBottom: Spacing.xl,
  },
  signupText: { color: Colors.textMuted, fontSize: 15 },
  signupLink: { color: Colors.primary, fontSize: 15, fontWeight: '600' },
  verifyContent: {
    flex: 1,
    padding: Spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  verifyTitle: { ...Typography.h2, marginBottom: Spacing.md, textAlign: 'center' },
  verifyBody: {
    fontSize: 16,
    color: Colors.textMuted,
    textAlign: 'center',
    marginBottom: Spacing.sm,
    lineHeight: 24,
  },
  emailHighlight: { color: Colors.primary, fontWeight: '600' },
  verifySubBody: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    marginBottom: Spacing.xl,
    lineHeight: 22,
  },
  verifyButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    padding: Spacing.md,
    alignItems: 'center',
    width: '100%',
    ...Shadow.button,
  },
  verifyButtonText: { ...Typography.button, color: Colors.white },
  backLink: { marginTop: Spacing.lg },
  backLinkText: { color: Colors.textMuted, fontSize: 14 },
});
