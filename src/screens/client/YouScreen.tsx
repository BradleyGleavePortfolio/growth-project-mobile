/**
 * YouScreen — the You tab home in MOCK-C9 Style C, slice 1 (owner pick C9 =
 * Style C), behind featureFlags.youTabV2 (off; off, the tab is MoreScreen).
 *
 *   - Masthead (surface.masthead): You, the lede, your initial inside the week
 *     ring (program sessions this week, as on Today; no sessions, no ring),
 *     your name, Member since and Edit (today's Profile).
 *   - Your coach on sage with Message {coach} (Home > Messages); a client with
 *     no coach gets Join a coach, whose button opens the existing
 *     CoachCodeSheet (the C7 join, unchanged here).
 *   - Account (Your plans), Settings (Notifications), Health and devices, and
 *     Support, which keeps today's More rows until their new homes ship
 *     (MOCK-C9 section 4). Profile leaves: Edit opens it.
 *   - Sign out (today's confirm) and the version line.
 *
 * Coachless clients get every row; only Roman needs a coach (owner 10-17).
 */
import React, { useCallback, useEffect, useReducer, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { readUserCacheSync } from '../../lib/userCache';
import { useMyWorkoutAssignments } from '../../hooks/useWorkoutBuilder';
import type { ClientWorkoutAssignment } from '../../api/workoutBuilderApi';
import { useClientNeedsCoach } from '../../components/coachless/JoinCoachState';
import { JOIN_COACH_BODY, JOIN_COACH_TITLE } from '../../components/coachless/JoinCoachBanner';
import CoachCodeSheet from '../../components/coachless/CoachCodeSheet';
import { messageCoachLabel } from '../../components/home/HomeHeaderActions';
import RomanAvatar from '../../components/roman/RomanAvatar';
import TutorialTarget from '../../components/tutorial/TutorialTarget';
import { YOUR_PLANS_COPY, YOUR_PLANS_QUERY_KEY } from '../../components/purchase/YourPlansPanel';
import { listClientPlans, type ClientPlan } from '../../lib/packagePayment';
import { subscribeJoin } from '../../lib/joinPackage';
import { planDate } from '../../lib/planActions';
import { money } from '../../lib/planTerms';
import { prepareSignOutConfirm, signOut } from '../../services/authActions';
import { warningTap } from '../../utils/haptics';
import { featureFlags } from '../../config/featureFlags';
import { HapticService } from '../../ui/haptics/haptics.service';
import { SegmentedRing, type SegmentState } from '../../ui/charts';
import { Overline, PrimaryButton, QuietTextButton, Screen, TextLink, useScreenInsets } from '../../ui';
import { useTheme } from '../../theme/ThemeProvider';
import { layout, radius, typography, type SemanticTokens } from '../../theme/tokens';
import {
  MORE_ITEMS,
  PLAN_MORE_ITEMS,
  ROMAN_MORE_ITEM,
  WEARABLE_MORE_ITEMS,
  showsWearableRows,
  type MoreItem,
} from './MoreScreen';

/**
 * Owner 10-17 "#SLEEP-PLACE op 2": the main way into Sleep and recovery is a
 * row in You under Health and devices. The Sleep page is not built yet, so
 * this slot stays empty and no row is drawn (no button that leads nowhere).
 * When the page ships, this becomes its row, first in Health and devices.
 */
export const SLEEP_AND_RECOVERY_ROW: MoreItem | null = null;

export const YOU_COPY = {
  title: 'You',
  lede: 'Your details, your coach and your account.',
  memberSince: (date: string) => `Member since ${date}`,
  thisWeek: 'This week',
  done: (n: number, total: number) => `${n} of ${total} done`,
  edit: 'Edit',
  yourCoach: 'Your coach',
  coachError: 'Your coach did not load. Check the connection and try again.',
  tryAgain: 'Try again',
  loading: 'Loading your account',
  enterCode: 'Enter a coach code',
  account: 'Account',
  yourPlans: 'Your plans',
  active: 'Active',
  settings: 'Settings',
  notifications: 'Notifications',
  notificationsDetail: 'Coach messages, reminders and quiet hours',
  healthAndDevices: 'Health and devices',
  support: 'Support',
  signOut: 'Sign out',
  version: 'The Growth Project v1.0.0',
} as const;

/** Monday 00:00 of the week that holds `now`, on this phone's clock. */
function weekStart(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/**
 * One ring segment per program session scheduled this week (Monday to
 * Sunday), in date order: done when completed, missed when its day has
 * passed, planned otherwise (the C1 week ring rule).
 */
export function weekSegments(
  assignments: ReadonlyArray<Pick<ClientWorkoutAssignment, 'scheduled_for' | 'completed_at'>>,
  now: Date = new Date(),
): SegmentState[] {
  const start = weekStart(now);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return assignments
    .map((a) => ({ a, at: new Date(a.scheduled_for) }))
    .filter(({ at }) => !Number.isNaN(at.getTime()) && at >= start && at < end)
    .sort((x, y) => x.at.getTime() - y.at.getTime())
    .map(({ a, at }) => (a.completed_at ? 'done' : at < today ? 'missed' : 'planned'));
}

/** "Next charge of $149.00 on November 14." for the renewing active plan that charges soonest. */
export function nextChargeLine(plans: ReadonlyArray<ClientPlan> | undefined): string | null {
  const at = (p: ClientPlan) => Date.parse(p.nextChargeAt ?? '');
  const [plan] = (plans ?? [])
    .filter((p) => p.state === 'active' && !p.cancelAtPeriodEnd && p.nextChargeAt)
    .sort((a, b) => at(a) - at(b));
  return plan ? YOUR_PLANS_COPY.renews(money(plan.amountCents, plan.currency), planDate(plan.nextChargeAt)) : null;
}

function memberSince(createdAt?: string): string | null {
  const d = createdAt ? new Date(createdAt) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return YOU_COPY.memberSince(new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(d).replace(' ', '\u00a0'));
}

interface CoachCard {
  id: string;
  name: string;
  avatar_url?: string | null;
}

type RowIcon = keyof typeof Ionicons.glyphMap;

export default function YouScreen() {
  const { semanticColors: sc } = useTheme();
  const styles = makeStyles(sc);
  const insets = useScreenInsets();
  // Large text: Edit moves under the name so the name keeps the width (no word split mid-name).
  const editUnder = useWindowDimensions().fontScale > 1.15;
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const currentUser = useCurrentUser();
  const needsCoach = useClientNeedsCoach();
  // A join from the sheet patches the cached user; re-read it then.
  const [, reread] = useReducer((n: number) => n + 1, 0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const user = readUserCacheSync() ?? currentUser;
  const coachId = user?.coach_id ?? null;

  const coach = useQuery({
    queryKey: ['you-coach', user?.id, coachId],
    queryFn: async () => (await api.get<CoachCard>('/v1/clients/me/coach')).data,
    enabled: !!coachId,
  });
  const userId = user?.id;
  const plans = useQuery({
    queryKey: [...YOUR_PLANS_QUERY_KEY, userId],
    queryFn: listClientPlans,
    enabled: !!userId,
    staleTime: Infinity, // fresh until You re-reads it or End / Keep on Your plans outdates it
    meta: { persist: false }, // never a charge from a read saved to the phone on an earlier visit
  });
  const { refetch: refetchPlans } = plans;
  // Plans change on Your plans, at checkout and through a coach code (a paid join ends in
  // JoinPackageHost over You): re-read the user and the plans on every return to You and after a join.
  const refresh = useCallback(() => {
    reread();
    if (userId) void refetchPlans({ cancelRefetch: false });
  }, [userId, refetchPlans]);
  useFocusEffect(refresh);
  useEffect(() => subscribeJoin(refresh), [refresh]);
  const assignments = useMyWorkoutAssignments();

  const segments = weekSegments(assignments.data ?? []);
  const doneCount = segments.filter((s) => s === 'done').length;
  const weekDone = segments.length > 0 ? YOU_COPY.done(doneCount, segments.length) : null;
  const name = user?.name?.trim() ?? '';
  const initial = name.charAt(0).toUpperCase();
  const since = memberSince(user?.createdAt);
  const chargeLine = plans.isSuccess && !plans.isStale ? nextChargeLine(plans.data) : null; // a read that worked, not outdated

  const open = (item: MoreItem) => {
    if (item.target.type === 'stack') {
      navigation.navigate(item.target.screen);
      return;
    }
    // Another tab's screen: keep that stack's first screen underneath, so Back works.
    (navigation.getParent() ?? navigation).navigate(item.target.tab, { screen: item.target.screen, initial: false });
  };
  // The coach thread lives on the Home stack (as from Home's Message {coach}).
  const openCoachThread = () => (navigation.getParent() ?? navigation).navigate('Home', { screen: 'Messages', initial: false });

  const handleSignOut = async () => {
    // SESSION-KEEP-130: the same confirm as Settings (names anything still unsent).
    const message = await prepareSignOutConfirm(user?.id);
    if (message === null) return;
    Alert.alert(YOU_COPY.signOut, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: YOU_COPY.signOut, style: 'destructive', onPress: () => { warningTap(); void signOut(); } },
    ]);
  };

  // The initial is decorative: the name sits beside it.
  const avatar = (
    <View
      style={[styles.avatar, segments.length > 0 ? styles.avatarInRing : null]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {initial ? <Text style={styles.avatarText}>{initial}</Text> : <Ionicons name="person-outline" size={26} color={sc.textOnAccent} />}
    </View>
  );

  const identity = user ? (
    <View style={styles.identity}>
      {segments.length > 0 ? (
        <SegmentedRing segments={segments} size={RING} onDark label={`${YOU_COPY.thisWeek}, ${weekDone}`} testID="you-week-ring">
          {avatar}
        </SegmentedRing>
      ) : avatar}
      <Pressable
        onPress={() => { void HapticService.selection(); navigation.navigate('ProfileMain'); }}
        accessibilityRole="button"
        accessibilityLabel={name ? `${name}, ${YOU_COPY.edit}` : YOU_COPY.edit}
        testID="you-edit"
        style={({ pressed }) => [styles.identityText, pressed && styles.pressed]}
      >
        <View style={styles.fill}>
          {name ? <Text style={styles.name}>{name}</Text> : null}
          {since ? <Text style={styles.mastheadMuted}>{since}</Text> : null}
          {weekDone ? (
            <Text style={styles.weekLine} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {`${YOU_COPY.thisWeek} · ${weekDone}`}
            </Text>
          ) : null}
          {editUnder ? <Text style={[styles.edit, styles.editUnder]}>{YOU_COPY.edit}</Text> : null}
        </View>
        {editUnder ? null : <Text style={styles.edit}>{YOU_COPY.edit}</Text>}
      </Pressable>
    </View>
  ) : (
    <View style={styles.identity} accessible accessibilityLabel={YOU_COPY.loading} testID="you-loading">
      <View style={[styles.avatar, styles.placeholderOnDark]} />
      <View style={styles.fill}>
        <View style={[styles.bar, styles.placeholderOnDark, { width: '70%' }]} />
        <View style={[styles.bar, styles.barThin, styles.placeholderOnDark, { width: '45%' }]} />
      </View>
    </View>
  );

  let coachCard: React.ReactNode = null;
  if (!user || (coachId && coach.isLoading)) {
    coachCard = <View style={[styles.card, styles.cardLoading]} accessible accessibilityLabel={YOU_COPY.loading} testID="you-coach-loading" />;
  } else if (needsCoach) {
    coachCard = (
      <View style={styles.card} testID="you-join-coach">
        <Overline accessibilityRole="header" style={styles.cardOverline}>{JOIN_COACH_TITLE}</Overline>
        <Text style={styles.cardBody}>{JOIN_COACH_BODY}</Text>
        <PrimaryButton label={YOU_COPY.enterCode} onPress={() => setSheetOpen(true)} style={styles.cardButton} testID="you-enter-code" />
      </View>
    );
  } else if (coachId && coach.data?.name) {
    const coachInitial = coach.data.name.trim().charAt(0).toUpperCase();
    coachCard = (
      <View style={styles.card} testID="you-coach">
        <Overline accessibilityRole="header" style={styles.cardOverline}>{YOU_COPY.yourCoach}</Overline>
        <View style={styles.coachRow}>
          {coach.data.avatar_url ? (
            <Image source={{ uri: coach.data.avatar_url }} style={styles.coachAvatar} accessibilityIgnoresInvertColors />
          ) : (
            <View style={styles.coachAvatar}><Text style={styles.coachInitial}>{coachInitial}</Text></View>
          )}
          <Text style={styles.coachName}>{coach.data.name}</Text>
        </View>
        <PrimaryButton label={messageCoachLabel(coach.data.name)} onPress={openCoachThread} style={styles.cardButton} testID="you-message-coach" />
      </View>
    );
  } else if (coachId) {
    coachCard = (
      <View style={styles.card} testID="you-coach-error">
        <Overline accessibilityRole="header" style={styles.cardOverline}>{YOU_COPY.yourCoach}</Overline>
        <Text style={styles.cardBody} accessibilityLiveRegion="polite">{YOU_COPY.coachError}</Text>
        <QuietTextButton label={YOU_COPY.tryAgain} onPress={() => { void coach.refetch(); }} testID="you-coach-retry" />
      </View>
    );
  }

  const row = (key: string, icon: RowIcon | 'roman', label: string, onPress: () => void, opts: {
    detail?: string | null; tag?: string | null; hint?: string; first?: boolean;
  } = {}) => (
    <Pressable
      key={key}
      onPress={() => { void HapticService.selection(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={[label, opts.detail, opts.tag].filter(Boolean).join(', ')}
      accessibilityHint={opts.hint}
      testID={`you-row-${key}`}
      style={({ pressed }) => [styles.row, !opts.first && styles.rowLine, pressed && styles.pressed]}
    >
      <View style={styles.rowIcon}>
        {icon === 'roman' ? <RomanAvatar crop="neutral" size={28} /> : <Ionicons name={icon} size={22} color={sc.accentText} />}
      </View>
      <View style={styles.fill}>
        <Text style={styles.rowLabel}>{label}</Text>
        {opts.detail ? <Text style={styles.rowDetail}>{opts.detail}</Text> : null}
      </View>
      {opts.tag ? <Text style={styles.tag}>{opts.tag}</Text> : null}
      <Ionicons name="chevron-forward" size={20} color={sc.textMuted} />
    </Pressable>
  );
  const itemRow = (item: MoreItem, i: number) => {
    const r = row(item.target.screen, item.isRoman ? 'roman' : item.icon, item.label, () => open(item), {
      detail: item.description, hint: item.a11yHint, first: i === 0,
    });
    return item.tutorialTarget ? <TutorialTarget key={item.label} id={item.tutorialTarget}>{r}</TutorialTarget> : r;
  };
  const section = (title: string, children: React.ReactNode) => (
    <View style={styles.section} key={title}>
      <Overline accessibilityRole="header" style={styles.sectionTitle}>{title}</Overline>
      <View style={styles.group}>{children}</View>
    </View>
  );

  const health = showsWearableRows()
    ? [...(SLEEP_AND_RECOVERY_ROW ? [SLEEP_AND_RECOVERY_ROW] : []), ...WEARABLE_MORE_ITEMS]
    : [];
  // Today's More rows stay until their homes ship; Profile's home is Edit above.
  const kept = [
    ...(featureFlags.romanChat ? [ROMAN_MORE_ITEM] : []),
    ...PLAN_MORE_ITEMS,
    ...MORE_ITEMS.filter((item) => item.target.screen !== 'ProfileMain'),
  ];

  return (
    <Screen edges={[]} testID="you-screen" contentStyle={styles.screenContent}>
      <View style={[styles.masthead, { paddingTop: insets.top + layout.statusBarGap + 16 }]}>
        <Text style={styles.title} accessibilityRole="header">{YOU_COPY.title}</Text>
        <Text style={styles.lede}>{YOU_COPY.lede}</Text>
        {identity}
      </View>
      <View style={styles.body}>
        {coachCard}
        {section(YOU_COPY.account, row('plans', 'ticket-outline', YOU_COPY.yourPlans, () => navigation.navigate('ClientPackages'), {
          detail: chargeLine, tag: chargeLine ? YOU_COPY.active : null, first: true,
        }))}
        {section(YOU_COPY.settings, row('notifications', 'notifications-outline', YOU_COPY.notifications,
          () => navigation.navigate('NotificationSettings'), { detail: YOU_COPY.notificationsDetail, first: true }))}
        {health.length > 0 ? section(YOU_COPY.healthAndDevices, health.map(itemRow)) : null}
        {section(YOU_COPY.support, kept.map(itemRow))}
        <TextLink label={YOU_COPY.signOut} tone="ink" underline={false} align="start" onPress={() => { void handleSignOut(); }} testID="you-sign-out" style={styles.signOut} />
        <Text style={styles.version}>{YOU_COPY.version}</Text>
      </View>
      {sheetOpen ? (
        <CoachCodeSheet
          visible
          onClose={() => setSheetOpen(false)}
          onAttached={refresh}
          onChoosePlan={() => navigation.navigate('ClientPackages')}
          onMessageCoach={openCoachThread}
        />
      ) : null}
    </Screen>
  );
}

const RING = 76;
const AVATAR = 60;

const makeStyles = (sc: SemanticTokens) => StyleSheet.create({
  screenContent: { paddingHorizontal: 0 },
  fill: { flex: 1 },
  pressed: { opacity: 0.7 },
  masthead: {
    backgroundColor: sc.surface.masthead,
    borderBottomLeftRadius: radius.sheet,
    borderBottomRightRadius: radius.sheet,
    paddingHorizontal: layout.gutter,
    paddingBottom: 28,
  },
  title: { ...typography.h1, color: sc.textOnAccent },
  lede: { ...typography.body, color: sc.textOnMastheadMuted, marginTop: 4 },
  identity: { flexDirection: 'row', alignItems: 'center', marginTop: 20, gap: 16 },
  avatar: {
    width: RING, height: RING, borderRadius: RING / 2, backgroundColor: sc.surface.forestBand,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInRing: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2 },
  avatarText: { ...typography.h1, color: sc.textOnAccent },
  identityText: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: layout.touchMin, gap: 12 },
  name: { ...typography.h1, color: sc.textOnAccent },
  mastheadMuted: { ...typography.body, color: sc.textOnMastheadMuted },
  weekLine: { ...typography.bodyMd, color: sc.textOnAccent },
  edit: { ...typography.bodyMd, color: sc.textOnAccent, textDecorationLine: 'underline' },
  editUnder: { marginTop: 8 },
  placeholderOnDark: { backgroundColor: sc.surface.forestBand },
  bar: { height: 22, borderRadius: radius.control, marginBottom: 10 },
  barThin: { height: 12, marginBottom: 0 },
  body: { paddingHorizontal: layout.gutter, paddingTop: 16 },
  card: { backgroundColor: sc.surface.sage, borderRadius: radius.card, padding: 20 },
  cardLoading: { minHeight: 150 },
  cardOverline: { color: sc.textPrimary },
  cardBody: { ...typography.body, color: sc.textPrimary, marginTop: 4 },
  cardButton: { marginTop: 16 },
  coachRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 8 },
  coachAvatar: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: sc.surface.masthead,
    alignItems: 'center', justifyContent: 'center',
  },
  coachInitial: { ...typography.h2, color: sc.textOnAccent },
  coachName: { ...typography.h1, color: sc.textPrimary, flex: 1 },
  section: { marginTop: 24 },
  sectionTitle: { marginLeft: 4, marginBottom: 10 },
  group: {
    backgroundColor: sc.bgSurface, borderRadius: radius.card, overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth, borderColor: sc.surface.sageLine,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', minHeight: layout.rowMinHeight,
    paddingVertical: 14, paddingHorizontal: 16, gap: 12,
  },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: sc.surface.sageLine },
  rowIcon: { width: 28, alignItems: 'center' },
  rowLabel: { ...typography.bodyMd, color: sc.textPrimary },
  rowDetail: { ...typography.bodySmall, color: sc.textMuted, marginTop: 2 },
  tag: {
    ...typography.caption, letterSpacing: 0.2, color: sc.accentText, borderWidth: 1, borderColor: sc.accentText,
    borderRadius: radius.chip, paddingHorizontal: 10, paddingVertical: 2, overflow: 'hidden',
  },
  signOut: { marginTop: 16 },
  version: { ...typography.bodySmall, color: sc.textMuted, marginTop: 4, marginBottom: 8 },
});
