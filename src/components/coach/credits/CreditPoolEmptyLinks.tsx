/**
 * Under coach Roman's "used up" message (CREDITSTYLE group 10, S3): Roman's
 * usual-pace line and two quiet links, "Buy {amount} of credits" (opens the
 * existing pack checkout with that pack) and "Other amounts" (opens it on the
 * list). Head coaches on builds that sell packs only; everyone else sees the
 * message as today (F6). Mounted only with featureFlags.coachAiCredits.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { SettingsStackParamList } from '../../../navigation/CoachNavigator';
import { useTheme } from '../../../theme/ThemeProvider';
import { spacing, typography } from '../../../theme/tokens';
import { TextLink } from '../../../ui';
import { useCoachCredits } from './useCoachCredits';
import { paceLine, preselectedPack } from './creditPace';
import { CREDIT_MOMENT_COPY, buyAmountLabel } from './creditCopy';

export default function CreditPoolEmptyLinks({ inset = 0, now }: { inset?: number; now?: Date }) {
  const { semanticColors: sc } = useTheme();
  const credits = useCoachCredits();
  const navigation = useNavigation<NativeStackNavigationProp<SettingsStackParamList>>();
  if (!credits?.packsSold) return null;
  const pack = preselectedPack(credits.budget, now);
  if (pack === null) return null;
  const line = paceLine('usedUp', credits.budget, true, now);
  return (
    <View style={[styles.wrap, { paddingLeft: inset }]} testID="roman-pool-empty-buy">
      {line ? <Text style={[styles.line, { color: sc.textPrimary }]}>{line}</Text> : null}
      <TextLink
        label={buyAmountLabel(pack)}
        tone="accent"
        underline={false}
        align="start"
        onPress={() => navigation.navigate('CreditPackCheckout', { preselect: pack })}
        testID="roman-pool-empty-buy-pack"
        style={styles.link}
      />
      <TextLink
        label={CREDIT_MOMENT_COPY.otherAmounts}
        align="start"
        onPress={() => navigation.navigate('CreditPackCheckout', undefined)}
        testID="roman-pool-empty-other"
        style={styles.link}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingRight: spacing.xl, paddingBottom: spacing.sm },
  line: { ...typography.bodySmall, marginBottom: spacing.xs },
  // TextLink pads its label by 4 pt; pull it back so the words line up with Roman's.
  link: { marginLeft: -4 },
});
