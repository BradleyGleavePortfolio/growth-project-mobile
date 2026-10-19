/**
 * UI-4 (V1_1_UI_SPEC, owner 2026-10-09) — the coach's client lookup, behind
 * featureFlags.coachClientLookup. Under 15 active clients: Needs you (concept
 * 1). 15 or more: Search first (concept 3) with concept 2's A to Z sections
 * and side index under "Opened recently". Mockups and HTML:
 * tgp-agent-context planning/v1_1_ui/ui-4-client-lookup/.
 */
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import HapticPressable from '../../../components/HapticPressable';
import type { ClientsStackParamList } from '../../../navigation/CoachNavigator';
import { CoachTeamEntryContext } from '../../../navigation/coachTeamEntry';
import { coachLandingTab } from '../../../navigation/coachLanding';
import PushPermissionCard from '../../../components/home/PushPermissionCard';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { coachApi } from '../../../services/api';
import { ROSTER_PAGE_SIZE, useCoachStore } from '../../../store/coachStore';
import { useTheme } from '../../../theme/ThemeProvider';
import { colors as palette, layout, radius, typography } from '../../../theme/tokens';
import { Overline, useScreenInsets } from '../../../ui';
import { QuietError, QuietLoading } from '../../../ui/states/QuietStates';
import { EmptyStateNoResults } from '../../../ui/empty-states';
import { matchesRosterSearch, rosterDisplayName, sortRoster, type RosterClient } from '../../../utils/coach/clientRoster';
import {
  FILTER_LABELS, SEARCH_FIRST_AT, firstName, groupByLetter, initialsOf, lastLoggedWord, lookupReason, matchesLookupFilter,
  needsYouSentence, parseLookupQuery, readRecentClientIds, recentFromRoster, rememberRecentClient,
  type LookupAction, type LookupFilter, type LookupReason, type UnreadByClient,
} from '../../../utils/coach/clientLookup';
import { useLookupNudge } from './useLookupNudge';
import ClientPeekSheet, { type PeekTarget } from './ClientPeekSheet';

type Props = { navigation: NativeStackNavigationProp<ClientsStackParamList, 'ClientsList'> };
const FILTERS = Object.keys(FILTER_LABELS) as LookupFilter[];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const ACTION_LABEL: Record<LookupAction, string> = { review: 'Review', reply: 'Reply', nudge: 'Nudge', hello: 'Say hello' };

export default function ClientLookupScreen({ navigation }: Props) {
  const theme = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { colors } = theme;
  const insets = useScreenInsets();
  const coachId = useCurrentUser()?.id;
  const { clients, isLoading, loadError, filterStatus, loadClients, setFilterStatus } = useCoachStore();
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<LookupFilter | null>(null);
  const [unread, setUnread] = useState<UnreadByClient>({});
  const [archivedCount, setArchivedCount] = useState<number | null>(null);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [peek, setPeek] = useState<RosterClient | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const sectionY = useRef<Record<string, number>>({});
  const azBase = useRef(0);
  const focusedOnce = useRef(false);
  const [everyoneY, setEveryoneY] = useState<number | null>(null);
  const activeTotal = useRef<number | null>(null);
  const nudge = useLookupNudge(colors);
  const teamEntry = useContext(CoachTeamEntryContext); // COACHTABS: a Team Mode head coach opens Team here, as on today's list
  const archived = filterStatus === 'archived';

  const loadSide = useCallback(async () => {
    if (!coachId) return;
    setRecentIds(await readRecentClientIds(coachId));
    const [u, a] = await Promise.allSettled([coachApi.getUnreadCounts(), coachApi.getClients('archived', undefined, ROSTER_PAGE_SIZE)]);
    // A failed unread read keeps the counts already shown. The archived count shows only when one page holds them all.
    if (u.status === 'fulfilled') setUnread((u.value?.data?.by_client as UnreadByClient) ?? {});
    const rows: unknown = a.status === 'fulfilled' ? a.value?.data : null;
    setArchivedCount(Array.isArray(rows) && rows.length < ROSTER_PAGE_SIZE ? rows.length : null);
  }, [coachId]);

  useEffect(() => {
    if (coachId) loadClients(coachId, filterStatus);
  }, [coachId, filterStatus, loadClients]);
  useEffect(() => {
    void loadSide();
    return navigation.addListener('focus', () => {
      if (!focusedOnce.current) return void (focusedOnce.current = true); // the mount, loaded above
      if (coachId) loadClients(coachId, filterStatus, { silent: true });
      void loadSide();
    });
  }, [navigation, coachId, filterStatus, loadClients, loadSide]);

  const onRefresh = useCallback(async () => {
    if (!coachId) return;
    setRefreshing(true);
    await Promise.all([loadClients(coachId, filterStatus, { silent: true }), loadSide()]).finally(() => setRefreshing(false));
  }, [coachId, filterStatus, loadClients, loadSide]);

  const roster = useMemo(() => sortRoster(clients, 'name'), [clients]);
  if (!archived && !isLoading && !loadError) activeTotal.current = roster.length;
  const known = !isLoading && !loadError;
  const searchFirst = archived || (activeTotal.current ?? roster.length) >= SEARCH_FIRST_AT;
  const parsed = parseLookupQuery(query);
  const filters = chip && !parsed.filters.includes(chip) ? [...parsed.filters, chip] : parsed.filters;
  const narrowing = parsed.text.length > 0 || filters.length > 0;
  const results = roster.filter((c) => matchesRosterSearch(c, parsed.text) && filters.every((f) => matchesLookupFilter(c, f, unread)));
  const recent = recentFromRoster(recentIds, archived ? [] : roster);

  // A row tap opens the peek sheet (and Opened recently); each sheet button opens today's screen for it.
  const openClient = (c: RosterClient) => {
    if (coachId) void rememberRecentClient(coachId, c.id).then(setRecentIds);
    setPeek(c);
  };
  const openTarget = (c: RosterClient, t: PeekTarget) => {
    setPeek(null);
    const p = { clientId: c.id, clientName: rosterDisplayName(c) };
    if (t.screen === 'ClientDetail') navigation.navigate('ClientDetail', t.tab ? { ...p, initialTab: t.tab } : p);
    else if (t.screen === 'ClientPayments') navigation.navigate('ClientPayments', p);
    else navigation.navigate('ClientMessages', p);
  };
  const openMessages = (c: RosterClient) => openTarget(c, { screen: 'ClientMessages' });
  const runAction = (c: RosterClient, a: LookupAction) =>
    a === 'review' ? openTarget(c, { screen: 'ClientDetail', tab: 'timeline' }) : a === 'nudge' ? nudge.open(c) : openMessages(c);
  const toggleArchived = () => { setChip(null); setFilterStatus(archived ? 'active' : 'archived'); };
  const jumpTo = (letter: string) => {
    const present = LETTERS.slice(LETTERS.indexOf(letter)).find((l) => sectionY.current[l] != null);
    if (!present) return;
    const y = azBase.current + sectionY.current[present] - insets.top - layout.statusBarGap;
    scrollRef.current?.scrollTo({ y: Math.max(0, y), animated: true });
  };

  const avatar = (c: RosterClient, size: number) => (
    <View style={[s.avatar, { width: size, height: size }]}>
      <Text style={[s.avatarText, { fontSize: size * 0.4 }]}>{initialsOf(c)}</Text>
    </View>
  );
  const iconButton = (icon: 'chatbubble-ellipses-outline' | 'notifications-outline', label: string, onPress: () => void, id: string) => (
    <HapticPressable intent="light" style={s.iconBtn} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} testID={id}>
      <Ionicons name={icon} size={20} color={colors.primary} />
    </HapticPressable>
  );
  const clientRow = (c: RosterClient, r: LookupReason, trailing: React.ReactNode) => {
    const name = rosterDisplayName(c);
    return (
      <View key={c.id} style={s.row}>
        <View style={s.mid}>
          <HapticPressable intent="light" style={s.rowMain} onPress={() => openClient(c)} accessibilityRole="button" accessibilityLabel={`${name}, ${r.text}`} testID={`lookup-row-${c.id}`}>
            {avatar(c, 40)}
            <View style={s.mid}>
              <Text style={s.name} numberOfLines={1}>{name}</Text>
              <View style={s.reasonRow}>
                {r.ok ? <View style={s.dot} /> : null}
                <Text style={[s.reason, r.ok && s.reasonOk]} numberOfLines={2}>{r.text}</Text>
              </View>
            </View>
            {trailing ? null : <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
          </HapticPressable>
        </View>
        {trailing}
      </View>
    );
  };
  const quickRow = (c: RosterClient) => {
    const name = rosterDisplayName(c);
    return clientRow(c, { ...lookupReason(c, unread, 'recent'), ok: false }, (
      <>
        {iconButton('chatbubble-ellipses-outline', `Message ${firstName(c)}`, () => openMessages(c), `lookup-message-${c.id}`)}
        {iconButton('notifications-outline', `Nudge, ${name}`, () => nudge.open(c), `lookup-nudge-${c.id}`)}
      </>
    ));
  };

  const header = (
    <View>
      <Overline style={s.date}>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</Overline>
      <View style={s.titleRow}>
        <Text style={s.title} accessibilityRole="header">Clients</Text>
        <HapticPressable intent="light" style={s.invite} onPress={() => navigation.navigate('InviteCodes')} accessibilityRole="button" accessibilityLabel="Invite" hitSlop={4} testID="lookup-invite">
          <Ionicons name="person-add-outline" size={16} color={theme.semanticColors.textOnAccent} />
          <Text style={s.inviteText}>Invite</Text>
        </HapticPressable>
      </View>
      {known ? (
        <Text style={s.count} testID="lookup-count">{roster.length} {archived ? 'archived' : 'active'} {roster.length === 1 ? 'client' : 'clients'}</Text>
      ) : null}
      {teamEntry ? <HapticPressable intent="light" style={s.azRow} onPress={() => navigation.getParent()?.navigate('TeamStack')} accessibilityRole="button" accessibilityLabel="Team" testID="lookup-team-entry">
        <Ionicons name="briefcase-outline" size={20} color={colors.textSecondary} /><Text style={s.azName}>Team</Text><Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </HapticPressable> : null}
      {coachLandingTab() === 'ClientsStack' ? <PushPermissionCard audience="coach" /> /* C-S-PUSH-3 + COACHLAND, as on today's list */ : null}
    </View>
  );
  const privacy = (
    <View style={s.privacy}>
      <Ionicons name="shield-outline" size={16} color={colors.textMuted} style={s.privacyIcon} />
      <Text style={s.note}>You see your clients' workouts, food logs, weigh-ins and check-ins while you coach them.</Text>
    </View>
  );

  let body: React.ReactNode;
  if (isLoading) body = <QuietLoading label="Loading clients" rows={5} testID="lookup-loading" />;
  else if (loadError && roster.length === 0) {
    body = <QuietError message={loadError} onRetry={() => coachId && loadClients(coachId, filterStatus)} testID="lookup-error" />;
  } else if (!searchFirst) {
    // Mockup 1's order: last logged first (sortRoster 'recent').
    const rows = sortRoster(roster, 'recent').map((c) => ({ c, r: lookupReason(c, unread, 'needs') }));
    const needs = rows.filter((x) => x.r.action).length;
    body = (
      <>
        {rows.length > 0 ? <Text style={s.sentence} testID="lookup-sentence">{needsYouSentence(needs, rows.length - needs)}</Text> : null}
        {rows.map(({ c, r }) => clientRow(c, r, r.action ? (
          <HapticPressable intent="light" style={s.act} onPress={() => runAction(c, r.action as LookupAction)} accessibilityRole="button" accessibilityLabel={`${ACTION_LABEL[r.action]}, ${rosterDisplayName(c)}`} testID={`lookup-act-${c.id}`}>
            <Text style={s.actText}>{ACTION_LABEL[r.action]}</Text>
          </HapticPressable>
        ) : null))}
        <View style={s.card}>
          <Text style={s.cardTitle}>Add your next client</Text>
          <Text style={s.cardBody}>Share your code or link. New clients land here with a New tag for their first week.</Text>
          <HapticPressable intent="medium" style={s.outlineBtn} onPress={() => navigation.navigate('InviteCodes')} accessibilityRole="button" accessibilityLabel="Share invite code" testID="lookup-share-code">
            <Text style={s.outlineBtnText}>Share invite code</Text>
          </HapticPressable>
        </View>
        {privacy}
        {archivedCount !== 0 ? ( // an unknown count (full first page, failed read) still shows the link
          <HapticPressable intent="light" style={s.archivedLink} onPress={toggleArchived} accessibilityRole="button" accessibilityLabel="Archived" testID="lookup-archived-link">
            <Text style={s.chipText}>Archived</Text>
          </HapticPressable>
        ) : null}
      </>
    );
  } else {
    const chipCount = (f: LookupFilter) => roster.filter((c) => matchesLookupFilter(c, f, unread)).length;
    const sections = groupByLetter(roster);
    body = (
      <>
        <View style={s.search}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput style={s.searchInput} value={query} onChangeText={setQuery} placeholder="Name, email or a filter" placeholderTextColor={colors.textMuted} accessibilityLabel="Name, email or a filter" autoCorrect={false} autoCapitalize="none" returnKeyType="search" clearButtonMode="while-editing" testID="lookup-search" />
        </View>
        <View style={s.chips}>
          {(archived ? [] : FILTERS).map((f) => (
            <HapticPressable key={f} intent="light" style={[s.chip, chip === f && s.chipOn]} onPress={() => setChip(chip === f ? null : f)} accessibilityRole="button" accessibilityState={{ selected: chip === f }} accessibilityLabel={`${FILTER_LABELS[f]}, ${chipCount(f)}`} testID={`lookup-chip-${f}`}>
              <Text style={[s.chipText, chip === f && s.chipTextOn]}>{FILTER_LABELS[f]} <Text style={s.chipCount}>{chipCount(f)}</Text></Text>
            </HapticPressable>
          ))}
          <HapticPressable intent="light" style={[s.chip, archived && s.chipOn]} onPress={toggleArchived} accessibilityRole="button" accessibilityState={{ selected: archived }} accessibilityLabel={archivedCount != null || archived ? `Archived, ${archived ? roster.length : archivedCount}` : 'Archived'} testID="lookup-chip-archived">
            <Text style={[s.chipText, archived && s.chipTextOn]}>
              Archived{archived || archivedCount != null ? <Text style={s.chipCount}> {archived ? roster.length : archivedCount}</Text> : null}
            </Text>
          </HapticPressable>
        </View>
        {loadError ? <Text style={s.note}>Clients did not refresh. Pull down to try again.</Text> : null}
        {narrowing ? (
          <>
            <View style={s.sect}><Overline style={s.eyebrow}>{results.length} {results.length === 1 ? 'result' : 'results'}</Overline></View>
            {results.length > 0 ? results.map(quickRow) : <EmptyStateNoResults query={query} onClearSearch={() => { setQuery(''); setChip(null); }} />}
          </>
        ) : (
          <>
            {recent.length > 0 ? (
              <>
                <View style={s.sect}><Overline style={s.eyebrow}>Opened recently</Overline><Text style={s.note}>On this phone</Text></View>
                {recent.map(quickRow)}
              </>
            ) : null}
            <View style={[s.sect, s.azList]} onLayout={(e) => setEveryoneY(e.nativeEvent.layout.y)} testID="lookup-everyone">
              <Overline style={s.eyebrow}>{archived ? 'Archived' : 'Everyone'} <Text style={s.eyebrowCount}>{roster.length}</Text></Overline>
              <Text style={s.note}>A to Z</Text>
            </View>
            <View style={s.azList} onLayout={(e) => { azBase.current = e.nativeEvent.layout.y; }}>
              {sections.map(({ letter, clients: group }) => (
                <View key={letter} onLayout={(e) => { sectionY.current[letter] = e.nativeEvent.layout.y; }} testID={`lookup-letter-${letter}`}>
                  <Text style={s.letter} accessibilityRole="header">{letter}</Text>
                  {group.map((c) => {
                    const name = rosterDisplayName(c);
                    const when = lastLoggedWord(c);
                    return (
                      <HapticPressable key={c.id} intent="light" style={s.azRow} onPress={() => openClient(c)} accessibilityRole="button" accessibilityLabel={`${name}, ${when}`} testID={`lookup-az-${c.id}`}>
                        {avatar(c, 32)}
                        <Text style={s.azName} numberOfLines={1}>{name}</Text>
                        <Text style={s.azWhen} numberOfLines={2}>{when}</Text>
                      </HapticPressable>
                    );
                  })}
                </View>
              ))}
            </View>
            <Text style={[s.note, s.tip]}>Tip: filters combine with typing, so “quiet ben” finds Ben Carter.</Text>
          </>
        )}
        {privacy}
      </>
    );
  }

  // The index (top at insets.top + 72) shows once Everyone is near the top, so it never sits beside the header or search box.
  const showIndex = searchFirst && !narrowing && everyoneY != null && scrollY >= everyoneY - insets.top - 200 && roster.length > 0;
  return (
    <View style={s.screen}>
      <ScrollView
        ref={scrollRef}
        testID="lookup-scroll"
        contentContainerStyle={[s.content, { paddingTop: insets.top + layout.statusBarGap + 12 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        scrollEventThrottle={64}
        onScroll={(e) => setScrollY(e.nativeEvent.contentOffset.y)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
      >
        {header}
        {body}
      </ScrollView>
      {showIndex ? (
        <View style={[s.index, { top: insets.top + 72 }]} testID="lookup-index">
          {LETTERS.map((l) => (
            <HapticPressable key={l} intent="light" onPress={() => jumpTo(l)} hitSlop={{ left: 12, right: 6 }} accessibilityRole="button" accessibilityLabel={l} testID={`lookup-index-${l}`}>
              <Text style={s.indexLetter}>{l}</Text>
            </HapticPressable>
          ))}
        </View>
      ) : null}
      {peek ? null : nudge.modal}
      <ClientPeekSheet client={peek} coachId={coachId} onClose={() => setPeek(null)} onOpen={openTarget} onNudge={nudge.open}>
        {peek ? nudge.modal : null}
      </ClientPeekSheet>
    </View>
  );
}

const makeStyles = ({ colors, semanticColors: sem }: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: layout.gutter, paddingBottom: 104 },
    date: { color: colors.textMuted },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
    title: { ...typography.h1, flex: 1, color: colors.textPrimary },
    invite: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 14, borderRadius: radius.chip, backgroundColor: colors.primary },
    inviteText: { ...typography.bodySmall, fontFamily: 'Inter_500Medium', color: sem.textOnAccent },
    count: { ...typography.bodySmall, color: colors.textMuted, marginTop: 2 },
    sentence: { ...typography.bodySmall, color: colors.textPrimary, marginTop: 14, marginBottom: 8 },
    row: { flexDirection: 'row', alignItems: 'center', minHeight: 64, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: sem.border },
    rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, minHeight: 64 },
    mid: { flex: 1, minWidth: 0 },
    avatar: { borderRadius: radius.chip, borderWidth: 1, borderColor: palette.camel, backgroundColor: palette.cream, alignItems: 'center', justifyContent: 'center' },
    avatarText: { fontFamily: 'CormorantGaramond_400Regular', color: colors.textPrimary },
    name: { ...typography.h4, color: colors.textPrimary },
    reasonRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
    reason: { ...typography.bodySmall, color: colors.textMuted, flexShrink: 1 },
    reasonOk: { color: colors.textPrimary },
    dot: { width: 7, height: 7, borderRadius: radius.chip, backgroundColor: colors.primary },
    act: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', borderRadius: radius.chip, borderWidth: 1, borderColor: colors.primary, marginLeft: 8 },
    actText: { ...typography.bodySmall, fontFamily: 'Inter_500Medium', color: colors.primary },
    iconBtn: { width: 44, height: 44, borderRadius: radius.chip, alignItems: 'center', justifyContent: 'center' },
    card: { marginTop: 22, padding: 20, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, borderColor: sem.border, backgroundColor: sem.bgSurface },
    cardTitle: { ...typography.h3, color: colors.textPrimary },
    cardBody: { ...typography.bodySmall, color: colors.textMuted, marginTop: 6, marginBottom: 16 },
    outlineBtn: { minHeight: 44, borderRadius: radius.button, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    outlineBtnText: { ...typography.bodyMd, fontSize: 15, color: colors.primary },
    privacy: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderColor: sem.border, marginTop: 18 },
    privacyIcon: { marginTop: 2 },
    note: { ...typography.caption, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, letterSpacing: 0, color: colors.textMuted, flexShrink: 1 },
    tip: { marginTop: 14 },
    archivedLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
    search: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 54, marginTop: 14, paddingHorizontal: 14, borderRadius: radius.input, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: sem.bgSurface },
    searchInput: { ...typography.body, flex: 1, minWidth: 0, color: colors.textPrimary, paddingVertical: 0 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
    chip: { height: 36, paddingHorizontal: 14, justifyContent: 'center', borderRadius: radius.chip, borderWidth: 1, borderColor: sem.border, backgroundColor: sem.bgSurface },
    chipOn: { borderColor: colors.primary },
    chipText: { ...typography.bodySmall, fontFamily: 'Inter_500Medium', lineHeight: 18, color: colors.textPrimary },
    chipTextOn: { color: colors.primary },
    chipCount: { fontFamily: 'Inter_600SemiBold', color: colors.textMuted },
    sect: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 22, marginBottom: 4 },
    eyebrow: { color: colors.textMuted },
    eyebrowCount: { fontFamily: 'Inter_600SemiBold', color: colors.textPrimary },
    azList: { paddingRight: 20 },
    letter: { ...typography.bodyMd, color: colors.primary, marginTop: 12, paddingBottom: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: sem.border },
    azRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: sem.border },
    azName: { ...typography.h4, flex: 1, color: colors.textPrimary },
    azWhen: { ...typography.bodySmall, color: colors.textMuted, maxWidth: '45%', textAlign: 'right' },
    index: { position: 'absolute', right: 4, alignItems: 'center' },
    indexLetter: { ...typography.caption, fontFamily: 'Inter_600SemiBold', fontSize: 11, lineHeight: 17, letterSpacing: 0, color: colors.primary, paddingHorizontal: 4 },
  });
