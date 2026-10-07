/** The coach-sharing sentence above a join button (B-SHARE-127); nothing without a version. */
import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { coachSharingNoticeText } from '../../lib/coachSharingNotice';

interface Props {
  version: string | null;
  coachName?: string | null;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

export default function CoachSharingNotice({ version, coachName, style, testID = 'coach-sharing-notice' }: Props) {
  const { colors } = useTheme();
  if (!version) return null;
  return (
    <Text style={[styles.text, { color: colors.textSecondary }, style]} testID={testID}>
      {coachSharingNoticeText(coachName)}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: 13, lineHeight: 19, marginBottom: 8 },
});
