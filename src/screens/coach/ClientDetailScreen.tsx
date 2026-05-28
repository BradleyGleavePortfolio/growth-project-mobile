import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { coachApi } from '../../services/api';

import type { IoniconName } from '../../types/common';
import { useTheme } from '../../theme/ThemeProvider';
import { errorMessage } from '../../types/common';
import { SkeletonProfileHeader, SkeletonWorkoutRow, SkeletonStatTile } from '../../ui/skeletons';

import { makeStyles } from './client-detail/styles';
import {
  emptyItemDraft,
  type CoachMealPlan,
  type PlanItemDraft,
  type Props,
  type TabKey,
} from './client-detail/types';
import { DateRangeSelector } from './client-detail/DateRangeSelector';
import { TimelineTab } from './client-detail/TimelineTab';
import { WeeklySummaryTab } from './client-detail/WeeklySummaryTab';
import { FoodLogReviewSection } from './client-detail/FoodLogReviewSection';
import { SummaryTab } from './client-detail/SummaryTab';
import { WorkoutsTab } from './client-detail/WorkoutsTab';
import { MealPlanTab } from './client-detail/MealPlanTab';
import { ProgressTab } from './client-detail/ProgressTab';
import { PlanFormModal } from './client-detail/PlanFormModal';
import { NudgeModal } from './client-detail/NudgeModal';
import { useClientDetailData } from './client-detail/useClientDetailData';
// Stream 2 — AskAi sheet for the four execution capabilities.
import { AskAiActionSheet } from '../../components/coach/ai-execution/AskAiActionSheet';

export default function ClientDetailScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { clientId, clientName } = route.params;
  const currentUser = useCurrentUser();

  const {
    profile,
    foodLogs,
    totals,
    weightLogs,
    workoutSessions,
    timeline,
    weekSummaries,
    isLoading,
    loadError,
    refreshing,
    isArchived,
    setIsArchived,
    setTimeline,
    setWeekSummaries,
    setRefreshing,
    serverMealPlans,
    mealPlansLoading,
    mealPlansError,
    loadData,
    loadServerMealPlans,
    loadTimeline,
    loadWeeklySummaries,
  } = useClientDetailData(clientId, colors);

  const [activeTab, setActiveTab] = useState<TabKey>('summary');
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

  // Server-side meal plans (Tier 2). The legacy local-SQLite `mealPlanDb`
  // shim was removed in the nutrition P0 cleanup — Grocery / Shopping /
  // PrepGuide all read from the server (`listsApi`, `prepGuideApi`) now.
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<CoachMealPlan | null>(null);
  const [planTitle, setPlanTitle] = useState('');
  const [planNotes, setPlanNotes] = useState('');
  const [planItems, setPlanItems] = useState<PlanItemDraft[]>([emptyItemDraft()]);
  const [planSaving, setPlanSaving] = useState(false);
  const [planFormError, setPlanFormError] = useState('');

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
  // state (active tab, expanded weeks, draft nudge text, plan-form modal) is
  // also reset to its initial shape so we don't briefly render Client B's
  // profile under Client A's selected tab or half-typed nudge.
  useEffect(() => {
    setActiveTab('summary');
    setExpandedWeeks(new Set());
    setShowNudgeModal(false);
    setNudgeTitle('');
    setNudgeBody('');
    setNudgeError('');
    setShowPlanModal(false);
    setEditingPlan(null);
    setPlanFormError('');
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
    if (activeTab === 'mealplan') {
      loadServerMealPlans();
    }
  }, [activeTab, selectedDays, clientId, loadTimeline, loadWeeklySummaries, loadServerMealPlans]);

  const openCreatePlan = () => {
    setEditingPlan(null);
    setPlanTitle('');
    setPlanNotes('');
    setPlanItems([emptyItemDraft()]);
    setPlanFormError('');
    setShowPlanModal(true);
  };

  const openEditPlan = (plan: CoachMealPlan) => {
    setEditingPlan(plan);
    setPlanTitle(plan.title);
    setPlanNotes(plan.notes || '');
    setPlanItems(
      plan.items.length > 0
        ? plan.items.map((it) => ({
            name: it.name || '',
            calories: it.calories != null ? String(it.calories) : '',
            protein: it.protein != null ? String(it.protein) : '',
            notes: it.notes || '',
            time_of_day: it.time_of_day || '',
          }))
        : [emptyItemDraft()],
    );
    setPlanFormError('');
    setShowPlanModal(true);
  };

  const submitPlanForm = async () => {
    setPlanFormError('');
    if (!planTitle.trim()) {
      setPlanFormError('Give the plan a title.');
      return;
    }
    const items = planItems
      .filter((it) => it.name.trim().length > 0)
      .map((it) => {
        const row: Record<string, unknown> = { name: it.name.trim() };
        const cal = Number(it.calories);
        if (it.calories && !Number.isNaN(cal)) row.calories = cal;
        const prot = Number(it.protein);
        if (it.protein && !Number.isNaN(prot)) row.protein = prot;
        if (it.notes.trim()) row.notes = it.notes.trim();
        if (it.time_of_day.trim()) row.time_of_day = it.time_of_day.trim().toLowerCase();
        return row;
      });
    if (items.length === 0) {
      setPlanFormError('Add at least one meal item.');
      return;
    }
    setPlanSaving(true);
    try {
      const body: Record<string, unknown> = {
        title: planTitle.trim(),
        notes: planNotes.trim() || null,
        items,
      };
      if (editingPlan) {
        await coachApi.updateMealPlan(editingPlan.id, body);
      } else {
        await coachApi.createClientMealPlan(clientId, body);
      }
      setShowPlanModal(false);
      await loadServerMealPlans();
    } catch (err) {
      setPlanFormError(errorMessage(err, 'Save failed. Try again.'));
    } finally {
      setPlanSaving(false);
    }
  };

  const archivePlan = (plan: CoachMealPlan) => {
    Alert.alert(
      'Archive meal plan?',
      `"${plan.title}" will no longer show up for this client.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: async () => {
            try {
              await coachApi.archiveMealPlan(plan.id);
              await loadServerMealPlans();
            } catch (err) {
              Alert.alert(
                'Archive failed',
                errorMessage(err, 'Try again.'),
              );
            }
          },
        },
      ],
    );
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData, setRefreshing]);

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
    { key: 'summary', label: 'Summary', icon: 'pie-chart-outline' },
    { key: 'logs', label: 'Logs', icon: 'restaurant-outline' },
    { key: 'workouts', label: 'Workouts', icon: 'barbell-outline' },
    { key: 'mealplan', label: 'Plan', icon: 'calendar-outline' },
    { key: 'progress', label: 'Progress', icon: 'trending-up-outline' },
    { key: 'timeline', label: 'Timeline', icon: 'time-outline' },
    { key: 'weekly', label: 'Weekly', icon: 'stats-chart-outline' },
  ];

  const handleToggleArchive = async () => {
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
      Alert.alert('Error', errorMessage(err, 'Failed to update client status.'));
    } finally {
      setArchiveBusy(false);
    }
  };

  if (isLoading && !refreshing) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
        <SkeletonProfileHeader />
        <View style={{ paddingHorizontal: 16, gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <SkeletonStatTile />
            <SkeletonStatTile />
            <SkeletonStatTile />
          </View>
        </View>
        <View style={{ paddingHorizontal: 16, marginTop: 16, gap: 8 }}>
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
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }]}>
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
            borderRadius: 4,
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
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {clientName.split(' ').map((n) => n[0]).join('')}
            </Text>
          </View>
          <View>
            <Text style={styles.clientName}>{clientName}</Text>
            <Text style={styles.clientStatus}>
              {profile?.primaryGoal?.replace(/_/g, ' ') || 'Active client'}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.msgIconBtn}
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
        <TouchableOpacity
          style={[styles.msgIconBtn, { marginLeft: 4 }]}
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
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabScroll}
        contentContainerStyle={styles.tabRow}
      >
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Ionicons
              name={tab.icon}
              size={16}
              color={activeTab === tab.key ? colors.textOnPrimary : colors.textSecondary}
            />
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {activeTab === 'summary' && (
          <SummaryTab
            profile={profile}
            totals={totals}
            clientId={clientId}
            clientName={route.params.clientName}
            nudgeSuccess={nudgeSuccess}
            onOpenMessages={() =>
              navigation.navigate('ClientMessages', {
                clientId,
                clientName: route.params.clientName,
              })
            }
            onOpenNudge={() => {
              setShowNudgeModal(true);
              setNudgeError('');
            }}
            onOpenMacrosReview={() =>
              navigation.navigate('CoachMacrosReview', {
                clientId,
                clientName: route.params.clientName,
              })
            }
            onOpenWorkoutBuilder={() => navigation.navigate('CoachWorkoutBuilder', undefined)}
            onOpenAskAi={() => setAskAiVisible(true)}
            colors={colors}
            styles={styles}
          />
        )}

        {activeTab === 'logs' && (
          <FoodLogReviewSection
            clientId={clientId}
            todayLogs={foodLogs}
            colors={colors}
            styles={styles}
          />
        )}

        {activeTab === 'workouts' && (
          <WorkoutsTab workoutSessions={workoutSessions} colors={colors} styles={styles} />
        )}

        {activeTab === 'mealplan' && (
          <MealPlanTab
            serverMealPlans={serverMealPlans}
            mealPlansLoading={mealPlansLoading}
            mealPlansError={mealPlansError}
            onCreate={openCreatePlan}
            onEdit={openEditPlan}
            onArchive={archivePlan}
            onRetry={loadServerMealPlans}
            colors={colors}
            styles={styles}
          />
        )}

        {activeTab === 'progress' && (
          <ProgressTab weightLogs={weightLogs} colors={colors} styles={styles} />
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
              onLoad={() => loadTimeline(selectedDays)}
              days={selectedDays}
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
      </ScrollView>

      <PlanFormModal
        visible={showPlanModal}
        onClose={() => setShowPlanModal(false)}
        editingPlan={editingPlan}
        planTitle={planTitle}
        setPlanTitle={setPlanTitle}
        planNotes={planNotes}
        setPlanNotes={setPlanNotes}
        planItems={planItems}
        setPlanItems={setPlanItems}
        planFormError={planFormError}
        planSaving={planSaving}
        onSubmit={submitPlanForm}
        colors={colors}
        styles={styles}
      />

      <NudgeModal
        visible={showNudgeModal}
        onClose={() => {
          setShowNudgeModal(false);
          setNudgeError('');
        }}
        clientName={route.params.clientName}
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

      {/* Stream 2 — Ask-AI sheet for the four execution capabilities.
          Mounted always; `visible` controls render. On a successful
          submit the sheet closes and we navigate to the pending-drafts
          inbox so the coach sees their new draft land. */}
      <AskAiActionSheet
        visible={askAiVisible}
        clientId={clientId}
        clientName={route.params.clientName}
        onClose={() => setAskAiVisible(false)}
        onAfterSubmit={() => navigation.navigate('PendingAiDrafts')}
      />
    </View>
  );
}
