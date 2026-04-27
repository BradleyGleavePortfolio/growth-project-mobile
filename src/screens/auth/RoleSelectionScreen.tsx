import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { AuthStackParamList } from '../../navigation/AuthNavigator';
import { authApi, InvitePreview } from '../../services/api';
import { authEvents } from '../../utils/authEvents';
import { Colors } from '../../constants/colors';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'RoleSelection'>;
};

// Role selection is now a client-only flow. Coach and admin promotion are
// handled by an OWNER from the web console — there is no self-serve coach
// upgrade in the mobile app.
//
// Rationale: per-seat billing means a client cannot promote themselves into a
// paid coach tier; only an admin can. Removing the in-app become-coach UI
// closes the privilege-escalation gap that existed in the prior version.
export default function RoleSelectionScreen(_: Props) {
  const [loading, setLoading] = useState(false);
  const [requireInviteCode, setRequireInviteCode] = useState(true);
  const [inviteCode, setInviteCode] = useState('');
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await authApi.getSignupPolicy();
        if (!mounted) return;
        setRequireInviteCode(res.data?.require_invite_code ?? true);
      } catch {
        if (!mounted) return;
        setRequireInviteCode(true);
      }

      // If the user already has a coach attached (e.g. they signed up with
      // an invite code, or it was attached during Google sign-in), they can
      // continue without re-entering it.
      try {
        const raw = await AsyncStorage.getItem('user_data');
        if (raw) {
          const u = JSON.parse(raw);
          if (u?.coach_id) {
            // Auto-continue silently; the screen still renders briefly to
            // avoid flashing.
          }
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const previewCode = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) {
      setInvitePreview(null);
      return;
    }
    setPreviewLoading(true);
    try {
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

  const handleContinue = async () => {
    setError('');
    const trimmed = inviteCode.trim();

    if (requireInviteCode && !trimmed) {
      setError('Enter the invite code your coach shared.');
      return;
    }

    setLoading(true);
    try {
      // If a code was supplied, attach it before completing role selection.
      if (trimmed) {
        try {
          await authApi.attachInviteCode(trimmed);
        } catch (err: any) {
          // Fall through to selectRole — selectRole accepts coach_code and
          // many backends accept the code in either path.
        }
      }

      const res = await authApi.selectRole('student', trimmed || undefined);
      const raw = await AsyncStorage.getItem('user_data');
      if (raw) {
        const user = JSON.parse(raw);
        user.role = res.data.role;
        if (res.data.coach_id) user.coach_id = res.data.coach_id;
        await AsyncStorage.setItem('user_data', JSON.stringify(user));
      }
      await AsyncStorage.removeItem('needs_role_selection');
      authEvents.emit();
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Could not complete sign-up. Please try again.';
      setError(msg);
      Alert.alert('Sign-up unavailable', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.header}>
        <Text style={styles.greeting}>One more step.</Text>
        <Text style={styles.title}>Pair with your coach</Text>
        <Text style={styles.subtitle}>
          {requireInviteCode
            ? 'Enter the invite code your coach shared. This connects you to their roster.'
            : 'If your coach shared an invite code, enter it now. Otherwise continue.'}
        </Text>
      </View>

      <View style={styles.cardsContainer}>
        <View style={styles.inputBlock}>
          <Text style={styles.label}>INVITE CODE</Text>
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
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>

        <TouchableOpacity
          style={[styles.continueBtn, loading && styles.btnDisabled]}
          onPress={handleContinue}
          disabled={loading}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Continue"
        >
          {loading ? (
            <ActivityIndicator color={Colors.textOnPrimary} />
          ) : (
            <Text style={styles.continueText}>Continue</Text>
          )}
        </TouchableOpacity>

        <View style={styles.coachNote}>
          <Ionicons name="information-circle-outline" size={16} color={Colors.textMuted} />
          <Text style={styles.coachNoteText}>
            Coach access is managed by the platform team. If you should be a coach, contact your administrator.
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: 24,
    paddingTop: 80,
  },
  header: {
    marginBottom: 40,
  },
  greeting: {
    fontSize: 16,
    color: Colors.primary,
    fontWeight: '600',
    marginBottom: 8,
  },
  title: {
    fontFamily: 'CormorantGaramond_400Regular',
    fontSize: 32,
    lineHeight: 35,
    letterSpacing: 0.6,
    fontWeight: '400',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    lineHeight: 26,
    letterSpacing: -0.16,
    color: Colors.textSecondary,
  },
  cardsContainer: {
    gap: 16,
  },
  inputBlock: {
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.textSecondary,
    letterSpacing: 1,
  },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: Colors.textPrimary,
  },
  invitePreviewOk: { fontSize: 13, color: Colors.primary, marginTop: 4 },
  invitePreviewBad: { fontSize: 13, color: Colors.error, marginTop: 4 },
  invitePreviewMuted: { fontSize: 13, color: Colors.textMuted, marginTop: 4 },
  errorText: { fontSize: 13, color: Colors.error, marginTop: 4 },
  continueBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 4,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  continueText: {
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textOnPrimary,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  coachNote: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    paddingHorizontal: 4,
    marginTop: 8,
  },
  coachNoteText: {
    flex: 1,
    fontSize: 12,
    color: Colors.textMuted,
    lineHeight: 18,
  },
});
