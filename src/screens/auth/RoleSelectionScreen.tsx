import React, { useEffect, useState, useMemo } from 'react';
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
import { errorMessage } from '../../types/common';
import { authApi, InvitePreview } from '../../services/api';
import { authEvents } from '../../utils/authEvents';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { readUserCache, setUserCache } from '../../lib/userCache';
import { purgePersistedQueryCacheForAllUsers } from '../../services/queryClient';

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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
      // an invite code, or it was attached during Google sign-in), skip role
      // selection entirely — the backend already knows their coach and the
      // form would just re-collect a code we no longer need.
      try {
        const u = await readUserCache();
      if (u) {
          if (mounted && u?.coach_id) {
            await AsyncStorage.removeItem('needs_role_selection');
            authEvents.emit();
            return;
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
      //
      // Audit fix H-4: the attachInviteCode call used to swallow every
      // failure silently and rely on the second-line selectRole call
      // to surface bad-code errors. That worked in practice — the
      // server re-validates inside selectRole — but if the contracts
      // ever drift, a partial signup with no coach link goes
      // undetected. We now special-case 4xx (an invalid / expired /
      // capped code) and re-throw so the outer catch surfaces the
      // server message verbatim. Transient failures (5xx, network)
      // still fall through so selectRole can retry — this preserves
      // the resilience the comment described.
      if (trimmed) {
        try {
          await authApi.attachInviteCode(trimmed);
        } catch (err) {
          const status =
            (err as { response?: { status?: number } } | undefined)?.response?.status ?? 0;
          if (status >= 400 && status < 500) throw err;
          if (__DEV__) {
            console.warn('attachInviteCode transient failure, retrying via selectRole', err);
          }
        }
      }

      const res = await authApi.selectRole('student', trimmed || undefined);
      const user = await readUserCache();
      if (user) {
        user.role = res.data.role;
        if (res.data.coach_id) user.coach_id = res.data.coach_id;
        setUserCache(user);
        // P1-1 (PR #192): purge any orphan persisted cache blobs written under a
        // stale boot-time key before the first persistence pass for this user.
        await purgePersistedQueryCacheForAllUsers();
      }
      await AsyncStorage.removeItem('needs_role_selection');
      authEvents.emit();
    } catch (err) {
      const msg = errorMessage(err, 'Could not complete sign-up. Please try again.');
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
            placeholderTextColor={colors.textMuted}
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
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <Text style={styles.continueText}>Continue</Text>
          )}
        </TouchableOpacity>

        <View style={styles.coachNote}>
          <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
          <Text style={styles.coachNoteText}>
            Coach access is managed by the platform team. If you should be a coach, contact your administrator.
          </Text>
        </View>
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 24,
    paddingTop: 80,
  },
  header: {
    marginBottom: 40,
  },
  greeting: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: '600',
    marginBottom: 8,
  },
  title: {
    fontFamily: 'CormorantGaramond_400Regular',
    fontSize: 32,
    lineHeight: 35,
    letterSpacing: 0.6,
    fontWeight: '400',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    lineHeight: 26,
    letterSpacing: -0.16,
    color: colors.textSecondary,
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
    color: colors.textSecondary,
    letterSpacing: 1,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.textPrimary,
  },
  invitePreviewOk: { fontSize: 13, color: colors.primary, marginTop: 4 },
  invitePreviewBad: { fontSize: 13, color: colors.error, marginTop: 4 },
  invitePreviewMuted: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  errorText: { fontSize: 13, color: colors.error, marginTop: 4 },
  continueBtn: {
    backgroundColor: colors.primary,
    borderRadius: 4,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  continueText: {
    fontFamily: 'Inter_600SemiBold',
    color: colors.textOnPrimary,
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
    color: colors.textMuted,
    lineHeight: 18,
  },

  });
