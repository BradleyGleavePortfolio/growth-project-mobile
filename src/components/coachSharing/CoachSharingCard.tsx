/**
 * The one screen a client sees when linking to a coach (B-SHARE-126): names
 * the four things the coach will see; "Share with my coach" grants the four
 * fitness scopes, "Not now" continues without sharing. Both stay changeable
 * in Settings > Privacy > Coach sharing. CoachCodeSheet shows the card after
 * Join; CoachSharingPrompt shows it full screen for any other link.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { typography, radius } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { successTap, warningTap } from '../../utils/haptics';
import { track } from '../../lib/analytics';
import { logger } from '../../utils/logger';
import { coachToAskAbout, rememberNotNow, shareAllWithCoach } from '../../api/coachSharingApi';
import { coachSharingCopy as copy } from './coachSharingCopy';

/** `coachName` null: the copy says "your coach". `userId`: for remembering "Not now" on this device. */
export default function CoachSharingCard({ coachId, coachName, userId, onDone }: {
  coachId: string; coachName?: string | null; userId: string | null; onDone: (choice: 'shared' | 'not_now') => void;
}) {
  const { semanticColors: sc } = useTheme();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const name = coachName?.trim() || null;

  const share = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const ok = await shareAllWithCoach(coachId);
    setBusy(false);
    if (!ok) {
      warningTap();
      setFailed(true);
      return;
    }
    successTap();
    track('coach_sharing_choice', { choice: 'shared' });
    onDone('shared');
  }, [busy, coachId, onDone]);

  const notNow = useCallback(async () => {
    if (busy) return;
    if (userId) await rememberNotNow(userId, coachId);
    track('coach_sharing_choice', { choice: 'not_now' });
    onDone('not_now');
  }, [busy, coachId, onDone, userId]);

  return (
    <View testID="coach-sharing-card">
      <Text style={[styles.eyebrow, { color: sc.textMuted }]}>{copy.eyebrow}</Text>
      <Text style={[styles.title, { color: sc.textPrimary }]} accessibilityRole="header">{copy.title(name)}</Text>
      <Text style={[styles.body, { color: sc.textPrimary }]} testID="coach-sharing-what">{copy.what(name)}</Text>
      <Text style={[styles.small, { color: sc.textMuted }]}>{copy.later}</Text>
      <View style={styles.status} accessibilityLiveRegion="polite">
        {failed ? <Text style={[styles.small, { color: sc.accentText }]}>{copy.shareFailed}</Text> : null}
      </View>
      <Pressable
        onPress={() => void share()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={copy.share}
        accessibilityHint={copy.shareHint(name)}
        accessibilityState={{ disabled: busy, busy }}
        testID="coach-sharing-share"
        style={({ pressed }) => [styles.cta, { backgroundColor: sc.accent, opacity: pressed || busy ? 0.85 : 1 }]}
      >
        {busy ? <ActivityIndicator color={sc.textOnAccent} accessibilityLabel={copy.sharing} />
          : <Text style={[styles.ctaText, { color: sc.textOnAccent }]}>{copy.share}</Text>}
      </Pressable>
      <Pressable onPress={() => void notNow()} disabled={busy} accessibilityRole="button" accessibilityLabel={copy.notNow}
        accessibilityHint={copy.notNowHint} accessibilityState={{ disabled: busy }} testID="coach-sharing-not-now" style={styles.secondary}>
        <Text style={[styles.ctaText, { color: sc.textPrimary }]}>{copy.notNow}</Text>
      </Pressable>
    </View>
  );
}

/**
 * Full-screen ask, once per session start, for a client whose primary coach
 * (read from the server, so a coach linked at sign-up, by invite or during
 * onboarding is covered) has no sharing choice yet. Mounted by RootNavigator
 * in the client app branch (not package_prompt). Nothing on a failed read.
 */
export function CoachSharingPrompt({ userId }: { userId: string | null | undefined }) {
  const { semanticColors: sc } = useTheme();
  const [askFor, setAskFor] = useState<string | null>(null);
  useEffect(() => {
    setAskFor(null);
    if (!userId) return undefined;
    let live = true;
    coachToAskAbout(userId)
      .then((coachId) => live && coachId && setAskFor(coachId))
      .catch((err: unknown) => logger.warn('CoachSharingPrompt', 'coach sharing check failed', err));
    return () => {
      live = false;
    };
  }, [userId]);
  const close = useCallback(() => setAskFor(null), []);
  if (!askFor) return null;
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <ScrollView style={{ backgroundColor: sc.bgPrimary }} contentContainerStyle={styles.page} testID="coach-sharing-prompt">
        <CoachSharingCard coachId={askFor} userId={userId ?? null} onDone={close} />
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 64 },
  eyebrow: { ...typography.eyebrow, marginBottom: 12 },
  title: { ...typography.h2, marginBottom: 12 },
  body: { ...typography.body, marginBottom: 12 },
  small: { ...typography.bodySmall },
  status: { minHeight: 44, justifyContent: 'center', marginVertical: 8 },
  cta: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, marginTop: 8 },
  ctaText: { ...typography.bodyMd },
  secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
});
