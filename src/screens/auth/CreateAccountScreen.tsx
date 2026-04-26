import React, { useState } from 'react';
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
import { authApi } from '../../services/api';
import { secureStorage } from '../../services/secureStorage';
import { track, identify } from '../../lib/analytics';

interface Props {
  navigation: any;
}

type Step = 'register' | 'verify';

export default function CreateAccountScreen({ navigation }: Props) {
  const [step, setStep] = useState<Step>('register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [inviteCodeInfo, setInviteCodeInfo] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [error, setError] = useState('');

  const validatePassword = (pw: string) => {
    if (pw.length < 8) return 'Password must be at least 8 characters';
    if (!/[A-Z]/.test(pw)) return 'Password must contain at least 1 uppercase letter';
    if (!/[0-9]/.test(pw)) return 'Password must contain at least 1 number';
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pw)) return 'Password must contain at least 1 special character';
    return null;
  };

  const handleRegister = async () => {
    if (!name || !email || !password) {
      setError('Please fill in all required fields');
      return;
    }

    const pwError = validatePassword(password);
    if (pwError) {
      setError(pwError);
      return;
    }

    setLoading(true);
    setError('');
    setInviteCodeInfo('');

    const trimmedCode = inviteCode.trim();
    if (trimmedCode) {
      // Validate the invite code BEFORE creating the account so we can show
      // a clear inline error without committing a half-setup user.
      try {
        const res = await authApi.validateInviteCode(trimmedCode);
        if (!res.data?.valid) {
          setError('Invite code is not valid. Check with your coach or leave it blank.');
          setLoading(false);
          return;
        }
        if (res.data?.coach_name) {
          setInviteCodeInfo(`You'll be connected to coach ${res.data.coach_name}.`);
        }
      } catch (err: any) {
        // If the validate endpoint is unreachable, block submission — safer
        // than silently registering without the code.
        setError('Could not verify invite code. Check your connection and try again.');
        setLoading(false);
        return;
      }
    }

    try {
      await authApi.register({
        name,
        email,
        password,
        phone: phone || undefined,
        invite_code: trimmedCode || undefined,
      });

      // Backend sends a verification email — show the verify screen
      await AsyncStorage.setItem('pending_email', email);
      // Psych Report #4: Analytics — signed_up fires on successful registration
      track('signed_up', { method: 'email', has_invite_code: !!trimmedCode });
      setStep('verify');
    } catch (err: any) {
      // Show the exact backend error message if available
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
      // Try to login — Supabase rejects login if email not yet verified
      const loginRes = await authApi.login({ email, password });
      const { access_token, refresh_token, user } = loginRes.data;

      // Security: tokens go to SecureStore, not plain AsyncStorage.
      await secureStorage.setItem('supabase_token', access_token);
      if (refresh_token) await secureStorage.setItem('supabase_refresh_token', refresh_token);
      await AsyncStorage.setItem('user_data', JSON.stringify(user));

      // Mark that role selection is still needed (prevents RootNavigator
      // from jumping to ClientNavigator before the user picks a role)
      await AsyncStorage.setItem('needs_role_selection', 'true');

      // Navigate to role selection
      navigation.replace('RoleSelection');
    } catch (err: any) {
      const msg = err.response?.data?.message || '';
      if (msg.toLowerCase().includes('email') || msg.toLowerCase().includes('confirm')) {
        setError('Email not verified yet. Please check your inbox and click the link first.');
      } else {
        setError('Could not sign in. Please try again.');
      }
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleGoogleSignup = async () => {
    setLoading(true);
    setError('');
    try {
      const { signInWithGoogle } = await import('../../utils/googleAuth');
      const result = await signInWithGoogle();

      if (!result.success) {
        if (result.error !== 'Sign-in was cancelled') {
          // Surface OAuth error from the URL fragment — previously swallowed.
          const msg = result.error || 'Google sign-up failed';
          setError(msg);
          Alert.alert('Google sign-up failed', msg);
        }
        return;
      }

      // Google users are pre-verified — go to role selection
      await AsyncStorage.setItem('needs_role_selection', 'true');
      navigation.replace('RoleSelection');
    } catch (err: any) {
      setError('Google sign-up failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'verify') {
    return (
      <View style={styles.container}>
        <View style={styles.verifyContent}>
          
          <Text style={styles.verifyTitle}>Check your email</Text>
          <Text style={styles.verifyBody}>
            We sent a verification email to{'\n'}
            <Text style={styles.emailHighlight}>{email}</Text>
          </Text>
          <Text style={styles.verifySubBody}>
            Click the link in the email to verify your account, then tap the button below.
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
            <Text style={styles.backLinkText}>← Use a different email</Text>
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
        {/* Round 3: accessibility labels on header, inputs, buttons, alerts */}
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">Create account</Text>
          <Text style={styles.subtitle}>Join The Growth Project</Text>
        </View>

        {error ? (
          <View style={styles.errorBox} accessible accessibilityRole="alert" accessibilityLiveRegion="assertive">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

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

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>INVITE CODE (OPTIONAL)</Text>
          <TextInput
            style={styles.input}
            value={inviteCode}
            onChangeText={(v) => {
              setInviteCode(v);
              setInviteCodeInfo('');
            }}
            placeholder="From your coach (leave blank if none)"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel="Invite code, optional"
          />
          {inviteCodeInfo ? (
            <Text style={{ fontSize: 12, color: Colors.primary, marginTop: 6 }}>
              {inviteCodeInfo}
            </Text>
          ) : null}
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
            <Text style={styles.registerButtonText}>Create Account</Text>
          )}
        </TouchableOpacity>

        <View style={styles.divider} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity
          style={styles.googleButton}
          onPress={handleGoogleSignup}
          accessibilityRole="button"
          accessibilityLabel="Sign up with Google"
        >
          <Text style={styles.googleG}>G</Text>
          <Text style={styles.googleButtonText}>Sign up with Google</Text>
        </TouchableOpacity>

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
  // Verify step styles
  verifyContent: {
    flex: 1,
    padding: Spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  verifyIcon: { fontSize: 56, marginBottom: Spacing.lg },
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
