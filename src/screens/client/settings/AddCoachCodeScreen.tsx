/**
 * AddCoachCodeScreen (decision 133-14): a client without a coach adds the
 * code here from Settings. CLIENT-POLISH-134: one coach-code endpoint for the
 * app. Settings now joins through POST /coachless/coach-code/redeem, the same
 * call as the coachless Home and Messages sheet (components/coachless/
 * CoachCodeSheet): one Idempotency-Key per attempt (reused on a retry of the
 * same code), the featured-pause refusal, the same refusal copy
 * (coachlessCopy) and the coach-sharing version (B-SHARE-127). Both write
 * through the server's one attach writer. A pasted join link (.../join/<code>,
 * tgp://join/<code>, ?code=) becomes the code inside it. On success the
 * cached user gains its coach and the session is re-read.
 */
import React, { useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { coachlessFailureOf, redeemCoachCode } from '../../../api/coachlessApi';
import { keepsIdempotencyKey, refusalLine } from '../../../components/coachless/coachlessCopy';
import { extractInviteCode } from '../../../lib/inviteCodeInput';
import { generateIdempotencyKey } from '../../../utils/idempotency';
import { patchUserCache } from '../../../lib/userCache';
import { presentJoinFrom } from '../../../lib/joinPackage';
import { useCoachSharingNotice } from '../../../lib/coachSharingNotice';
import CoachSharingNotice from '../../../components/coachSharing/CoachSharingNotice';
import { useEntitlement } from '../../../entitlements/EntitlementProvider';
import { authEvents } from '../../../utils/authEvents';
import { logger } from '../../../utils/logger';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, radius, typography } from '../../../theme/tokens';
import { Headline, Lede, PrimaryButton, Screen, ScreenTopBar } from '../../../ui';

/** The code to send: the one inside a pasted join link, else the text as typed. */
export function coachCodeFromInput(text: string): string {
  const trimmed = text.trim();
  return extractInviteCode(trimmed) ?? trimmed;
}

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
  // One attempt = one Idempotency-Key; a retry of the same code reuses it.
  const keyRef = useRef<{ code: string; key: string } | null>(null);
  const trimmed = code.trim();

  const join = async () => {
    if (inFlight.current || joined) return;
    if (!trimmed) {
      setError('Enter the code the coach shared.');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError('');
    const toSend = coachCodeFromInput(trimmed);
    const normalised = toSend.toUpperCase();
    if (!keyRef.current || keyRef.current.code !== normalised) {
      keyRef.current = { code: normalised, key: generateIdempotencyKey() };
    }
    try {
      const result = await redeemCoachCode(toSend, keyRef.current.key, sharingVersion);
      keyRef.current = null;
      // B-PACKAGE-135: the code's package screen (FinishJoining on Home) takes over.
      if (presentJoinFrom(result) || result.status === 'checkout_required') {
        if (result.status === 'attached') {
          await patchUserCache({ coach_id: result.coach.id })
            .catch((err: unknown) => logger.warn('AddCoachCode', 'user cache patch after redeem failed', err));
          authEvents.emit('login');
        }
        navigation.goBack();
        return;
      }
      setJoined(true);
      await patchUserCache({ coach_id: result.coach.id })
        .catch((err: unknown) => logger.warn('AddCoachCode', 'user cache patch after redeem failed', err));
      void refreshEntitlement().catch((err: unknown) =>
        logger.warn('AddCoachCode', 'entitlement refresh after redeem failed', err));
      // Re-read the session everywhere (useCurrentUser listens for login).
      authEvents.emit('login');
    } catch (err) {
      const failure = coachlessFailureOf(err);
      if (!keepsIdempotencyKey(failure.code)) keyRef.current = null;
      setError(refusalLine(failure));
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
          <Lede style={styles.lede}>Enter the code a coach shared to connect this account.</Lede>
          {error ? (
            <Text style={[styles.error, { color: colors.error }]} accessibilityRole="alert" testID="add-coach-code-error">
              {error}
            </Text>
          ) : null}
          <TextInput
            value={code}
            onChangeText={(t) => {
              // A pasted join link shows (and sends) the code inside it.
              setCode(t.includes('/') ? extractInviteCode(t) ?? t : t);
              if (error) setError('');
            }}
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
