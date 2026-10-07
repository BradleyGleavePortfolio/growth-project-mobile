import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { featureFlags } from '../../../config/featureFlags';
import { useTheme } from '../../../theme/ThemeProvider';
import { typography } from '../../../theme/tokens';
import { dispatchTutorial, startClientTutorial, useTutorialStore } from '../../../tutorial/tutorialStore';

/** The existing tour actions, presented as one row inside Support. */
export default function ClientTutorialSetting() {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const status = useTutorialStore((s) => s.tutorial.status);
  if (!featureFlags.clientTutorial) return null;
  const label = status === 'paused' ? 'Resume the tour'
    : status === 'active' ? 'The tour is in progress' : 'Take the tour again';
  const onPress = () => {
    if (status === 'paused') dispatchTutorial({ type: 'RESUME' });
    else if (status !== 'active') startClientTutorial(null, { restart: true });
    navigation.getParent?.()?.navigate('Home', { screen: 'HomeMain' });
  };
  return (
    <Pressable
      onPress={onPress}
      disabled={status === 'active'}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: status === 'active' }}
      accessibilityHint="Roman shows you around the app"
      style={[styles.row, { borderBottomColor: colors.border }]}
      testID="tutorial-settings-button"
    >
      <Text style={[styles.label, { color: colors.textPrimary }]}>{label}</Text>
      {status !== 'active' ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 52,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: { ...typography.bodySmall, fontSize: 15 },
});
