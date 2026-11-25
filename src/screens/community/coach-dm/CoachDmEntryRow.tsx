/**
 * COACH-DM-M: the one Direct messages row on today's coach Community home (operator ruling 01:2x: Studio's whole new
 * home is not built). Drawn only with featureFlags.communityDm, as the client's DMs are; the stack itself mounts only
 * with featureFlags.coachCommunity. "{n} conversations" shows only when the list read is whole (fewer rows than the
 * 100 asked); not when DMs are off, the read failed or the page is full.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../../../components/HapticPressable';
import { featureFlags } from '../../../config/featureFlags';
import { colors, forestPop as fp, radius } from '../../../theme/tokens';
import type { CoachCommunityNav } from '../coachCommunityNavTypes';
import { COACH_DM_LIMIT, useCoachDms } from './coachDm';

export default function CoachDmEntry(): React.ReactElement | null {
  return featureFlags.communityDm ? <EntryRow /> : null;
}

function EntryRow(): React.ReactElement {
  const navigation = useNavigation<CoachCommunityNav>();
  const { threads, off } = useCoachDms();
  const n = threads.data?.length;
  const count = off || !threads.isSuccess || n === undefined || n >= COACH_DM_LIMIT ? null
    : n === 0 ? 'No conversations yet' : n === 1 ? '1 conversation' : `${n} conversations`;
  return (
    <HapticPressable intent="light" onPress={() => navigation.navigate('CoachCommunityDmList')} accessibilityRole="button"
      accessibilityLabel={count ? `Direct messages, ${count}` : 'Direct messages'} testID="coach-dm-entry" style={styles.card}>
      <Ionicons name="chatbox-outline" size={22} color={fp.forest} />
      <View style={styles.text}>
        <Text style={styles.title}>Direct messages</Text>
        {count ? <Text style={styles.sub} testID="coach-dm-entry-count">{count}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={20} color={fp.n700} />
    </HapticPressable>
  );
}

// Studio's Direct messages row (S_entry_ios.html .row :56 on #E0EBE4, .nm :57, .meta :58; operator ruling "962 entry row
// as built", #203-E31), inside today's home column, which keeps its corners (01:2x). One light palette in both themes.
const styles = StyleSheet.create({
  card: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8, paddingHorizontal: 18, borderRadius: radius.lg, backgroundColor: fp.sage },
  text: { flex: 1, gap: 2 },
  title: { fontFamily: 'Inter_600SemiBold', fontSize: 16.5, fontWeight: '600', color: colors.ink },
  sub: { fontFamily: 'Inter_400Regular', fontSize: 13.5, color: fp.n700 },
});
