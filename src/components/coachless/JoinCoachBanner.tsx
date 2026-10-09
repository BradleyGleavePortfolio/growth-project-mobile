/**
 * JoinCoachBanner (owner 10-09 00:0x: "Everytime a coachless person logs on, give them a \"join a coach\"
 * banner on homepage"). CoachlessHomeSlot part "join" decides who sees it and opens its coach-code sheet.
 * "Not now" hides it for this app session only, in memory, never on disk. A new session shows it again:
 * a cold start, any sign-in or sign-out (authEvents), or a return after more than five minutes in the
 * background (the biometric gate's BACKGROUND_TIMEOUT_MS line). The button is forest outlined, not filled:
 * Home's hero already holds the screen's one filled forest action (Log a meal or Continue).
 */
import React, { useSyncExternalStore } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { layout, radius, typography } from '../../theme/tokens';
import { TextLink } from '../../ui';
import { authEvents } from '../../utils/authEvents';

export const JOIN_COACH_TITLE = 'Join a coach';
export const JOIN_COACH_BODY =
  'A coach builds your plan, checks in on you and unlocks Roman. Your own logging stays open.';
export const JOIN_BANNER_NEW_SESSION_MS = 5 * 60 * 1000;

let hidden = false;
let backgroundAt: number | null = null;
let wired = false;
const listeners = new Set<() => void>();
const setHidden = (next: boolean): void => {
  if (hidden === next) return;
  hidden = next;
  listeners.forEach((l) => l());
};

// Wired on first use, so importing this module never touches auth or AppState.
function wire(): void {
  if (wired) return;
  wired = true;
  authEvents.onAuthChange(() => setHidden(false));
  AppState.addEventListener('change', (state) => {
    if (state === 'background') backgroundAt = Date.now();
    if (state !== 'active' || backgroundAt === null) return;
    if (Date.now() - backgroundAt > JOIN_BANNER_NEW_SESSION_MS) setHidden(false);
    backgroundAt = null;
  });
}

function subscribe(listener: () => void): () => void {
  wire();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const isHidden = (): boolean => hidden;

export default function JoinCoachBanner({ offer, onJoin }: { offer?: React.ReactNode; onJoin: () => void }) {
  const { semanticColors: sc } = useTheme();
  const hiddenNow = useSyncExternalStore(subscribe, isHidden, isHidden);
  if (hiddenNow) return null;
  return (
    <View
      testID="coachless-join-banner"
      accessibilityRole="summary"
      style={[styles.card, { backgroundColor: sc.bgSurface, borderColor: sc.border }]}
    >
      <Text accessibilityRole="header" style={[styles.title, { color: sc.textPrimary }]}>{JOIN_COACH_TITLE}</Text>
      <Text style={[styles.body, { color: sc.textMuted }]}>{JOIN_COACH_BODY}</Text>
      {offer}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={JOIN_COACH_TITLE}
        accessibilityHint="Opens the coach code sheet"
        testID="coachless-join"
        onPress={onJoin}
        style={({ pressed }) => [styles.join, { borderColor: sc.accent, opacity: pressed ? 0.7 : 1 }]}
      >
        <Text style={[styles.joinLabel, { color: sc.accentText }]} maxFontSizeMultiplier={1.6}>{JOIN_COACH_TITLE}</Text>
      </Pressable>
      <TextLink
        label="Not now"
        underline={false}
        accessibilityHint="Hides this until the app is next opened"
        testID="coachless-join-not-now"
        style={styles.notNow}
        onPress={() => setHidden(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.card, padding: 20, paddingBottom: 8, marginTop: 24 },
  title: { ...typography.h3, marginBottom: 6 },
  body: { ...typography.body, marginBottom: 16 },
  join: { minHeight: layout.buttonHeight, borderWidth: 1, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  joinLabel: { ...typography.bodyMd, lineHeight: 22 },
  notNow: { marginTop: 4 },
});
