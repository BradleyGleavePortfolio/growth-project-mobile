/**
 * CoachCommunityEventsScreen — the coach's event list + management surface
 * (v2-3). Consumes the v2-3 events backend:
 *   GET  /community/workspaces/:workspaceId/events
 *   POST /community/workspaces/:workspaceId/events            (create)
 *   PATCH /community/events/:eventId                           (edit / transition)
 *   POST /community/events/:eventId/replay                     (attach replay)
 *   POST /community/events/:eventId/reflect                    (reflect / close)
 *
 * Mirrors CoachCommunityCohortsScreen (the gold-standard list pattern):
 *   - Pull-to-refresh on the list.
 *   - A FAB opens a create-event modal (title + start time + optional external
 *     link); submitting fires an optimistic create that reconciles on success.
 *   - Tapping a row opens a MANAGE modal: advance the lifecycle state
 *     (forward-only), attach an EXTERNAL replay link, or reflect (close).
 *   - A CompletionToast confirms each successful mutation (G11).
 *
 * THREE distinct branches (UX P0.2): a loading spinner; an honest
 * CoachErrorState on failure (never a calm/empty masquerade); and — on a
 * genuinely empty list — an honest, NEUTRAL (non-Roman) empty state with a
 * create action.
 *
 * FACE + VOICE CONTRACT (operator rule 2026-06-10): an empty state that speaks
 * in Roman's VOICE must (a) render Roman's FACE and (b) source its copy from
 * the backend Roman voice-policy payload — never hardcoded. The backend
 * coach empty-states payload has NO events surface key, so there is no Roman
 * copy to vend for this surface. Rather than invent client-side "Roman" copy
 * (a face+voice violation) or call the operator-locked CoachEmptyState (which
 * would throw a contract error for an unvended surface), this screen renders a
 * plain functional empty state: a neutral Ionicons line glyph (NOT RomanAvatar)
 * above functional UI copy. It does not speak in Roman's voice, so the
 * face+voice contract does not apply.
 *
 * NO NATIVE LIVE ROOM (Step 0): the "live" / "replay" links are EXTERNAL,
 * host-allowlisted URLs. Nothing here creates or implies an in-app room.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  Platform,
} from 'react-native';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius, withAlpha, semantic } from '../../theme/tokens';
import HapticPressable from '../../components/HapticPressable';
import { Ionicons } from '@expo/vector-icons';
import { CoachErrorState } from '../../components/community/coach';
import CompletionToast, {
  useCompletionToast,
} from '../../components/community/CompletionToast';
import EventCard, { stateMeta } from '../../components/community/EventCard';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useCommunityMe } from '../../hooks/useCommunity';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import {
  useCommunityEventsList,
  useCreateEvent,
  useTransitionEvent,
  useAttachReplay,
  useReflectEvent,
} from '../../hooks/useCommunityEvents';
import { describeMutationError } from '../../api/communityEventsApi';
import type {
  CommunityEvent,
  CommunityEventState,
} from '../../api/communityEventsApi';


/**
 * Forward-only lifecycle order. The state machine on the backend is the
 * authority (it also permits legal skips); the UI offers the single immediate
 * next state as the primary advance affordance.
 */
const STATE_ORDER: CommunityEventState[] = [
  'scheduled',
  'tomorrow',
  'live',
  'replay',
  'reflected',
];

/** Status-honest lifecycle label, shared with the card/detail via stateMeta. */
function stateLabel(state: CommunityEventState | string): string {
  return stateMeta(state).label;
}

/** The immediate next lifecycle state, or null when already terminal. */
function nextState(state: CommunityEventState): CommunityEventState | null {
  const i = STATE_ORDER.indexOf(state);
  if (i < 0 || i >= STATE_ORDER.length - 1) return null;
  return STATE_ORDER[i + 1];
}

/**
 * Local-timezone hint for the create form so a coach knows the time they pick
 * is interpreted in THEIR timezone (serialized to UTC ISO behind the scenes).
 */
function localTimezoneHint(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz ? `Times are in your local timezone (${tz}).` : 'Times are in your local timezone.';
  } catch {
    return 'Times are in your local timezone.';
  }
}

/** Human-readable local rendering of a chosen start Date. */
function formatLocalDateTime(d: Date | null): string {
  if (!d) return 'Pick a date and time';
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function CoachCommunityEventsScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const coach = useCurrentUser();
  const me = useCommunityMe();
  const workspaceId = me.data?.workspace_id ?? undefined;

  const events = useCommunityEventsList(workspaceId);
  const createEvent = useCreateEvent(workspaceId ?? '', coach?.id ?? '');
  const completion = useCompletionToast();
  const reduceMotion = useReducedMotion();

  // ── Create modal ───────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  // F12: the coach picks a date/time via native pickers; we hold a Date and
  // serialize to a UTC ISO string only at submit time.
  const [startsAt, setStartsAt] = useState<Date | null>(null);
  const [liveUrl, setLiveUrl] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const trimmedTitle = title.trim();
  const trimmedLive = liveUrl.trim();
  const canCreate =
    trimmedTitle.length > 0 &&
    startsAt != null &&
    !!workspaceId &&
    !createEvent.isPending;

  const resetCreate = useCallback(() => {
    setTitle('');
    setStartsAt(null);
    setLiveUrl('');
    setCreateError(null);
    setCreateOpen(false);
  }, []);

  const onCreate = useCallback(() => {
    if (!canCreate || startsAt == null) return;
    setCreateError(null);
    createEvent.mutate(
      {
        title: trimmedTitle,
        // Serialize the picked local time to a UTC ISO-8601 string behind the
        // scenes (the backend DTO validates IsISO8601 strict).
        starts_at: startsAt.toISOString(),
        ...(trimmedLive.length > 0 ? { live_url: trimmedLive } : {}),
      },
      {
        onSuccess: () => {
          resetCreate();
          completion.show('Event created.');
        },
        onError: (err) => {
          const info = describeMutationError(err);
          setCreateError(info.message);
          if (info.conflict) void events.refetch();
        },
      },
    );
  }, [
    canCreate,
    startsAt,
    createEvent,
    trimmedTitle,
    trimmedLive,
    resetCreate,
    completion,
    events,
  ]);

  // ── Manage modal (per-event lifecycle) ───────────────────────────────────────
  const [managed, setManaged] = useState<CommunityEvent | null>(null);

  const data = useMemo(() => events.data?.events ?? [], [events.data]);
  const isEmpty =
    !events.isLoading && !events.isError && data.length === 0;

  const renderItem = useCallback(
    ({ item }: { item: CommunityEvent }) => (
      <EventCard
        event={item}
        onPress={(e) => setManaged(e)}
        testID={`coach-community-event-row-${item.id}`}
      />
    ),
    [],
  );

  if (events.isLoading) {
    return (
      <View
        style={[styles.center, { backgroundColor: semanticColors.bgPrimary }]}
        testID="coach-community-events-screen"
      >
        <ActivityIndicator
          color={semanticColors.accent}
          testID="coach-community-events-loading"
        />
      </View>
    );
  }

  return (
    <View
      style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
      testID="coach-community-events-screen"
    >
      {events.isError ? (
        <CoachErrorState
          message="Could not load your events. Pull to retry."
          onRetry={() => events.refetch()}
          retrying={events.isRefetching}
          testID="coach-community-events-error"
        />
      ) : isEmpty ? (
        <View style={styles.emptyWrap} testID="coach-community-events-empty">
          <Ionicons
            name="calendar-outline"
            size={64}
            color={semanticColors.textMuted}
          />
          <Text style={[styles.emptyTitle, { color: semanticColors.textPrimary }]}>
            No events yet
          </Text>
          <Text style={[styles.emptyBody, { color: semanticColors.textMuted }]}>
            Schedule a live session or workshop. Your members will see it and can
            RSVP — and you can add an external link when it goes live.
          </Text>
          <HapticPressable
            intent="medium"
            onPress={() => setCreateOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Schedule your first event"
            testID="coach-community-events-empty-action"
            style={[styles.emptyCta, { backgroundColor: semanticColors.accent }]}
          >
            <Text
              style={[styles.emptyCtaLabel, { color: semanticColors.textOnAccent }]}
            >
              Schedule an event
            </Text>
          </HapticPressable>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(e) => e.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={events.isRefetching}
              onRefresh={() => events.refetch()}
              tintColor={semanticColors.accent}
            />
          }
        />
      )}

      {!isEmpty ? (
        <HapticPressable
          intent="medium"
          onPress={() => setCreateOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Schedule a new event"
          testID="coach-community-events-fab"
          style={[styles.fab, { backgroundColor: semanticColors.accent }]}
        >
          <Text style={[styles.fabLabel, { color: semanticColors.textOnAccent }]}>
            New event
          </Text>
        </HapticPressable>
      ) : null}

      <CreateEventModal
        visible={createOpen}
        reduceMotion={reduceMotion}
        title={title}
        startsAt={startsAt}
        liveUrl={liveUrl}
        canSubmit={canCreate}
        errorMessage={createError}
        onChangeTitle={setTitle}
        onChangeStartsAt={setStartsAt}
        onChangeLiveUrl={setLiveUrl}
        onCancel={resetCreate}
        onSubmit={onCreate}
      />

      <ManageEventModal
        event={managed}
        workspaceId={workspaceId}
        reduceMotion={reduceMotion}
        onClose={() => setManaged(null)}
        onConfirm={(message) => {
          setManaged(null);
          completion.show(message);
        }}
      />

      <CompletionToast state={completion.toast} />
    </View>
  );
}

// ─── Create modal ─────────────────────────────────────────────────────────────

interface CreateEventModalProps {
  visible: boolean;
  reduceMotion: boolean;
  title: string;
  startsAt: Date | null;
  liveUrl: string;
  canSubmit: boolean;
  errorMessage: string | null;
  onChangeTitle: (v: string) => void;
  onChangeStartsAt: (v: Date) => void;
  onChangeLiveUrl: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

function CreateEventModal({
  visible,
  reduceMotion,
  title,
  startsAt,
  liveUrl,
  canSubmit,
  errorMessage,
  onChangeTitle,
  onChangeStartsAt,
  onChangeLiveUrl,
  onCancel,
  onSubmit,
}: CreateEventModalProps): React.ReactElement {
  const { semanticColors } = useTheme();
  // F12: native date + time pickers replace the raw ISO text field. We keep a
  // single Date in the parent; the two pickers edit the date and the time of
  // that same instant. Android shows pickers as transient dialogs (open on
  // demand); iOS renders them inline when open.
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);

  const onPickDate = useCallback(
    (_e: DateTimePickerEvent, picked?: Date) => {
      setShowDate(Platform.OS === 'ios');
      if (!picked) return;
      const base = startsAt ?? new Date();
      const next = new Date(base);
      next.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
      onChangeStartsAt(next);
    },
    [startsAt, onChangeStartsAt],
  );

  const onPickTime = useCallback(
    (_e: DateTimePickerEvent, picked?: Date) => {
      setShowTime(Platform.OS === 'ios');
      if (!picked) return;
      const base = startsAt ?? new Date();
      const next = new Date(base);
      next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
      onChangeStartsAt(next);
    },
    [startsAt, onChangeStartsAt],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'fade'}
      onRequestClose={onCancel}
      testID="coach-community-events-create-modal"
    >
      <View
        style={[
          styles.scrim,
          { backgroundColor: withAlpha(semanticColors.textPrimary, 0.45) },
        ]}
      >
        <View
          style={[
            styles.modalCard,
            {
              backgroundColor: semanticColors.bgSurface,
              borderColor: semanticColors.border,
            },
          ]}
        >
          <Text style={[styles.modalTitle, { color: semanticColors.textPrimary }]}>
            Schedule an event
          </Text>
          <TextInput
            value={title}
            onChangeText={onChangeTitle}
            autoFocus
            placeholder="Live Q&A"
            placeholderTextColor={semanticColors.textMuted}
            accessibilityLabel="Event title"
            testID="coach-community-events-title-input"
            style={inputStyle(semanticColors)}
          />
          <Text style={[styles.fieldLabel, { color: semanticColors.textMuted }]}>
            Starts at
          </Text>
          <View style={styles.pickerRow}>
            <HapticPressable
              intent="light"
              onPress={() => setShowDate(true)}
              accessibilityRole="button"
              accessibilityLabel="Pick start date and time"
              testID="coach-community-events-date-trigger"
              style={[
                styles.pickerField,
                {
                  backgroundColor: semanticColors.bgPrimary,
                  borderColor: semanticColors.border,
                },
              ]}
            >
              <Ionicons
                name="calendar-outline"
                size={16}
                color={semanticColors.textMuted}
              />
              <Text
                style={[styles.pickerText, { color: semanticColors.textPrimary }]}
                numberOfLines={1}
              >
                {formatLocalDateTime(startsAt)}
              </Text>
            </HapticPressable>
            <HapticPressable
              intent="light"
              onPress={() => setShowTime(true)}
              accessibilityRole="button"
              accessibilityLabel="Pick start time"
              testID="coach-community-events-time-trigger"
              style={[
                styles.pickerTime,
                {
                  backgroundColor: semanticColors.bgPrimary,
                  borderColor: semanticColors.border,
                },
              ]}
            >
              <Ionicons
                name="time-outline"
                size={16}
                color={semanticColors.textMuted}
              />
            </HapticPressable>
          </View>
          {showDate ? (
            <DateTimePicker
              value={startsAt ?? new Date()}
              mode="date"
              onChange={onPickDate}
              testID="coach-community-events-date-picker"
            />
          ) : null}
          {showTime ? (
            <DateTimePicker
              value={startsAt ?? new Date()}
              mode="time"
              onChange={onPickTime}
              testID="coach-community-events-time-picker"
            />
          ) : null}
          <Text style={[styles.tzHint, { color: semanticColors.textMuted }]}>
            {localTimezoneHint()}
          </Text>

          <TextInput
            value={liveUrl}
            onChangeText={onChangeLiveUrl}
            placeholder="External link (optional)"
            placeholderTextColor={semanticColors.textMuted}
            autoCapitalize="none"
            keyboardType="url"
            accessibilityLabel="External event link, optional"
            testID="coach-community-events-link-input"
            style={inputStyle(semanticColors)}
          />
          {errorMessage ? (
            <Text
              style={[styles.modalError, { color: semantic.danger.fg }]}
              accessibilityLiveRegion="polite"
              testID="coach-community-events-create-error"
            >
              {errorMessage}
            </Text>
          ) : null}
          <View style={styles.modalActions}>
            <HapticPressable
              intent="light"
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              testID="coach-community-events-create-cancel"
              style={[
                styles.modalButton,
                styles.modalCancel,
                { borderColor: semanticColors.border },
              ]}
            >
              <Text
                style={[styles.modalCancelLabel, { color: semanticColors.textPrimary }]}
              >
                Cancel
              </Text>
            </HapticPressable>
            <HapticPressable
              intent="success"
              onPress={onSubmit}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityLabel="Create event"
              accessibilityState={{ disabled: !canSubmit }}
              testID="coach-community-events-create-submit"
              style={[
                styles.modalButton,
                {
                  backgroundColor: canSubmit
                    ? semanticColors.accent
                    : semanticColors.disabledBg,
                },
              ]}
            >
              <Text
                style={[
                  styles.modalSubmitLabel,
                  {
                    color: canSubmit
                      ? semanticColors.textOnAccent
                      : semanticColors.textOnDisabled,
                  },
                ]}
              >
                Create
              </Text>
            </HapticPressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Manage modal (lifecycle: advance / replay / reflect) ────────────────────

interface ManageEventModalProps {
  event: CommunityEvent | null;
  workspaceId: string | undefined;
  reduceMotion: boolean;
  onClose: () => void;
  onConfirm: (message: string) => void;
}

function ManageEventModal({
  event,
  workspaceId,
  reduceMotion,
  onClose,
  onConfirm,
}: ManageEventModalProps): React.ReactElement | null {
  const { semanticColors } = useTheme();
  const eventId = event?.id ?? '';
  const transition = useTransitionEvent(eventId, workspaceId);
  const attachReplay = useAttachReplay(eventId, workspaceId);
  const reflect = useReflectEvent(eventId, workspaceId);

  const [replayUrl, setReplayUrl] = useState('');
  const trimmedReplay = replayUrl.trim();
  // F4: surface every mutation failure (not just the create path). 409s are
  // classified as conflicts (stale state) and prompt a calm reconcile message.
  const [manageError, setManageError] = useState<string | null>(null);
  // F14: the destructive Reflect (close) action sits behind a calm confirm
  // sheet whose default focus is Cancel — never fired on a single stray tap.
  const [confirmReflect, setConfirmReflect] = useState(false);

  const busy =
    transition.isPending || attachReplay.isPending || reflect.isPending;

  const advanceTo = event ? nextState(event.state) : null;

  const onAdvance = useCallback(() => {
    if (!advanceTo || busy) return;
    setManageError(null);
    transition.mutate(advanceTo, {
      onSuccess: () => onConfirm(`Moved to ${stateLabel(advanceTo)}.`),
      onError: (err) => setManageError(describeMutationError(err).message),
    });
  }, [advanceTo, busy, transition, onConfirm]);

  const onAttachReplay = useCallback(() => {
    if (trimmedReplay.length === 0 || busy) return;
    setManageError(null);
    attachReplay.mutate(trimmedReplay, {
      onSuccess: () => {
        setReplayUrl('');
        onConfirm('Replay attached.');
      },
      onError: (err) => setManageError(describeMutationError(err).message),
    });
  }, [trimmedReplay, busy, attachReplay, onConfirm]);

  const onReflect = useCallback(() => {
    if (busy) return;
    setManageError(null);
    reflect.mutate(undefined, {
      onSuccess: () => {
        setConfirmReflect(false);
        onConfirm('Recap posted.');
      },
      onError: (err) => {
        setConfirmReflect(false);
        setManageError(describeMutationError(err).message);
      },
    });
  }, [busy, reflect, onConfirm]);

  if (!event) return null;

  const isReflected = event.state === 'reflected';

  return (
    <Modal
      visible={event != null}
      transparent
      animationType={reduceMotion ? 'none' : 'fade'}
      onRequestClose={onClose}
      testID="coach-community-events-manage-modal"
    >
      <View
        style={[
          styles.scrim,
          { backgroundColor: withAlpha(semanticColors.textPrimary, 0.45) },
        ]}
      >
        <View
          style={[
            styles.modalCard,
            {
              backgroundColor: semanticColors.bgSurface,
              borderColor: semanticColors.border,
            },
          ]}
        >
          <Text
            style={[styles.modalTitle, { color: semanticColors.textPrimary }]}
            numberOfLines={2}
          >
            {event.title}
          </Text>
          <Text style={[styles.manageState, { color: semanticColors.textMuted }]}>
            {event.canceled ? 'Canceled' : stateLabel(event.state)}
          </Text>

          {advanceTo ? (
            <HapticPressable
              intent="medium"
              onPress={onAdvance}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Advance to ${stateLabel(advanceTo)}`}
              accessibilityState={{ disabled: busy }}
              testID="coach-community-events-advance"
              style={[
                styles.manageButton,
                {
                  backgroundColor: busy
                    ? semanticColors.disabledBg
                    : semanticColors.accent,
                },
              ]}
            >
              <Text
                style={[
                  styles.manageButtonLabel,
                  {
                    color: busy
                      ? semanticColors.textOnDisabled
                      : semanticColors.textOnAccent,
                  },
                ]}
              >
                Move to {stateLabel(advanceTo)}
              </Text>
            </HapticPressable>
          ) : null}

          {!isReflected ? (
            <>
              <TextInput
                value={replayUrl}
                onChangeText={setReplayUrl}
                placeholder="External replay link"
                placeholderTextColor={semanticColors.textMuted}
                autoCapitalize="none"
                keyboardType="url"
                accessibilityLabel="External replay link"
                testID="coach-community-events-replay-input"
                style={inputStyle(semanticColors)}
              />
              <HapticPressable
                intent="medium"
                onPress={onAttachReplay}
                disabled={busy || trimmedReplay.length === 0}
                accessibilityRole="button"
                accessibilityLabel="Attach replay link"
                accessibilityState={{
                  disabled: busy || trimmedReplay.length === 0,
                }}
                testID="coach-community-events-attach-replay"
                style={[
                  styles.manageButton,
                  styles.manageSecondary,
                  { borderColor: semanticColors.accent },
                ]}
              >
                <Text
                  style={[styles.manageSecondaryLabel, { color: semanticColors.accent }]}
                >
                  Attach replay
                </Text>
              </HapticPressable>

              <HapticPressable
                intent="light"
                onPress={() => setConfirmReflect(true)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Reflect and close the event"
                accessibilityHint="Posts the recap and closes the event"
                accessibilityState={{ disabled: busy }}
                testID="coach-community-events-reflect"
                style={styles.reflectTrigger}
              >
                <Text
                  style={[styles.reflectTriggerLabel, { color: semanticColors.textMuted }]}
                >
                  Reflect (close)
                </Text>
              </HapticPressable>
            </>
          ) : (
            <Text style={[styles.manageDone, { color: semanticColors.textMuted }]}>
              This event is reflected and closed.
            </Text>
          )}

          {manageError ? (
            <Text
              style={[styles.modalError, { color: semantic.danger.fg }]}
              accessibilityLiveRegion="polite"
              testID="coach-community-events-manage-error"
            >
              {manageError}
            </Text>
          ) : null}

          <HapticPressable
            intent="light"
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Done"
            testID="coach-community-events-manage-close"
            style={[
              styles.modalButton,
              styles.modalCancel,
              styles.manageClose,
              { borderColor: semanticColors.border },
            ]}
          >
            <Text style={[styles.modalCancelLabel, { color: semanticColors.textPrimary }]}>
              Done
            </Text>
          </HapticPressable>
        </View>
      </View>

      {/* F14: calm confirm sheet for the irreversible Reflect (close). Cancel is
          the default, prominent affordance; confirm is the secondary one. */}
      <Modal
        visible={confirmReflect}
        transparent
        animationType={reduceMotion ? 'none' : 'fade'}
        onRequestClose={() => setConfirmReflect(false)}
        testID="coach-community-events-reflect-confirm"
      >
        <View
          style={[
            styles.scrim,
            { backgroundColor: withAlpha(semanticColors.textPrimary, 0.45) },
          ]}
        >
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: semanticColors.bgSurface,
                borderColor: semanticColors.border,
              },
            ]}
          >
            <Text style={[styles.modalTitle, { color: semanticColors.textPrimary }]}>
              Reflect and close this event?
            </Text>
            <Text style={[styles.manageDone, { color: semanticColors.textMuted }]}>
              This posts the recap and closes the event. You can’t reopen it
              afterward.
            </Text>
            <View style={styles.modalActions}>
              <HapticPressable
                intent="medium"
                onPress={() => setConfirmReflect(false)}
                accessibilityRole="button"
                accessibilityLabel="Keep the event open"
                testID="coach-community-events-reflect-cancel"
                style={[
                  styles.modalButton,
                  { backgroundColor: semanticColors.accent },
                ]}
              >
                <Text
                  style={[styles.modalSubmitLabel, { color: semanticColors.textOnAccent }]}
                >
                  Keep open
                </Text>
              </HapticPressable>
              <HapticPressable
                intent="light"
                onPress={onReflect}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Reflect and close"
                accessibilityState={{ disabled: busy }}
                testID="coach-community-events-reflect-confirm-action"
                style={[
                  styles.modalButton,
                  styles.modalCancel,
                  { borderColor: semanticColors.border },
                ]}
              >
                <Text
                  style={[styles.modalCancelLabel, { color: semanticColors.textMuted }]}
                >
                  Reflect (close)
                </Text>
              </HapticPressable>
            </View>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

function inputStyle(semanticColors: {
  bgPrimary: string;
  border: string;
  textPrimary: string;
}) {
  return [
    styles.modalInput,
    {
      backgroundColor: semanticColors.bgPrimary,
      borderColor: semanticColors.border,
      color: semanticColors.textPrimary,
    },
  ];
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    paddingVertical: spacing.md,
    paddingBottom: 96,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: spacing.md,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    maxWidth: 320,
  },
  emptyCta: {
    marginTop: spacing.lg,
    minHeight: 48,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  emptyCtaLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.xl,
    minHeight: 48,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fabLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  scrim: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  modalInput: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    fontSize: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: -spacing.xs,
  },
  pickerRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  pickerField: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
  },
  pickerTime: {
    minHeight: 48,
    minWidth: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
  },
  pickerText: {
    flex: 1,
    fontSize: 15,
  },
  tzHint: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: -spacing.xs,
  },
  modalError: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  reflectTrigger: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  reflectTriggerLabel: {
    fontSize: 14,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  modalButton: {
    minHeight: 44,
    minWidth: 96,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.md,
  },
  modalCancel: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  modalCancelLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  modalSubmitLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  manageState: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  manageButton: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.md,
  },
  manageButtonLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  manageSecondary: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  manageSecondaryLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  manageDone: {
    fontSize: 14,
    lineHeight: 21,
  },
  manageClose: {
    alignSelf: 'flex-end',
  },
});
