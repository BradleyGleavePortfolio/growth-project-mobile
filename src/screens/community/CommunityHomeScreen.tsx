/**
 * CommunityHomeScreen (C6-M1S; C6CHAT-S-V2 c01, MOCK-COMMX2 board): the client
 * Community tab's root while featureFlags.communityHomeV2 is on.
 *
 * A deep masthead holds the community's monogram and name (GET
 * /community/workspaces/:id; "Community" until it arrives) and Search with
 * communitySearch. Under it the segment on a forest track: Home, then
 * Challenges with communityChallenges (owner: "Home, Activity, then
 * Challenges"; Activity takes its place between them when its feed ships, so
 * no tab is drawn without a page). The leaf pill slides 180 ms with a
 * selection tick; Reduce Motion moves it at once. One segment means no
 * control. Home opens first on every launch.
 *
 * Home is the space tree (SpaceTree) and Community safety. Loading is a still
 * skeleton; a failed read says so with Try again, and an error tick when the
 * retry fails too.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HapticPressable from '../../components/HapticPressable';
import { Monogram, SpaceTree, useOpenSpaceTarget, useSpaceTree } from '../../components/community/SpaceTree';
import CommunityChallengesScreen from './CommunityChallengesScreen';
import { PrimaryButton } from '../../ui/buttons/PrimaryButton';
import { HapticService } from '../../ui/haptics/haptics.service';
import { featureFlags } from '../../config/featureFlags';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { forestPop as fp, layout, motion, typography } from '../../theme/tokens';
import type { CommunityNav } from './communityNavTypes';

type Tab = 'home' | 'challenges';
const LABEL: Record<Tab, string> = { home: 'Home', challenges: 'Challenges' };

function Segment({ tabs, value, onChange }: { tabs: Tab[]; value: Tab; onChange: (t: Tab) => void }): React.ReactElement {
  const reduce = useReducedMotion();
  const [w, setW] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  const at = tabs.indexOf(value) * w;
  useEffect(() => {
    if (reduce) x.setValue(at);
    else Animated.timing(x, { toValue: at, duration: 180, easing: Easing.bezier(...motion.easing.decel), useNativeDriver: true }).start();
  }, [at, reduce, x]);
  return (
    <View accessibilityRole="tablist" style={s.track} onLayout={(e) => setW((e.nativeEvent.layout.width - 8) / tabs.length)}>
      {w > 0 ? <Animated.View style={[s.pill, { width: w, transform: [{ translateX: x }] }]} /> : null}
      {tabs.map((t) => (
        <Pressable
          key={t}
          accessibilityRole="tab"
          accessibilityState={{ selected: t === value }}
          onPress={() => {
            if (t === value) return;
            void HapticService.selection();
            onChange(t);
          }}
          style={s.seg}
          testID={`community-home-tab-${t}`}
        >
          <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={[s.segLabel, { color: t === value ? fp.ink : fp.onDeepMuted }]}>
            {LABEL[t]}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function CommunityHomeScreen(): React.ReactElement {
  const navigation = useNavigation<CommunityNav>();
  const insets = useSafeAreaInsets();
  const tree = useSpaceTree();
  const openTarget = useOpenSpaceTarget();
  const tabs: Tab[] = featureFlags.communityChallenges ? ['home', 'challenges'] : ['home'];
  const [tab, setTab] = useState<Tab>('home');
  const ready = !tree.loading && !tree.failed;

  let body: React.ReactNode;
  if (tree.loading) {
    body = (
      <View accessible accessibilityLabel="Loading your community" accessibilityState={{ busy: true }} style={s.list} testID="community-home-loading">
        {[60, 78, 70, 86, 62, 74].map((pct) => (
          <View key={pct} style={s.skRow}>
            <View style={s.skIcon} />
            <View style={[s.skBar, { width: `${pct}%` }]} />
          </View>
        ))}
      </View>
    );
  } else if (tree.failed) {
    body = (
      <View style={s.error} testID="community-home-error">
        <View style={s.errorTile}>
          <Ionicons name="cloud-offline-outline" size={30} color={fp.forest} />
        </View>
        <Text style={s.errorText}>Your community did not load. Check your connection, then try again.</Text>
        <PrimaryButton label="Try again" onPress={() => void tree.retry()} style={s.retry} testID="community-home-retry" />
      </View>
    );
  } else if (tab === 'challenges') {
    body = <CommunityChallengesScreen embedded />;
  } else {
    body = (
      <ScrollView contentContainerStyle={s.list} testID="community-home-list">
        <SpaceTree sections={tree.sections} onOpen={openTarget} />
        {/* Apple 1.2: guidelines, report/block help, contact and block list. */}
        <HapticPressable
          intent="light"
          onPress={() => navigation.navigate('CommunitySafety')}
          accessibilityRole="button"
          accessibilityLabel="Community safety: guidelines, reporting, blocking and contact"
          style={s.safety}
          testID="community-home-safety"
        >
          <Ionicons name="shield-checkmark-outline" size={18} color={fp.n700} />
          <Text style={s.safetyText}>Community safety</Text>
        </HapticPressable>
      </ScrollView>
    );
  }

  return (
    <View style={s.page} testID="community-home">
      <View style={[s.masthead, { paddingTop: insets.top + 12 }]}>
        <View style={s.titleRow}>
          {tree.loading ? (
            <>
              <View style={s.skTile} />
              <View style={s.skName} />
            </>
          ) : (
            <>
              {ready ? <Monogram name={tree.name} /> : null}
              <Text accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={1.3} style={s.name}>
                {ready ? tree.name : 'Community'}
              </Text>
            </>
          )}
          {ready && featureFlags.communitySearch ? (
            <HapticPressable
              intent="light"
              onPress={() => navigation.navigate('CommunityFind')}
              accessibilityRole="button"
              accessibilityLabel="Search"
              style={s.search}
              testID="community-home-search"
            >
              <Ionicons name="search" size={22} color={fp.onDeep} />
            </HapticPressable>
          ) : null}
        </View>
        {tabs.length > 1 && tree.loading ? <View style={s.skTrack} /> : null}
        {tabs.length > 1 && ready ? <Segment tabs={tabs} value={tab} onChange={setTab} /> : null}
      </View>
      <View style={s.body}>{body}</View>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: fp.surface },
  masthead: { backgroundColor: fp.deep, paddingHorizontal: 16, paddingBottom: 14, gap: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: layout.touchMin },
  name: { ...typography.h2, fontSize: 28, lineHeight: 36, color: fp.onDeep, flex: 1 },
  search: { width: layout.touchMin, height: layout.touchMin, borderRadius: 12, backgroundColor: fp.forest, alignItems: 'center', justifyContent: 'center' },
  track: { flexDirection: 'row', padding: 4, borderRadius: 12, backgroundColor: fp.forest },
  pill: { position: 'absolute', top: 4, bottom: 4, left: 4, borderRadius: 9, backgroundColor: fp.leaf },
  seg: { flex: 1, minHeight: layout.touchMin, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  segLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 20 },
  body: { flex: 1 },
  list: { paddingTop: 4, paddingBottom: 32 },
  safety: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: layout.touchMin, paddingHorizontal: 20, marginTop: 16 },
  safetyText: { ...typography.bodySmall, color: fp.n700 },
  error: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 64, gap: 16 },
  errorTile: { width: 64, height: 64, borderRadius: 16, backgroundColor: fp.sage, alignItems: 'center', justifyContent: 'center' },
  errorText: { ...typography.body, color: fp.ink, textAlign: 'center' },
  retry: { alignSelf: 'stretch' },
  skTile: { width: 44, height: 44, borderRadius: 12, backgroundColor: fp.forest },
  skName: { height: 22, width: '55%', borderRadius: 8, backgroundColor: fp.forest },
  skTrack: { height: 52, borderRadius: 12, backgroundColor: fp.forest },
  skRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 16 },
  skIcon: { width: 22, height: 22, borderRadius: 6, backgroundColor: fp.sage },
  skBar: { height: 14, borderRadius: 7, backgroundColor: fp.sage },
});
