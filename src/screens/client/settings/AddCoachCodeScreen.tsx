/**
 * AddCoachCodeScreen (decision 133-14): a client without a coach adds the
 * code here from Settings. One redemption per tap through the same call the
 * in-app attach on RoleSelectionScreen uses (POST /auth/attach-invite-code),
 * with the same coach-sharing sentence and version (B-SHARE-127) and the same
 * invite error copy (lib/inviteAttachOutcome). On success the cached user
 * gains its coach and the session is re-read, so coach features appear.
 */
import React, { useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { authApi } from '../../../services/api';
import { patchUserCache } from '../../../lib/userCache';
import { inviteAttachErrorMessage } from '../../../lib/inviteAttachOutcome';
import { useCoachSharingNotice } from '../../../lib/coachSharingNotice';
import CoachSharingNotice from '../../../components/coachSharing/CoachSharingNotice';
import { useEntitlement } from '../../../entitlements/EntitlementProvider';
import { isNetworkFailure, unknownAuthFailure } from '../../../utils/authFailure';
import { authEvents } from '../../../utils/authEvents';
import { logger } from '../../../utils/logger';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, radius, typography } from '../../../theme/tokens';
import { Headline, Lede, PrimaryButton, Screen, ScreenTopBar } from '../../../ui';

interface Props {
  navigation: { goBack: () => void };
}

export default function AddCoachCodeScreen({ navigation }: Props) {
  const { semanticColors: sc, colors } = useTheme();
  const { refreshEntitlement } = useEntitlement();
  const sharingVersion = useCoachSharingNotice();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [joined, setJoined] = useState(false);
  const inFlight = useRef(false);
  const trimmed = code.trim();

  const join = async () => {
    if (inFlight.current || joined) return;
    if (!trimmed) {
      setError('Enter the invite code your coach shared.');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const res = await authApi.attachInviteCode(trimmed, sharingVersion);
      const data = (res?.data ?? {}) as { role?: string; coach_id?: string | null };
      setJoined(true);
      await patchUserCache({
        ...(typeof data.coach_id === 'string' ? { coach_id: data.coach_id } : {}),
        ...(typeof data.role === 'string' ? { role: data.role } : {}),
      }).catch((err: unknown) => logger.warn('AddCoachCode', 'user cache patch after attach failed', err));
      void refreshEntitlement().catch((err: unknown) =>
        logger.warn('AddCoachCode', 'entitlement refresh after attach failed', err));
      // Re-read the session everywhere (useCurrentUser listens for login).
      authEvents.emit('login');
    } catch (err) {
      const r = err as { response?: { status?: number; data?: { reason?: string; code?: string; message?: string } } };
      const status = r?.response?.status ?? 0;
      if (status >= 400 && status < 500) {
        setError(inviteAttachErrorMessage(
          r.response?.data?.reason ?? r.response?.data?.code ?? r.response?.data?.message ?? 'invalid',
        ));
      } else if (isNetworkFailure(err)) {
        setError('The server could not be reached. Check your connection, then try again.');
      } else {
        setError(unknownAuthFailure(err, 'role_selection').message);
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top']} testID="add-coach-code" header={<ScreenTopBar onBack={() => navigation.goBack()} />}>
      {joined ? (
        <View>
          <Headline level="h1">Coach connected</Headline>
          <Lede style={styles.lede}>Coach features now appear across the app.</Lede>
          <PrimaryButton label="Done" onPress={() => navigation.goBack()} testID="add-coach-code-done" />
        </View>
      ) : (
        <View>
          <Headline level="h1">Add a coach code</Headline>
          <Lede style={styles.lede}>Enter the code your coach shared to connect your account.</Lede>
          {error ? (
            <Text style={[styles.error, { color: colors.error }]} accessibilityRole="alert" testID="add-coach-code-error">
              {error}
            </Text>
          ) : null}
          <TextInput
            value={code}
            onChangeText={(t) => { setCode(t); if (error) setError(''); }}
            placeholder="Coach code"
            placeholderTextColor={sc.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            returnKeyType="done"
            onSubmitEditing={() => { void join(); }}
            editable={!busy}
            accessibilityLabel="Coach code"
            testID="add-coach-code-input"
            style={[styles.input, { borderColor: sc.border, color: sc.textPrimary }]}
          />
          <CoachSharingNotice version={trimmed ? sharingVersion : null} style={styles.notice} />
          <PrimaryButton label="Join coach" onPress={() => { void join(); }} loading={busy}
            accessibilityHint="Connects this account to the coach with this code" testID="add-coach-code-join" />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lede: { marginTop: 8, marginBottom: layout.sectionGap },
  error: { ...typography.bodySmall, marginBottom: 12 },
  input: {
    ...typography.body,
    minHeight: layout.buttonHeight,
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.input,
    letterSpacing: 1,
    marginBottom: 12,
  },
  notice: { marginTop: 4, marginBottom: 16 },
});
