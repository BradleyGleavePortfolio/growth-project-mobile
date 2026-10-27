/**
 * RomanCrisisActions (CRISIS-BTN, owner "#CRISIS-2B - all 3 buttons" and "thw
 * call 911 988 buttons - Nevermind, do them!"): the actions under Roman's
 * fixed crisis reply. They come only from the server marker on that reply
 * (`safetyActions`), never from its text, and keep the server's order: the
 * first is the one forest button, the rest forest outlines on bone.
 *
 *   Call 911               opens tel:911 (first under the emergency reply)
 *   Call 988               opens tel:988 (first under the self-harm reply)
 *   Text 988               opens sms:988
 *   Message <first name>   opens the chat with the client's current coach
 *                          (Home > Messages); shown only when the server
 *                          offers it AND this signed-in client has a coach,
 *                          so a coachless client sees the number actions;
 *                          FR-880R3 (operator ruling, agent 173): hidden
 *                          while the coaching chat is closed or not yet
 *                          known (useCoachChatClosed); the numbers stay
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
import { useCoachChatClosed } from '../../hooks/useCoachChatClosed';
import { readUserCacheSync } from '../../lib/userCache';
import { useTheme } from '../../theme/ThemeProvider';
import { layout, radius, spacing, typography } from '../../theme/tokens';
import { logger } from '../../utils/logger';
import type { RomanSafetyAction } from '../../api/romanSafetyActions';

export const CRISIS_CALL_911 = 'Call 911';
/** Spaced so a screen reader says "nine one one", never a whole number. */
export const CRISIS_CALL_911_SPOKEN = 'Call 9 1 1';
export const CRISIS_CALL_988 = 'Call 988';
export const CRISIS_TEXT_988 = 'Text 988';

/** Each number action: its label, what a screen reader says, and where it opens. */
const DIAL = {
  call_911: { label: CRISIS_CALL_911, spoken: CRISIS_CALL_911_SPOKEN, url: 'tel:911' },
  call_988: { label: CRISIS_CALL_988, spoken: CRISIS_CALL_988, url: 'tel:988' },
  text_988: { label: CRISIS_TEXT_988, spoken: CRISIS_TEXT_988, url: 'sms:988' },
} as const;

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
  const offered = actions.includes('message_coach') && coached && navigation != null;
  const coachChat = useCoachChatClosed(offered ? user?.coach_id : null);
  const showCoach = offered && coachChat.known && !coachChat.closed;
  const [coachName, setCoachName] = useState<string | null>(null);

  useEffect(() => {
    if (!offered) return undefined;
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
  }, [offered]);

  const item = (code: RomanSafetyAction) => {
    if (code !== 'message_coach') {
      const dial = DIAL[code];
      return { ...dial, press: () => open(dial.url) };
    }
    const label = messageCoachLabel(coachName);
    return { label, spoken: label, press: () => navigation?.navigate('Home', { screen: 'Messages' }) };
  };

  return (
    <View style={styles.stack} testID={testID}>
      {actions
        .filter((code) => code !== 'message_coach' || showCoach)
        .map((code, i) => {
          const { label, spoken, press } = item(code);
          return i === 0 ? (
            <PrimaryButton
              key={code}
              label={label}
              accessibilityLabel={spoken}
              onPress={press}
              testID={`${testID}-${code}`}
            />
          ) : (
            <Pressable
              key={code}
              onPress={() => {
                void HapticService.softImpact();
                press();
              }}
              accessibilityRole="button"
              accessibilityLabel={spoken}
              testID={`${testID}-${code}`}
              style={({ pressed }) => [styles.outline, { borderColor: sc.accent }, pressed && styles.pressed]}
            >
              <Text style={[styles.outlineLabel, { color: sc.accentText }]} numberOfLines={1} maxFontSizeMultiplier={1.6}>
                {label}
              </Text>
            </Pressable>
          );
        })}
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
