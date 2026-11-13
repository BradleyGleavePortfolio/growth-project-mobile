/**
 * SPACE-STATES-M (agent 203; owner #203-E54, 203-D27 op 2, ctx#538 style 2 "Slot band", build.py :158-162, :264-267):
 * the start-of-space row at the top of an empty space chat. A deep tile with the space's glyph (the hash for a chat
 * space, the megaphone for one only the coach posts in; hidden from screen readers), "This is the start of {space}."
 * (SPACE-STATES-W10, a header to screen readers), the space's purpose when it has one and the member count, then a
 * hairline. It draws only what the cohort list already holds (name, description, member_count): no field, no list and
 * no API call. The screen draws it only once the server let this viewer in on this visit and the space has no message.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, forestPop as fp, voiceShades } from '../../../theme/tokens';

export const startLine = (space: string): string => `This is the start of ${space}.`;

export default function SpaceStartRow({ name, purpose, members, coachOnly }: {
  name: string;
  purpose?: string | null;
  members: string;
  coachOnly: boolean;
}): React.ReactElement {
  const about = purpose?.trim();
  return (
    <View style={s.row} testID="space-chat-start">
      <View style={s.tile} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="space-chat-start-tile">
        {coachOnly
          ? <Ionicons name="megaphone-outline" size={24} color={fp.onDeep} testID="space-chat-start-megaphone" />
          : <Text style={s.hash} testID="space-chat-start-hash">#</Text>}
      </View>
      <Text style={s.title} accessibilityRole="header">{startLine(name)}</Text>
      {about ? <Text style={s.purpose} testID="space-chat-start-purpose">{about}</Text> : null}
      <Text style={s.members}>{members}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  // .s2intro: 20 16 14 padding, a 1 pt hairline under it, 4 pt below.
  row: { paddingTop: 20, paddingHorizontal: 16, paddingBottom: 14, marginBottom: 4, borderBottomWidth: 1, borderBottomColor: voiceShades.hairline },
  // .s2tile: 48 pt deep, radius 12, 12 pt under it.
  tile: { width: 48, height: 48, borderRadius: 12, backgroundColor: fp.deep, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  // The drawn hash (build.py ic('hash'), 24 pt box, 2.4 stroke): Inter 500 at 22 pt matches its height and weight.
  hash: { fontFamily: 'Inter_500Medium', fontWeight: '500', fontSize: 22, lineHeight: 26, color: fp.onDeep },
  title: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 17, lineHeight: 22, color: colors.ink },
  purpose: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, color: colors.charcoal, marginTop: 4 },
  members: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, color: fp.n700, marginTop: 6 },
});
