/**
 * HomeRomanLine — Roman's one line on the rings Home (UI-1), between hairlines.
 *   - Coached: the existing holistic insight sentence (no new AI call; the UI-6
 *     daily brief redo revisits it) and "Ask Roman", which opens Roman chat.
 *   - Coachless (139-15: no Roman without a coach): Roman shown locked with the
 *     mockup's two lines. Status only, not a control, so there is no dead tap,
 *     and the insights read is never made.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useTheme } from '../../../theme/ThemeProvider';
import { typography } from '../../../theme/tokens';
import { featureFlags } from '../../../config/featureFlags';
import { useHolisticInsights } from '../../../hooks/useHolisticInsights';
import { TextLink } from '../../../ui';
import RomanAvatar from '../../roman/RomanAvatar';
import { LockedRomanAvatar } from '../HomeHeaderActions';

export const ROMAN_LOCKED_TITLE = 'Roman works with a coach';
export const ROMAN_LOCKED_BODY = "Roman reads your rings with a coach's guidance. Your own logging stays open.";

export default function HomeRomanLine({ coached }: { coached: boolean }) {
  return coached ? <CoachedRomanLine /> : <LockedRomanLine />;
}

function LockedRomanLine() {
  const { semanticColors: sc } = useTheme();
  return (
    <View style={[styles.row, { borderColor: sc.border }]} testID="home-roman-locked" accessible
      accessibilityLabel={`${ROMAN_LOCKED_TITLE}. ${ROMAN_LOCKED_BODY}`}>
      <LockedRomanAvatar />
      <View style={styles.text}>
        <Text style={[styles.title, { color: sc.textPrimary }]}>{ROMAN_LOCKED_TITLE}</Text>
        <Text style={[typography.bodySmall, { color: sc.textMuted }]}>{ROMAN_LOCKED_BODY}</Text>
      </View>
    </View>
  );
}

function CoachedRomanLine() {
  const { semanticColors: sc } = useTheme();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { data } = useHolisticInsights();
  const sentence = data?.status === 'ok' ? data.insights[0]?.text?.trim() ?? '' : '';
  if (!sentence && !featureFlags.romanChat) return null;
  return (
    <View style={[styles.row, { borderColor: sc.border }]} testID="home-roman-line">
      <RomanAvatar size={28} />
      <View style={styles.text}>
        {sentence ? <Text style={[styles.read, { color: sc.textPrimary }]} testID="home-roman-sentence">{sentence}</Text> : null}
        {featureFlags.romanChat ? (
          <TextLink label="Ask Roman" tone="accent" size="small" underline={false} align="start" testID="home-ask-roman"
            onPress={() => navigation.navigate('MoreTab', { screen: 'RomanChat', initial: false })} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 16, marginTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1, minWidth: 0, marginLeft: 12 },
  title: { ...typography.bodyMd, fontSize: 14, lineHeight: 22 },
  read: { ...typography.h2, fontStyle: 'italic', fontSize: 19, lineHeight: 26, letterSpacing: 0.2 },
});
