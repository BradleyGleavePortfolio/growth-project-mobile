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
} from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius, withAlpha } from '../../theme/tokens';
import HapticPressable from '../../components/HapticPressable';
import { Ionicons } from '@expo/vector-icons';
import { CoachErrorState } from '../../components/community/coach';
import CompletionToast, {
  useCompletionToast,
} from '../../components/community/CompletionToast';
import EventCard from '../../components/community/EventCard';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useCommunityMe } from '../../hooks/useCommunity';
import {
  useCommunityEventsList,
  useCreateEvent,
  useTransitionEvent,
  useAttachReplay,
  useReflectEvent,
} from '../../hooks/useCommunityEvents';
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

const STATE_LABEL: Record<CommunityEventState, string> = {
  scheduled: 'Scheduled',
  tomorrow: 'Tomorrow',
  live: 'Live',
  replay: 'Replay',
  reflected: 'Recap',
};

/** The immediate next lifecycle state, or null when already terminal. */
function nextState(state: CommunityEventState): CommunityEventState | null {
  const i = STATE_ORDER.indexOf(state);
  if (i < 0 || i >= STATE_ORDER.length - 1) return null;
  return STATE_ORDER[i + 1];
}

export default function CoachCommunityEventsScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const coach = useCurrentUser();
  const me = useCommunityMe();
  const workspaceId = me.data?.workspace_id ?? undefined;

  const events = useCommunityEventsList(workspaceId);
  const createEvent = useCreateEvent(workspaceId ?? '', coach?.id ?? '');
  const completion = useCompletionToast();

  // ── Create modal ───────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [liveUrl, setLiveUrl] = useState('');

  const trimmedTitle = title.trim();
  const trimmedStarts = startsAt.trim();
  const trimmedLive = liveUrl.trim();
  const canCreate =
    trimmedTitle.length > 0 &&
    trimmedStarts.length > 0 &&
    !!workspaceId &&
    !createEvent.isPending;

  const resetCreate = useCallback(() => {
    setTitle('');
    setStartsAt('');
    setLiveUrl('');
    setCreateOpen(false);
  }, []);

  const onCreate = useCallback(() => {
    if (!canCreate) return;
    createEvent.mutate(
      {
        title: trimmedTitle,
        starts_at: trimmedStarts,
        ...(trimmedLive.length > 0 ? { live_url: trimmedLive } : {}),
      },
      {
        onSuccess: () => {
          resetCreate();
          completion.show('Event created.');
        },
      },
    );
  }, [
    canCreate,
    createEvent,
    trimmedTitle,
    trimmedStarts,
    trimmedLive,
    resetCreate,
    completion,
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
        title={title}
        startsAt={startsAt}
        liveUrl={liveUrl}
        canSubmit={canCreate}
        onChangeTitle={setTitle}
        onChangeStartsAt={setStartsAt}
        onChangeLiveUrl={setLiveUrl}
        onCancel={resetCreate}
        onSubmit={onCreate}
      />

      <ManageEventModal
        event={managed}
        workspaceId={workspaceId}
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
  title: string;
  startsAt: string;
  liveUrl: string;
  canSubmit: boolean;
  onChangeTitle: (v: string) => void;
  onChangeStartsAt: (v: string) => void;
  onChangeLiveUrl: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

function CreateEventModal({
  visible,
  title,
  startsAt,
  liveUrl,
  canSubmit,
  onChangeTitle,
  onChangeStartsAt,
  onChangeLiveUrl,
  onCancel,
  onSubmit,
}: CreateEventModalProps): React.ReactElement {
  const { semanticColors } = useTheme();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
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
          <TextInput
            value={startsAt}
            onChangeText={onChangeStartsAt}
            placeholder="Starts at (e.g. 2026-07-01T18:00:00Z)"
            placeholderTextColor={semanticColors.textMuted}
            autoCapitalize="none"
            accessibilityLabel="Event start time, ISO-8601"
            testID="coach-community-events-starts-input"
            style={inputStyle(semanticColors)}
          />
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
  onClose: () => void;
  onConfirm: (message: string) => void;
}

function ManageEventModal({
  event,
  workspaceId,
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

  const busy =
    transition.isPending || attachReplay.isPending || reflect.isPending;

  const advanceTo = event ? nextState(event.state) : null;

  const onAdvance = useCallback(() => {
    if (!advanceTo || busy) return;
    transition.mutate(advanceTo, {
      onSuccess: () => onConfirm(`Moved to ${STATE_LABEL[advanceTo]}.`),
    });
  }, [advanceTo, busy, transition, onConfirm]);

  const onAttachReplay = useCallback(() => {
    if (trimmedReplay.length === 0 || busy) return;
    attachReplay.mutate(trimmedReplay, {
      onSuccess: () => {
        setReplayUrl('');
        onConfirm('Replay attached.');
      },
    });
  }, [trimmedReplay, busy, attachReplay, onConfirm]);

  const onReflect = useCallback(() => {
    if (busy) return;
    reflect.mutate(undefined, {
      onSuccess: () => onConfirm('Event reflected.'),
    });
  }, [busy, reflect, onConfirm]);

  if (!event) return null;

  const isReflected = event.state === 'reflected';

  return (
    <Modal
      visible={event != null}
      transparent
      animationType="fade"
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
            {event.canceled ? 'Canceled' : STATE_LABEL[event.state]}
          </Text>

          {advanceTo ? (
            <HapticPressable
              intent="medium"
              onPress={onAdvance}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Advance to ${STATE_LABEL[advanceTo]}`}
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
                Move to {STATE_LABEL[advanceTo]}
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
                intent="success"
                onPress={onReflect}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Reflect and close the event"
                accessibilityState={{ disabled: busy }}
                testID="coach-community-events-reflect"
                style={[
                  styles.manageButton,
                  styles.manageSecondary,
                  { borderColor: semanticColors.border },
                ]}
              >
                <Text
                  style={[styles.manageSecondaryLabel, { color: semanticColors.textPrimary }]}
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
