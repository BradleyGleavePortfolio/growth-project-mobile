/**
 * RomanCrisisActions (CRISIS-BTN, owner "#CRISIS-2B - all 3 buttons"): the
 * actions under Roman's fixed crisis reply. They come only from the server
 * marker on that reply (`safetyActions`), never from its text.
 *
 *   Call 988               the one forest button, opens tel:988
 *   Text 988               forest outline on bone, opens sms:988
 *   Message <first name>   forest outline, opens the chat with the client's
 *                          current coach (Home > Messages); shown only when
 *                          the server offers it AND this signed-in client has
 *                          a coach, so a coachless client sees the two 988s
 *
 * 12 pt corners (radius.button), every target 48 pt or taller, stacked so
 * 130% text and long names never clip. A soft tap haptic on each press and
 * none on arrival: a calm moment, not an alarm.
 */
import React, { useContext, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
import { PrimaryButton } from '../../ui/buttons/PrimaryButton';
import { HapticService } from '../../ui/haptics/haptics.service';
import { messageCoachLabel } from '../home/HomeHeaderActions';
import api from '../../services/api';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { readUserCacheSync } from '../../lib/userCache';
import { useTheme } from '../../theme/ThemeProvider';
import { layout, radius, spacing, typography } from '../../theme/tokens';
import { logger } from '../../utils/logger';
import type { RomanSafetyAction } from '../../api/romanSafetyActions';

export const CRISIS_CALL_988 = 'Call 988';
export const CRISIS_TEXT_988 = 'Text 988';

function open(url: string): void {
  Linking.openURL(url).catch(() => logger.warn('roman.crisis_action_open_failed', url.split(':')[0]));
}

export interface RomanCrisisActionsProps {
  actions: readonly RomanSafetyAction[];
  testID?: string;
}

export default function RomanCrisisActions({ actions, testID = 'roman-crisis' }: RomanCrisisActionsProps): React.ReactElement {
  const { semanticColors: sc } = useTheme();
  const navigation = useContext(NavigationContext);
  const currentUser = useCurrentUser();
  const user = readUserCacheSync() ?? currentUser;
  const coached = user?.role === 'student' && Boolean(user.coach_id);
  const showCoach = actions.includes('message_coach') && coached && navigation != null;
  const [coachName, setCoachName] = useState<string | null>(null);

  useEffect(() => {
    if (!showCoach) return undefined;
    let mounted = true;
    api
      .get<{ name?: unknown }>('/v1/clients/me/coach')
      .then((res) => {
        if (mounted && typeof res?.data?.name === 'string') setCoachName(res.data.name);
      })
      .catch(() => undefined); // keeps "Message your coach"
    return () => {
      mounted = false;
    };
  }, [showCoach]);

  const outline = (label: string, onPress: () => void, id: string) => (
    <Pressable
      key={id}
      onPress={() => {
        void HapticService.softImpact();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`${testID}-${id}`}
      style={({ pressed }) => [styles.outline, { borderColor: sc.accent }, pressed && styles.pressed]}
    >
      <Text style={[styles.outlineLabel, { color: sc.accentText }]} numberOfLines={1} maxFontSizeMultiplier={1.6}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={styles.stack} testID={testID}>
      {actions.includes('call_988') ? (
        <PrimaryButton label={CRISIS_CALL_988} onPress={() => open('tel:988')} testID={`${testID}-call`} />
      ) : null}
      {actions.includes('text_988') ? outline(CRISIS_TEXT_988, () => open('sms:988'), 'text') : null}
      {showCoach
        ? outline(messageCoachLabel(coachName), () => navigation?.navigate('Home', { screen: 'Messages' }), 'coach')
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  outline: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.button,
    paddingHorizontal: layout.gutter,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  outlineLabel: { ...typography.bodyMd, lineHeight: 22, letterSpacing: 0.1, textAlign: 'center' },
});
