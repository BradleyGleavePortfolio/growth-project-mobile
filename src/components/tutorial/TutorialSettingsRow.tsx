/**
 * TutorialSettingsRow — Settings > Tutorial (featureFlags.clientTutorial).
 * Resumes a skipped tour where it stopped, or runs it again from the start
 * after completion. Renders nothing when the flag is off.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { radius, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { featureFlags } from '../../config/featureFlags';
import {
  dispatchTutorial,
  startClientTutorial,
  useTutorialStore,
} from '../../tutorial/tutorialStore';

export default function TutorialSettingsRow(): React.ReactElement | null {
  const { semanticColors: sc } = useTheme();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const status = useTutorialStore((s) => s.tutorial.status);
  if (!featureFlags.clientTutorial) return null;

  const label =
    status === 'paused'
      ? 'Resume the tour'
      : status === 'active'
        ? 'The tour is in progress'
        : 'Take the tour again';
  const onPress = () => {
    if (status === 'paused') dispatchTutorial({ type: 'RESUME' });
    else if (status !== 'active') startClientTutorial(null, { restart: true });
    navigation.getParent?.()?.navigate('Home', { screen: 'HomeMain' });
  };

  return (
    <View testID="tutorial-settings-row">
      <Text style={[styles.section, { color: sc.textMuted }]}>Tutorial</Text>
      <Pressable
        onPress={onPress}
        disabled={status === 'active'}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: status === 'active' }}
        accessibilityHint="Roman shows you around the app"
        style={[styles.row, { borderColor: sc.border, backgroundColor: sc.bgSurface }]}
        testID="tutorial-settings-button"
      >
        <Text style={[styles.label, { color: sc.textPrimary }]}>{label}</Text>
        {status !== 'active' ? (
          <Ionicons name="chevron-forward" size={18} color={sc.textMuted} />
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { ...typography.eyebrow, marginTop: 24, marginBottom: 8 },
  row: {
    minHeight: 52,
    borderWidth: 0.5,
    borderRadius: radius.button,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: { ...typography.bodyMd },
});
