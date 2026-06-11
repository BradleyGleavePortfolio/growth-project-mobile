/**
 * CommunityEventDetailScreen — the client-facing detail for a single community
 * EVENT (v2-3). Shows the event title, lifecycle state, schedule, description,
 * a live RSVP summary, the three client RSVP actions (going / maybe /
 * declined), and — when present — a single EXTERNAL link the client opens in
 * the system browser.
 *
 * NO NATIVE LIVE ROOM (Step 0): there is no in-app room or player. The
 * `external_url` is an externally-hosted, host-allowlisted link; the action
 * label is always "Open link" (live) / "Watch replay" (replay) and opening it
 * hands off to the OS browser. Nothing here says "join native room".
 *
 * THREE distinct branches (UX P0.2 / doctrine §6.2): a loading spinner; an
 * honest error surface with retry on failure (never a calm/empty masquerade);
 * and a Roman-voiced empty state (reusing the shared `todayEmpty` stem) when
 * the event id resolves to nothing. RSVP is optimistic with rollback.
 */
import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius, withAlpha } from '../../theme/tokens';
import HapticPressable from '../../components/HapticPressable';
import { CommunityEmptyState } from '../../components/community';
import { formatEventStart, rsvpSummary } from '../../components/community/EventCard';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useCommunityMe } from '../../hooks/useCommunity';
import { useCommunityEvent, useRsvpEvent } from '../../hooks/useCommunityEvents';
import type {
  CommunityClientRsvpStatus,
  CommunityEventState,
} from '../../api/communityEventsApi';
import type { CommunityNav, CommunityRoute } from './communityNavTypes';

const STATE_LABEL: Record<CommunityEventState, string> = {
  scheduled: 'Scheduled',
  tomorrow: 'Tomorrow',
  live: 'Live',
  replay: 'Replay',
  reflected: 'Recap',
};

const RSVP_OPTIONS: ReadonlyArray<{
  status: CommunityClientRsvpStatus;
  label: string;
}> = [
  { status: 'going', label: 'Going' },
  { status: 'maybe', label: 'Maybe' },
  { status: 'declined', label: 'Can’t make it' },
];

/** Link affordance copy by state — never implies a native room. */
function linkLabel(state: CommunityEventState): string {
  if (state === 'replay' || state === 'reflected') return 'Watch replay';
  return 'Open link';
}

export default function CommunityEventDetailScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const navigation = useNavigation<CommunityNav>();
  const route = useRoute<CommunityRoute<'CommunityEventDetail'>>();
  const eventId = route.params?.eventId ?? '';
  const client = useCurrentUser();
  const me = useCommunityMe();

  const eventQuery = useCommunityEvent(eventId.length > 0 ? eventId : undefined);
  const rsvp = useRsvpEvent(eventId, me.data?.workspace_id ?? undefined);
  const event = eventQuery.data;

  const onOpenLink = useCallback(() => {
    const url = event?.external_url;
    if (!url) return;
    void Linking.canOpenURL(url).then((ok) => {
      if (ok) void Linking.openURL(url);
    });
  }, [event?.external_url]);

  const onRsvp = useCallback(
    (status: CommunityClientRsvpStatus) => {
      if (rsvp.isPending) return;
      rsvp.mutate(status);
    },
    [rsvp],
  );

  // ── Loading ────────────────────────────────────────────────────────────────
  if (eventQuery.isLoading) {
    return (
      <SafeAreaView
        style={[styles.safe, { backgroundColor: semanticColors.bgPrimary }]}
        edges={['top']}
        testID="community-event-detail-screen"
      >
        <View style={styles.center}>
          <ActivityIndicator
            color={semanticColors.accent}
            testID="community-event-detail-loading"
          />
        </View>
      </SafeAreaView>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (eventQuery.isError) {
    return (
      <SafeAreaView
        style={[styles.safe, { backgroundColor: semanticColors.bgPrimary }]}
        edges={['top']}
        testID="community-event-detail-screen"
      >
        <View style={styles.center}>
          <Ionicons
            name="cloud-offline-outline"
            size={40}
            color={semanticColors.textMuted}
          />
          <Text style={[styles.errorCopy, { color: semanticColors.textPrimary }]}>
            We could not load this event. Check your connection and try again.
          </Text>
          <HapticPressable
            intent="medium"
            onPress={() => eventQuery.refetch()}
            disabled={eventQuery.isRefetching}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            accessibilityState={{ disabled: eventQuery.isRefetching }}
            testID="community-event-detail-retry"
            style={[
              styles.retry,
              {
                backgroundColor: eventQuery.isRefetching
                  ? semanticColors.disabledBg
                  : semanticColors.accent,
              },
            ]}
          >
            <Text
              style={[
                styles.retryLabel,
                {
                  color: eventQuery.isRefetching
                    ? semanticColors.textOnDisabled
                    : semanticColors.textOnAccent,
                },
              ]}
            >
              Try again
            </Text>
          </HapticPressable>
        </View>
      </SafeAreaView>
    );
  }

  // ── Empty (no such event) ────────────────────────────────────────────────────
  if (!event) {
    return (
      <SafeAreaView
        style={[styles.safe, { backgroundColor: semanticColors.bgPrimary }]}
        edges={['top']}
        testID="community-event-detail-screen"
      >
        <View style={styles.center}>
          <CommunityEmptyState
            stem="todayEmpty"
            firstName={client?.firstName ?? client?.name ?? null}
            title="This event is gone"
            actionLabel="Back to community"
            onAction={() => navigation.goBack()}
            quipSeed={eventId}
            testID="community-event-detail-empty"
          />
        </View>
      </SafeAreaView>
    );
  }

  const summary = rsvpSummary(event);

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: semanticColors.bgPrimary }]}
      edges={['top']}
      testID="community-event-detail-screen"
    >
      <ScrollView contentContainerStyle={styles.content}>
        <View
          style={[
            styles.badge,
            { backgroundColor: withAlpha(semanticColors.accent, 0.12) },
          ]}
        >
          <Text style={[styles.badgeLabel, { color: semanticColors.accent }]}>
            {event.canceled ? 'Canceled' : STATE_LABEL[event.state]}
          </Text>
        </View>

        <Text style={[styles.title, { color: semanticColors.textPrimary }]}>
          {event.title}
        </Text>

        <View style={styles.metaRow}>
          <Ionicons
            name="calendar-outline"
            size={16}
            color={semanticColors.textMuted}
          />
          <Text style={[styles.meta, { color: semanticColors.textMuted }]}>
            {formatEventStart(event.starts_at)}
          </Text>
        </View>

        {summary.length > 0 ? (
          <View style={styles.metaRow}>
            <Ionicons
              name="people-outline"
              size={16}
              color={semanticColors.textMuted}
            />
            <Text style={[styles.meta, { color: semanticColors.textMuted }]}>
              {summary}
            </Text>
          </View>
        ) : null}

        {event.description ? (
          <Text
            style={[styles.description, { color: semanticColors.textPrimary }]}
          >
            {event.description}
          </Text>
        ) : null}

        {event.external_url ? (
          <HapticPressable
            intent="medium"
            onPress={onOpenLink}
            accessibilityRole="link"
            accessibilityLabel={`${linkLabel(event.state)} (opens in your browser)`}
            testID="community-event-detail-link"
            style={[
              styles.linkButton,
              { borderColor: semanticColors.accent },
            ]}
          >
            <Ionicons
              name="open-outline"
              size={16}
              color={semanticColors.accent}
            />
            <Text style={[styles.linkLabel, { color: semanticColors.accent }]}>
              {linkLabel(event.state)}
            </Text>
          </HapticPressable>
        ) : null}

        {!event.canceled && event.state !== 'reflected' ? (
          <View style={styles.rsvpBlock}>
            <Text
              style={[styles.rsvpHeading, { color: semanticColors.textPrimary }]}
            >
              Will you be there?
            </Text>
            <View style={styles.rsvpRow}>
              {RSVP_OPTIONS.map((opt) => {
                const active = event.viewer_rsvp_status === opt.status;
                return (
                  <HapticPressable
                    key={opt.status}
                    intent="success"
                    onPress={() => onRsvp(opt.status)}
                    disabled={rsvp.isPending}
                    accessibilityRole="button"
                    accessibilityLabel={`RSVP ${opt.label}`}
                    accessibilityState={{
                      selected: active,
                      disabled: rsvp.isPending,
                    }}
                    testID={`community-event-rsvp-${opt.status}`}
                    style={[
                      styles.rsvpButton,
                      {
                        backgroundColor: active
                          ? semanticColors.accent
                          : semanticColors.bgSurface,
                        borderColor: active
                          ? semanticColors.accent
                          : semanticColors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.rsvpButtonLabel,
                        {
                          color: active
                            ? semanticColors.textOnAccent
                            : semanticColors.textPrimary,
                        },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </HapticPressable>
                );
              })}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  badgeLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  meta: {
    fontSize: 14,
    fontWeight: '500',
  },
  description: {
    fontSize: 15,
    lineHeight: 23,
    marginTop: spacing.xs,
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.sm,
  },
  linkLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  rsvpBlock: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  rsvpHeading: {
    fontSize: 16,
    fontWeight: '600',
  },
  rsvpRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  rsvpButton: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rsvpButtonLabel: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  errorCopy: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    maxWidth: 320,
  },
  retry: {
    minHeight: 44,
    minWidth: 120,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.md,
  },
  retryLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
});
