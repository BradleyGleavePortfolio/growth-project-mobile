/**
 * TutorialHomeSlot — the clinic Home additions, all behind
 * featureFlags.clientTutorial:
 *   - after a skipped (paused) tour, one quiet line that resumes it
 *     (owner decision T-5: passive re-offer, never a re-triggered prompt);
 *   - the pinned MacroExplanationCard (C08);
 *   - a "Message your coach" row into the real coach thread (HomeStack
 *     `Messages`), which the tutorial spotlights for both messaging steps.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { radius, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { featureFlags } from '../../config/featureFlags';
import { dispatchTutorial, useTutorialStore } from '../../tutorial/tutorialStore';
import MacroExplanationCard from './MacroExplanationCard';
import TutorialTarget from './TutorialTarget';
import { useCurrentUser } from '../../hooks/useCurrentUser';

export default function TutorialHomeSlot(): React.ReactElement | null {
  const { semanticColors: sc } = useTheme();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const status = useTutorialStore((s) => s.tutorial.status);
  const coachName = useTutorialStore((s) => s.payload?.coach?.display_name ?? null);
  const coachLinked = !!useCurrentUser()?.coach_id;
  if (!featureFlags.clientTutorial) return null;
  return (
    <View testID="tutorial-home-slot">
      {status === 'paused' ? (
        <Pressable
          onPress={() => dispatchTutorial({ type: 'RESUME' })}
          accessibilityRole="button"
          accessibilityLabel="Pick up the quick tour"
          accessibilityHint="Resumes the tour where you left off. It is also in Settings, under Tutorial."
          testID="tutorial-reoffer"
          style={styles.reoffer}
        >
          <Text style={[styles.reofferText, { color: sc.textMuted }]}>
            Pick up the quick tour in Settings, under Tutorial.
          </Text>
        </Pressable>
      ) : null}
      <MacroExplanationCard />
      {coachLinked ? <TutorialTarget id="home-message-coach">
        <Pressable
          onPress={() => navigation.navigate('Messages')}
          accessibilityRole="button"
          accessibilityLabel={coachName ? `Message your coach, ${coachName}` : 'Message your coach'}
          testID="home-message-coach"
          style={[styles.row, { borderColor: sc.border }]}
        >
          <View style={[styles.mono, { borderColor: sc.border }]}>
            <Text style={[styles.monoText, { color: sc.textPrimary }]}>
              {(coachName ?? 'C').trim().charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.grow}>
            <Text style={[styles.rowTitle, { color: sc.textPrimary }]}>Message your coach</Text>
            {coachName ? (
              <Text style={[styles.rowSub, { color: sc.textMuted }]}>{coachName}</Text>
            ) : null}
          </View>
          <Ionicons name="chevron-forward" size={18} color={sc.textMuted} />
        </Pressable>
      </TutorialTarget> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  reoffer: { minHeight: 44, justifyContent: 'center', marginBottom: 16 },
  reofferText: { ...typography.bodySmall },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 0.5,
    borderBottomWidth: 0.5,
    paddingVertical: 12,
    marginBottom: 32,
  },
  mono: {
    width: 40,
    height: 40,
    borderRadius: radius.chip,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  monoText: { ...typography.bodyMd },
  grow: { flex: 1 },
  rowTitle: { ...typography.bodyMd },
  rowSub: { ...typography.bodySmall },
});
