/**
 * CoachSpacesHomeScreen (D10-BUILD-COMMUNITY; C6CHAT-S-V2 k01 with the Studio entry's Direct messages band, owner
 * #203-E25): the coach Community stack's first page while featureFlags.communityHomeV2 or communitySpaceChat is on (R1,
 * the client tab's own rule). With both off the stack keeps today's K2 page (CoachCommunityHomeScreen).
 *
 * Top to bottom: the deep masthead (Back with coachTabsV2, the monogram and "Community"); Reports, Direct messages,
 * Inbox and Events as rows (Inbox and Events are not drawn in k01: R2 keeps them so they stay one tap away); SPACES,
 * the coach's spaces in the server's order with who each is for (Clients, Package, Public; a 'members' or unknown
 * value draws no tag, R3); "+ New space". Search, Activity, layers, public invites and the welcome card wait for the
 * server (R4, v1.1). The Reports and Inbox counts and the community's name are not read here: the KT-2 scan names any
 * page that reads them (memberContentAccess.test.tsx), so they wait for their registry row (PLAN 1a).
 *
 * States: the first spaces read with nothing cached is the still s01 skeleton; a failed read with nothing to show keeps
 * the rows (none of them needs the spaces) and puts the s03 words and Try again where the spaces go, with an error
 * tick when the retry fails too; a failed refresh keeps the rows on screen. A row the Home has not drawn before (a new
 * space) carries a leaf left edge for 2 s, with no fill and no fade.
 */
import React, { useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HapticPressable from '../../components/HapticPressable';
import { ForestStatusBar } from '../../components/StatusBarBand';
import { Monogram } from '../../components/community/SpaceTree';
import { PrimaryButton } from '../../ui/buttons/PrimaryButton';
import { HapticService } from '../../ui/haptics/haptics.service';
import { featureFlags } from '../../config/featureFlags';
import { useCoachCohorts } from '../../hooks/useCoachCommunity';
import { communityKeys } from '../../hooks/useCommunity';
import type { CoachCohort } from '../../api/coachCommunityApi';
import { forestPop as fp, layout, lightTokens, typography } from '../../theme/tokens';
import type { CoachCommunityNav } from './coachCommunityNavTypes';
import { membersLabel } from './CoachCommunityInboxScreen';
import CoachDmEntry from './coach-dm/CoachDmEntryRow';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type Tag = { label: string; icon: IconName; tone: 'outline' | 'pale' | 'deep' };

/** Who a space is for, as k01 draws it (R3: 'members' and any other value draw nothing). */
const TAGS: Record<string, Tag> = {
  clients: { label: 'Clients', icon: 'people-outline', tone: 'outline' },
  package: { label: 'Package', icon: 'cube-outline', tone: 'pale' },
  public: { label: 'Public', icon: 'globe-outline', tone: 'deep' },
};
const tagOf = (c: CoachCohort): Tag | null => (c.visibility ? TAGS[c.visibility] ?? null : null);
const FRESH_MS = 2000;

function Row({ icon, title, sub, chevron, line, onPress, label, testID }: {
  icon: IconName; title: string; sub?: string; chevron?: boolean; line?: boolean; onPress: () => void; label: string; testID: string;
}): React.ReactElement {
  return (
    <HapticPressable intent="light" onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={[s.row, line && s.line]} testID={testID}>
      <Ionicons name={icon} size={24} color={fp.forest} />
      <View style={s.rowText}>
        <Text style={s.rowTitle}>{title}</Text>
        {sub ? <Text style={s.rowSub}>{sub}</Text> : null}
      </View>
      {chevron ? <Ionicons name="chevron-forward" size={20} color={fp.n700} /> : null}
    </HapticPressable>
  );
}

function SpaceTag({ tag }: { tag: Tag }): React.ReactElement {
  const deep = tag.tone === 'deep';
  return (
    <View style={[s.tag, s[tag.tone]]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="coach-home-tag">
      <Ionicons name={tag.icon} size={14} color={deep ? fp.leaf : fp.forest} />
      <Text style={[s.tagText, { color: deep ? fp.onDeep : fp.forest }]} maxFontSizeMultiplier={1.3}>{tag.label}</Text>
    </View>
  );
}

/** Ids the Home has not drawn before, once its first list is in: each is fresh for FRESH_MS. */
function useFreshIds(list: CoachCohort[] | undefined): ReadonlySet<string> {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!list) return undefined;
    const added = seen.current ? list.map((c) => c.id).filter((id) => !seen.current?.has(id)) : [];
    seen.current = new Set([...(seen.current ?? []), ...list.map((c) => c.id)]);
    if (added.length === 0) return undefined;
    setFresh(new Set(added));
    const t = setTimeout(() => setFresh(new Set()), FRESH_MS);
    return () => clearTimeout(t);
  }, [list]);
  return fresh;
}

export default function CoachSpacesHomeScreen(): React.ReactElement {
  const navigation = useNavigation<CoachCommunityNav>();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const cohorts = useCoachCohorts();
  const fresh = useFreshIds(cohorts.data);
  const [open, setOpen] = useState(true);
  const loading = cohorts.isLoading;
  const failed = !loading && cohorts.data === undefined;

  const openSpace = (c: CoachCohort) =>
    featureFlags.communitySpaceChat
      ? navigation.navigate('CommunitySpaceChat', { cohortId: c.id })
      : navigation.navigate('CoachCommunityCohortDetail', { cohortId: c.id, cohortName: c.name });
  const refresh = () => {
    void cohorts.refetch();
    void qc.invalidateQueries({ queryKey: [...communityKeys.all, 'dms'] });
  };
  const retry = async () => {
    const r = await cohorts.refetch();
    if (r.isError) void HapticService.error();
  };

  const rows = (
    <>
      <Row icon="flag-outline" title="Reports" line={!featureFlags.communityDm} onPress={() => navigation.navigate('CoachCommunityModeration')}
        label="Reports" testID="coach-home-reports" />
      <CoachDmEntry band />
      <Row icon="mail-outline" title="Inbox" sub="Unread in your inbox" line onPress={() => navigation.navigate('CoachCommunityInbox')}
        label="Inbox, Unread in your inbox" testID="coach-home-inbox" />
      {featureFlags.communityEvents ? (
        <Row icon="calendar-outline" title="Events" sub="Schedule and manage live sessions" chevron line
          onPress={() => navigation.navigate('CoachCommunityEvents')} label="Events: schedule and manage live sessions" testID="coach-home-events" />
      ) : null}
    </>
  );

  let body: React.ReactNode;
  if (loading) {
    body = (
      <View accessible accessibilityLabel="Loading your community" accessibilityState={{ busy: true }} style={s.list} testID="coach-home-loading">
        {[60, 78, 70, 86, 62, 74].map((pct) => (
          <View key={pct} style={s.skRow}>
            <View style={s.skIcon} />
            <View style={[s.skBar, { width: `${pct}%` }]} />
          </View>
        ))}
      </View>
    );
  } else {
    body = (
      <ScrollView contentContainerStyle={s.list} testID="coach-home-list"
        refreshControl={<RefreshControl refreshing={cohorts.isRefetching} onRefresh={refresh} tintColor={fp.forest} />}>
        {rows}
        {failed ? (
          <View style={s.error} testID="coach-home-error">
            <View style={s.errorTile}>
              <Ionicons name="cloud-offline-outline" size={30} color={fp.forest} />
            </View>
            <Text style={s.errorText}>Your community did not load. Check your connection, then try again.</Text>
            <PrimaryButton label="Try again" onPress={() => void retry()} style={s.retry} testID="coach-home-retry" />
          </View>
        ) : (
          <>
            <HapticPressable intent="light" onPress={() => { void HapticService.selection(); setOpen(!open); }} accessibilityRole="button"
              accessibilityLabel="Spaces" accessibilityState={{ expanded: open }} style={s.header} testID="coach-home-spaces">
              <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={16} color={fp.forest} />
              <Text style={s.headText}>Spaces</Text>
            </HapticPressable>
            {open ? (cohorts.data ?? []).filter((c) => c.kind !== 'section').map((c) => {
              const tag = tagOf(c);
              const isPublic = c.visibility === 'public';
              return (
                <HapticPressable key={c.id} intent="light" onPress={() => openSpace(c)} accessibilityRole="button"
                  accessibilityLabel={[c.name, tag?.label, isPublic ? membersLabel(c.member_count) : null].filter(Boolean).join(', ')}
                  style={[s.space, fresh.has(c.id) && s.fresh]} testID={`coach-home-space-${c.id}`}>
                  <View style={s.spaceIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    {isPublic ? <Ionicons name="globe-outline" size={22} color={fp.forest} />
                      : c.kind === 'announcement' ? <Ionicons name="megaphone-outline" size={22} color={fp.forest} />
                        : <Text style={s.hash}>#</Text>}
                  </View>
                  <View style={s.rowText}>
                    <Text numberOfLines={1} style={s.spaceName}>{c.name}</Text>
                    {isPublic ? <Text style={s.members}>{membersLabel(c.member_count)}</Text> : null}
                  </View>
                  {tag ? <SpaceTag tag={tag} /> : null}
                </HapticPressable>
              );
            }) : null}
            <HapticPressable intent="light" onPress={() => navigation.navigate('CoachCommunityNewSpace')} accessibilityRole="button"
              accessibilityLabel="New space" style={s.newSpace} testID="coach-home-new-space">
              <Ionicons name="add" size={26} color={fp.forest} />
              <Text style={s.newSpaceText}>New space</Text>
            </HapticPressable>
          </>
        )}
      </ScrollView>
    );
  }

  return (
    <View style={s.page} testID="coach-home">
      <ForestStatusBar />
      <View style={[s.masthead, { paddingTop: insets.top + 12 }]}>
        <View style={s.titleRow}>
          {featureFlags.coachTabsV2 ? (
            <HapticPressable intent="light" onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Back"
              style={s.back} testID="community-back">
              <Ionicons name="arrow-back" size={24} color={fp.onDeep} />
            </HapticPressable>
          ) : null}
          {loading ? (
            <>
              <View style={s.skTile} />
              <View style={s.skName} />
            </>
          ) : (
            <>
              {failed ? null : <Monogram name="Community" />}
              <Text accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={1.3} style={s.name}>Community</Text>
            </>
          )}
        </View>
      </View>
      <View style={s.body}>{body}</View>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: fp.surface },
  masthead: { backgroundColor: fp.deep, paddingHorizontal: 16, paddingBottom: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: layout.touchMin },
  back: { width: layout.touchMin, height: layout.touchMin, justifyContent: 'center' },
  name: { ...typography.h2, fontSize: 28, lineHeight: 36, color: fp.onDeep, flex: 1 },
  body: { flex: 1 },
  list: { paddingBottom: 32 },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8, paddingHorizontal: 18 },
  line: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: lightTokens.border },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 16.5, fontWeight: '600', color: fp.ink },
  rowSub: { fontFamily: 'Inter_400Regular', fontSize: 13.5, color: fp.n700 },
  header: { minHeight: layout.touchMin, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, marginTop: 8 },
  headText: { ...typography.eyebrow, fontFamily: 'Inter_600SemiBold', fontSize: 12, lineHeight: 16, letterSpacing: 1.4, color: fp.forest },
  space: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8, paddingHorizontal: 14, borderLeftWidth: 4, borderLeftColor: 'transparent' },
  fresh: { borderLeftColor: fp.leaf },
  spaceIcon: { width: 24, alignItems: 'center' },
  hash: { fontFamily: 'Inter_400Regular', fontSize: 22, lineHeight: 26, color: fp.forest },
  spaceName: { ...typography.h4, fontFamily: 'Inter_400Regular', color: fp.ink },
  members: { fontFamily: 'Inter_400Regular', fontSize: 13.5, color: fp.brand400 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'transparent' },
  outline: { borderColor: fp.sageLine },
  pale: { backgroundColor: fp.sage },
  deep: { backgroundColor: fp.deep },
  tagText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, lineHeight: 16 },
  newSpace: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 17, marginTop: 4 },
  newSpaceText: { fontFamily: 'Inter_600SemiBold', fontSize: 17, color: fp.forest },
  error: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 40, gap: 16 },
  errorTile: { width: 64, height: 64, borderRadius: 16, backgroundColor: fp.sage, alignItems: 'center', justifyContent: 'center' },
  errorText: { ...typography.body, color: fp.ink, textAlign: 'center' },
  retry: { alignSelf: 'stretch' },
  skTile: { width: 44, height: 44, borderRadius: 12, backgroundColor: fp.forest },
  skName: { height: 22, width: '55%', borderRadius: 8, backgroundColor: fp.forest },
  skRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 16 },
  skIcon: { width: 22, height: 22, borderRadius: 6, backgroundColor: fp.sage },
  skBar: { height: 14, borderRadius: 7, backgroundColor: fp.sage },
});
