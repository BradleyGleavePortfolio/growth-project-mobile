import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { coachApi } from '../../services/api';

import type { IoniconName } from '../../types/common';
import { useTheme } from '../../theme/ThemeProvider';
import { errorMessage } from '../../types/common';
import { SkeletonProfileHeader, SkeletonWorkoutRow, SkeletonStatTile } from '../../ui/skeletons';

import { makeStyles } from './client-detail/styles';
import { type Props, type TabKey } from './client-detail/types';
import { DateRangeSelector } from './client-detail/DateRangeSelector';
import { TimelineTab } from './client-detail/TimelineTab';
import { WeeklySummaryTab } from './client-detail/WeeklySummaryTab';
import { FoodLogReviewSection } from './client-detail/FoodLogReviewSection';
import { SummaryTab } from './client-detail/SummaryTab';
import { WorkoutsTab } from './client-detail/WorkoutsTab';
import { ProgressTab } from './client-detail/ProgressTab';
import { HealthFitnessTab } from './client-detail/HealthFitnessTab';
import { NudgeModal } from './client-detail/NudgeModal';
import { useClientDetailData } from './client-detail/useClientDetailData';
// PR-HK-3b — coach Sleep & Recovery tab content.
import { SleepRecoveryTab } from './client-detail/SleepRecoveryTab';
// Stream 2 — AskAi sheet for the four execution capabilities.
import { AskAiActionSheet } from '../../components/coach/ai-execution/AskAiActionSheet';
import { DisputePausedPlansCard } from '../../components/coach/DisputePausedPlansCard';
import { ForestStatusBar } from '../../components/StatusBarBand';
import { featureFlags } from '../../config/featureFlags';
import { useFeatureFlags } from '../../hooks/useFeatureFlags';
import { layout, radius, typography } from '../../theme/tokens';
import { useScreenInsets } from '../../ui';
import { FileHead, FileNotice, FilePlaceholders, FileTabs, MessageButton, ThisWeekBody, firstOf } from './client-detail/StyleCFile';
import { useThisWeek } from './client-detail/useThisWeek';
import { HapticService } from '../../ui/haptics/haptics.service';

export default function ClientDetailScreen({ navigation, route }: Props) {
  // S14 round 3: the coach wearable-prompts screen is reachable from this
  // client's Health tab only when the build flag AND the server flag are on.
  const serverFlags = useFeatureFlags();
  const wearablePromptsOn =
    featureFlags.communityWearablePrompts &&
    !serverFlags.isLoading &&
    serverFlags.flags.coach_community_wearable_prompts === true;
  const { colors, semanticColors: sc } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // The Screen wrapper's inset top (insets.top + 12), never a fixed 56 (B13 B28).
  const insets = useScreenInsets();
  const top = { paddingTop: insets.top + layout.statusBarGap };
  const { clientId } = route.params;
  // K1-OVERVIEW: the Style C file (owner pick K1 C) rides the six-tab flag; off, the file is unchanged.
  const styleC = featureFlags.coachTabsV2 === true;
  const currentUser = useCurrentUser();

  const {
    profile,
    totals,
    weightLogs,
    workoutSessions,
    timeline,
    weekSummaries,
    timelineLoading,
    timelineError,
    weeklyLoading,
    weeklyError,
    isLoading,
    loadError,
    refreshing,
    isArchived,
    archiveStatusError,
    loadArchiveStatus,
    setIsArchived,
    setTimeline,
    setWeekSummaries,
    setRefreshing,
    loadData,
    loadTimeline,
    markCheckInReviewed,
    loadWeeklySummaries,
  } = useClientDetailData(clientId, colors, currentUser?.id);
  const clientName = route.params.clientName || profile?.name || '';
  const first = firstOf(clientName);

  const [activeTab, setActiveTab] = useState<TabKey>(route.params.initialTab ?? (styleC ? 'week' : 'summary'));
  const thisWeek = useThisWeek(clientId, styleC, activeTab === 'week');
  const week = thisWeek.read.kind === 'ok' ? thisWeek.read.week : null;
  // AIB-6: Workouts tab "Build a program with AI" opens the Coach AI program generator (Summary tab) once.
  const [aiProgramRequest, setAiProgramRequest] = useState(false);
  const clearAiProgramRequest = useCallback(() => setAiProgramRequest(false), []);
  const [selectedDays, setSelectedDays] = useState<7 | 30 | 90>(90);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());
  const [showNudgeModal, setShowNudgeModal] = useState(false);
  const [nudgeTitle, setNudgeTitle] = useState('');
  const [nudgeBody, setNudgeBody] = useState('');
  const [nudgeSending, setNudgeSending] = useState(false);
  const [nudgeError, setNudgeError] = useState('');
  const [nudgeSuccess, setNudgeSuccess] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  // Stream 2 — Ask-AI sheet visibility. Opens via the SummaryTab "Ask
  // AI" pill, closes either via the X icon, scrim tap, or after a
  // successful submit (the sheet calls onClose then onAfterSubmit so
  // the screen can route to the pending-drafts inbox).
  const [askAiVisible, setAskAiVisible] = useState(false);
  // R-DISPUTE-PAUSE: pull-to-refresh also re-reads the dispute-paused plans.
  const [planReloadKey, setPlanReloadKey] = useState(0);

  // Hunter #2 P2-7: previously the route param `clientId` was only consumed
  // on first mount because the load effect had an empty dep array. The
  // ClientsStack reuses the same screen instance when a coach taps from one
  // client straight into another (deep link, "view next client" CTA, etc.),
  // so the screen would render Client B's avatar/header bound to Client A's
  // profile / food logs / workouts until pull-to-refresh.
  //
  // Keying off `clientId` (with the memoised loaders from useClientDetailData,
  // which themselves regenerate when `clientId` changes) makes the screen
  // always reload when the routed client switches under us. The transient UI
  // state (active tab, expanded weeks, draft nudge text) is
  // also reset to its initial shape so we don't briefly render Client B's
  // profile under Client A's selected tab or half-typed nudge.
  useEffect(() => {
    setActiveTab(route.params.initialTab ?? (styleC ? 'week' : 'summary'));
  }, [clientId, route.params.initialTab, styleC]);

  useEffect(() => {
    setExpandedWeeks(new Set());
    setShowNudgeModal(false);
    setNudgeTitle('');
    setNudgeBody('');
    setNudgeError('');
  }, [clientId]);

  useEffect(() => {
    loadData();
  }, [clientId, loadData]);

  useEffect(() => {
    if (activeTab === 'timeline') {
      loadTimeline(selectedDays);
    }
    if (activeTab === 'weekly') {
      loadWeeklySummaries(selectedDays);
    }
  }, [activeTab, selectedDays, clientId, loadTimeline, loadWeeklySummaries]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setPlanReloadKey((k) => k + 1);
    await Promise.all([loadData(), loadArchiveStatus(true), styleC ? thisWeek.refresh() : null]);
    setRefreshing(false);
  }, [loadData, loadArchiveStatus, setRefreshing, styleC, thisWeek]);

  const sendNudge = async () => {
    setNudgeError('');
    if (!nudgeTitle.trim() || !nudgeBody.trim()) {
      setNudgeError('Title and message are both required.');
      return;
    }
    setNudgeSending(true);
    try {
      await coachApi.sendNudge(clientId, {
        title: nudgeTitle.trim(),
        body: nudgeBody.trim(),
      });
      setNudgeTitle('');
      setNudgeBody('');
      setNudgeSuccess(true);
      setShowNudgeModal(false);
      // Toast-like transient banner — auto-hide.
      setTimeout(() => setNudgeSuccess(false), 2500);
    } catch (err) {
      setNudgeError(errorMessage(err, 'Failed to send nudge.'));
    } finally {
      setNudgeSending(false);
    }
  };

  const tabs: { key: TabKey; label: string; icon: IoniconName }[] = [
    ...(styleC ? [{ key: 'week', label: 'This week', icon: 'today-outline' } as const] : []), // K1-OVERVIEW, K1-S-36
    { key: 'summary', label: 'Summary', icon: 'pie-chart-outline' },
    { key: 'logs', label: 'Logs', icon: 'restaurant-outline' },
    { key: 'progress', label: 'Progress', icon: 'trending-up-outline' },
    { key: 'healthFitness', label: 'Fitness', icon: 'fitness-outline' },
    // PR-HK-3b — Sleep & Recovery sits directly after HK-3a's 'healthFitness'.
    { key: 'sleepRecovery', label: 'Recovery', icon: 'moon-outline' },
    { key: 'workouts', label: 'Workouts', icon: 'barbell-outline' },
    { key: 'timeline', label: 'Timeline', icon: 'time-outline' },
    { key: 'weekly', label: 'Weekly', icon: 'stats-chart-outline' },
  ];

  const performToggleArchive = async () => {
    setArchiveBusy(true);
    try {
      if (isArchived) {
        await coachApi.unarchiveClient(clientId);
        setIsArchived(false);
        Alert.alert('Unarchived', `${clientName} has been restored to active.`);
      } else {
        await coachApi.archiveClient(clientId);
        setIsArchived(true);
        Alert.alert('Archived', `${clientName} has been archived.`);
      }
    } catch (err) {
      Alert.alert('Client status could not update', errorMessage(err, 'Try again to update this client’s archive status.'));
    } finally {
      setArchiveBusy(false);
    }
  };

  const handleToggleArchive = () => {
    if (archiveBusy || isArchived === null) return;
    if (isArchived) {
      void performToggleArchive();
      return;
    }
    const billingDirection = serverFlags.flags.coach_payment_actions
      ? 'Manage billing in Payments, or ask the client to use End my plan in Your plans.'
      : 'The client can use End my plan in Your plans.';
    Alert.alert(
      'Archive this client?',
      `Archiving removes ${clientName} from the active client list. It does not stop recurring payments. If a plan is billing, payments continue until billing is paused or the plan is ended separately. ${billingDirection}`,
      [
        { text: 'Keep active', style: 'cancel' },
        { text: 'Archive client', onPress: performToggleArchive },
      ],
    );
  };

  // K1-OVERVIEW: More holds the archive action that sat in the old header.
  const openMore = () =>
    Alert.alert(clientName, undefined, [
      { text: isArchived ? 'Unarchive client' : 'Archive client', onPress: handleToggleArchive },
      { text: 'Cancel', style: 'cancel' },
    ]);
  const openMessages = () => navigation.navigate('ClientMessages', { clientId, clientName });
  const fileHead = (rounded?: boolean) => (
    <FileHead
      name={clientName} onBack={() => navigation.goBack()} rounded={rounded} archived={isArchived === true}
      onMore={isArchived !== null && !archiveBusy ? openMore : undefined}
      week={rounded ? null : week} drawKey={week ? `${clientId}:${week.week}` : undefined}
    />
  );
  const message = <MessageButton label={`Message ${first}`} onPress={openMessages} />;

  // The file waits for This week's read too, so the ring does not pop in under a drawn masthead.
  if (styleC && ((isLoading && !refreshing) || thisWeek.read.kind === 'loading' || (loadError && !profile))) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]} testID="client-detail">
        <ForestStatusBar />
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          {fileHead(true)}
          <View style={{ paddingHorizontal: layout.gutter }}>
            {loadError ? <FileNotice first={first} onRetry={loadData} /> : <FilePlaceholders first={first} />}
          </View>
        </ScrollView>
        {message}
      </View>
    );
  }

  if (isLoading && !refreshing) {
    return (
      <ScrollView style={[styles.container, top]} contentContainerStyle={{ paddingBottom: 40 }}>
        <SkeletonProfileHeader />
        <View style={{ paddingHorizontal: layout.gutter, gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <SkeletonStatTile />
            <SkeletonStatTile />
            <SkeletonStatTile />
          </View>
        </View>
        <View style={{ paddingHorizontal: layout.gutter, marginTop: 16, gap: 8 }}>
          <SkeletonWorkoutRow />
          <SkeletonWorkoutRow />
          <SkeletonWorkoutRow />
        </View>
      </ScrollView>
    );
  }

  // Audit P1: explicit error + retry surface when the summary load fails and
  // we have no profile to show. Previously the screen fell through with an
  // empty layout that looked indistinguishable from a brand-new client with
  // no logs yet.
  if (loadError && !profile) {
    return (
      <View style={[styles.container, top, { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }]}>
        <Ionicons name="cloud-offline-outline" size={36} color={colors.textMuted} />
        <Text style={{ color: colors.textSecondary, textAlign: 'center', marginTop: 12, marginBottom: 16 }}>
          {loadError}
        </Text>
        <TouchableOpacity
          onPress={loadData}
          accessibilityRole="button"
          accessibilityLabel="Retry"
          style={{
            backgroundColor: colors.primary,
            paddingVertical: 12,
            paddingHorizontal: 24,
            borderRadius: radius.button,
          }}
        >
          <Text style={{ color: colors.textOnPrimary, fontWeight: '600', letterSpacing: 1.1, textTransform: 'uppercase' }}>
            Try again
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, top, styleC && { paddingTop: insets.top }]} testID="client-detail">
      {styleC ? <ForestStatusBar /> : null}
      {/* Flag off: the old header, archive status and tab row. Style C draws its own inside the scroll below. */}
      {!styleC ? (<>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerActions} testID="client-file-header-actions">
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerButtons}>
            <TouchableOpacity
              style={styles.msgIconBtn}
              accessibilityRole="button"
              accessibilityLabel="Open messages"
              onPress={() => {
                if (!currentUser) return;
                // Audit P1: route to the specific client thread, not the Messages
                // tab (which is the global inbox and ignored the params we were
                // passing). ClientMessages lives inside ClientsStack, the same
                // navigator as ClientDetail, so a direct .navigate works.
                navigation.navigate('ClientMessages', { clientId, clientName });
              }}
            >
              <Ionicons name="chatbubble-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
            {isArchived !== null && <TouchableOpacity
              style={styles.msgIconBtn}
              onPress={handleToggleArchive}
              disabled={archiveBusy}
              accessibilityRole="button"
              accessibilityLabel={isArchived ? 'Unarchive client' : 'Archive client'}
            >
              <Ionicons
                name={isArchived ? 'archive' : 'archive-outline'}
                size={20}
                color={isArchived ? colors.warning : colors.textSecondary}
              />
            </TouchableOpacity>}
          </View>
        </View>
        <View style={styles.headerCenter} testID="client-file-header-identity">
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {clientName.split(' ').map((n) => n[0]).join('')}
            </Text>
          </View>
          <View style={styles.headerLabels}>
            <Text style={styles.clientName}>{clientName}</Text>
            <Text style={styles.clientStatus}>
              {[
                isArchived === true ? 'Archived client' : isArchived === false ? 'Active client' : null,
                profile?.primaryGoal?.replace(/_/g, ' '),
              ].filter(Boolean).join(' · ') || 'Client'}
            </Text>
          </View>
        </View>
      </View>

      {archiveStatusError ? (
        <Text accessibilityRole="alert" style={[typography.body, { color: colors.textSecondary, marginHorizontal: 20, marginBottom: 12 }]}>
          {archiveStatusError}
        </Text>
      ) : null}

      {/* Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabScroll}
        contentContainerStyle={[styles.tabRow, { gap: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: sc.border }]}
      >
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: activeTab === tab.key }}
            style={{ minHeight: 48, minWidth: 44, alignItems: 'center', paddingVertical: 12, borderRadius: 0, backgroundColor: sc.bgPrimary, borderBottomWidth: activeTab === tab.key ? 2 : 0, borderBottomColor: sc.accent }}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[typography.bodySmall, { color: activeTab === tab.key ? sc.accentText : sc.textMuted }]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      </>) : null}

      <ScrollView
        contentContainerStyle={styleC ? { paddingBottom: 24 } : styles.scrollContent}
        stickyHeaderIndices={styleC ? [1] : undefined}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {styleC ? fileHead() : null}
        {styleC ? <FileTabs tabs={tabs} active={activeTab} onTab={setActiveTab} /> : null}
        <View style={styleC ? { paddingHorizontal: layout.gutter } : undefined}>
        {styleC && archiveStatusError ? (
          <Text accessibilityRole="alert" style={[typography.body, { color: colors.textSecondary, marginTop: 16 }]}>{archiveStatusError}</Text>
        ) : null}
        <DisputePausedPlansCard
          clientUserId={clientId}
          clientName={clientName}
          reloadKey={planReloadKey}
          colors={colors}
        />
        {activeTab === 'week' && <ThisWeekBody first={first} read={thisWeek.read} profile={profile} onOpen={setActiveTab} onRetry={thisWeek.retry} />}
        {activeTab === 'summary' && (
          <SummaryTab
            profile={profile}
            totals={totals}
            clientId={clientId}
            clientName={clientName}
            nudgeSuccess={nudgeSuccess}
            onOpenMessages={() =>
              navigation.navigate('ClientMessages', {
                clientId,
                clientName,
              })
            }
            onOpenNudge={() => {
              setShowNudgeModal(true);
              setNudgeError('');
            }}
            onOpenMacrosReview={() =>
              navigation.navigate('CoachMacrosReview', {
                clientId,
                clientName,
              })
            }
            onOpenWorkoutBuilder={() => {
              HapticService.selection();
              setActiveTab('workouts');
            }}
            onOpenPayments={
              serverFlags.flags.coach_payment_actions
                ? () => navigation.navigate('ClientPayments', { clientId, clientName })
                : undefined
            }
            openWorkoutRequest={aiProgramRequest}
            onWorkoutRequestHandled={clearAiProgramRequest}
            colors={colors}
            styles={styles}
          />
        )}

        {activeTab === 'logs' && (
          <FoodLogReviewSection
            clientId={clientId}
            profile={profile}
            onOpenMessages={() => navigation.navigate('ClientMessages', { clientId, clientName })}
            colors={colors}
            styles={styles}
          />
        )}

        {activeTab === 'workouts' && (
          <WorkoutsTab
            workoutSessions={workoutSessions}
            clientName={clientName}
            onOpenClientCopy={(planId) => navigation.navigate('CoachWorkoutBuilder', { planId, openAi: true, clientId, clientName })}
            onBuildWithAi={() => {
              setAiProgramRequest(true);
              setActiveTab('summary');
            }}
            colors={colors}
            styles={styles}
          />
        )}

        {activeTab === 'progress' && (
          <ProgressTab weightLogs={weightLogs} colors={colors} styles={styles} />
        )}

        {activeTab === 'healthFitness' && (
          <HealthFitnessTab
            clientId={clientId}
            colors={colors}
            styles={styles}
            onOpenWearablePrompts={
              wearablePromptsOn
                ? () => navigation.navigate('ClientWearablePrompts', { clientId, clientName })
                : undefined
            }
          />
        )}

        {activeTab === 'timeline' && (
          <>
            {/* Date Range Selector */}
            <DateRangeSelector
              selectedDays={selectedDays}
              onSelect={(d) => {
                setSelectedDays(d);
                setTimeline([]);
              }}
            />
            <TimelineTab
              events={timeline}
              loading={timelineLoading}
              error={timelineError}
              onLoad={() => loadTimeline(selectedDays)}
              days={selectedDays}
              viewerId={currentUser?.id ?? null}
              onMarkReviewed={markCheckInReviewed}
            />
          </>
        )}

        {activeTab === 'weekly' && (
          <>
            {/* Date Range Selector */}
            <DateRangeSelector
              selectedDays={selectedDays}
              onSelect={(d) => {
                setSelectedDays(d);
                setWeekSummaries([]);
              }}
            />
            <WeeklySummaryTab
              summaries={weekSummaries}
              loading={weeklyLoading}
              error={weeklyError}
              onRetry={() => loadWeeklySummaries(selectedDays)}
              days={selectedDays}
              expandedWeeks={expandedWeeks}
              onToggleWeek={(weekStart) => {
                setExpandedWeeks((prev) => {
                  const next = new Set(prev);
                  if (next.has(weekStart)) {
                    next.delete(weekStart);
                  } else {
                    next.add(weekStart);
                  }
                  return next;
                });
              }}
            />
          </>
        )}

        {/* PR-HK-3b — coach Sleep & Recovery tab. Anomaly band + cohort
            comparison render here (coach-only); the tab gracefully handles a
            403 from the IDOR-gated samples endpoint. */}
        {activeTab === 'sleepRecovery' && (
          <SleepRecoveryTab clientId={clientId} colors={colors} styles={styles} />
        )}
        </View>
      </ScrollView>
      {styleC ? message : null}

      <NudgeModal
        visible={showNudgeModal}
        onClose={() => {
          setShowNudgeModal(false);
          setNudgeError('');
        }}
        clientName={clientName}
        nudgeTitle={nudgeTitle}
        setNudgeTitle={setNudgeTitle}
        nudgeBody={nudgeBody}
        setNudgeBody={setNudgeBody}
        nudgeError={nudgeError}
        nudgeSending={nudgeSending}
        onSend={sendNudge}
        colors={colors}
        styles={styles}
      />

      {/* AUDIT-14-125: the Ask AI pill is not wired (SummaryTab hides it).
          Every draft it creates names the coach as requester, and the
          gateway refuses a decision by the requester (403), so the coach
          could never approve or reject the nudge it created. The sheet
          stays mounted, closed, until the approval rule supports it.
          Stream 2 — Ask-AI sheet for the four execution capabilities.
          Mounted always; `visible` controls render. On a successful
          submit the sheet closes and we navigate to the pending-drafts
          inbox so the coach sees their new draft land. */}
      <AskAiActionSheet
        visible={askAiVisible}
        clientId={clientId}
        clientName={clientName}
        onClose={() => setAskAiVisible(false)}
        onAfterSubmit={() => navigation.navigate('PendingAiDrafts')}
      />
    </View>
  );
}
