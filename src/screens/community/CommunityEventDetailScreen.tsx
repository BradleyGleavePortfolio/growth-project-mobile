/**
 * CommunityEventDetailScreen — the client-facing detail for a single community
 * EVENT (v2-3). Shows the event title, lifecycle state, schedule, description,
 * a live RSVP summary, a state-aware RSVP affordance, and — when present — a
 * single EXTERNAL link the client opens in the system browser.
 *
 * NO NATIVE LIVE ROOM (Step 0): there is no in-app room or player. The
 * `external_url` is an externally-hosted, host-allowlisted link; opening it
 * hands off to the OS browser and the VISIBLE copy says so ("… in browser").
 * Nothing here says "join native room". External links are scheme-guarded
 * (https only) before they ever reach `Linking.openURL`.
 *
 * THREE distinct branches (UX P0.2 / doctrine §6.2): a loading spinner; an
 * honest error surface with retry on failure (never a calm/empty masquerade);
 * and a NEUTRAL event empty state (a calm line icon + direct copy + one "Back
 * to community" action — no mascot voice or avatar) when the event id resolves
 * to nothing. RSVP is optimistic with rollback, and a failed RSVP surfaces a
 * calm inline error (a 409 also refetches to reconcile).
 *
 * RSVP hierarchy (UX): the affordance is state-specific rather than three equal
 * buttons — when the viewer has not responded, "Going" is the primary action
 * and "Maybe" is secondary; once they are going, the surface shows a calm
 * "You're going" confirmation with quiet Change / Withdraw; a "maybe" viewer
 * gets a primary "Switch to going". A successful save or withdraw shows a brief
 * confirmation. Accessibility labels carry the RSVP'd status; the selected
 * state is never colour-only (a check glyph + label back it up).
 */
import React, { useCallback, useState } from 'react';
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
import { spacing, radius, withAlpha, semantic } from '../../theme/tokens';
import HapticPressable from '../../components/HapticPressable';
import { stateMeta, formatEventStart, rsvpSummary } from '../../components/community/EventCard';
import CompletionToast, {
  useCompletionToast,
} from '../../components/community/CompletionToast';
import { useCommunityMe } from '../../hooks/useCommunity';
import { useCommunityEvent, useRsvpEvent } from '../../hooks/useCommunityEvents';
import { describeMutationError } from '../../api/communityEventsApi';
import { safeExternalEventUrl } from '../../utils/safeExternalEventUrl';
import type {
  CommunityClientRsvpStatus,
  CommunityEventState,
} from '../../api/communityEventsApi';
import type { CommunityNav, CommunityRoute } from './communityNavTypes';

/** Link affordance copy by state — HONEST that it leaves the app for the browser. */
function linkLabel(state: CommunityEventState | string): string {
  if (state === 'replay' || state === 'reflected') return 'Watch replay in browser';
  return 'Open link in browser';
}

export default function CommunityEventDetailScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const navigation = useNavigation<CommunityNav>();
  const route = useRoute<CommunityRoute<'CommunityEventDetail'>>();
  const eventId = route.params?.eventId ?? '';
  const me = useCommunityMe();
  const completion = useCompletionToast();

  const eventQuery = useCommunityEvent(eventId.length > 0 ? eventId : undefined);
  const rsvp = useRsvpEvent(eventId, me.data?.workspace_id ?? undefined);
  const event = eventQuery.data;

  // Calm inline error for a failed external-link open or a failed RSVP.
  const [linkError, setLinkError] = useState<string | null>(null);
  const [rsvpError, setRsvpError] = useState<string | null>(null);

  const onOpenLink = useCallback(() => {
    setLinkError(null);
    const safe = safeExternalEventUrl(event?.external_url);
    if (!safe) {
      setLinkError('This link can’t be opened safely.');
      return;
    }
    void Linking.openURL(safe).catch(() => {
      setLinkError('We couldn’t open that link. Please try again.');
    });
  }, [event?.external_url]);

  const onRsvp = useCallback(
    (status: CommunityClientRsvpStatus, confirmation: string) => {
      if (rsvp.isPending) return;
      setRsvpError(null);
      rsvp.mutate(status, {
        onSuccess: () => completion.show(confirmation),
        onError: (err) => {
          const info = describeMutationError(err);
          setRsvpError(info.message);
          if (info.conflict) void eventQuery.refetch();
        },
      });
    },
    [rsvp, completion, eventQuery],
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

  // ── Empty (no such event) — NEUTRAL, never a mascot voice/avatar ─────────────
  if (!event) {
    return (
      <SafeAreaView
        style={[styles.safe, { backgroundColor: semanticColors.bgPrimary }]}
        edges={['top']}
        testID="community-event-detail-screen"
      >
        <View style={styles.center} testID="community-event-detail-empty">
          <Ionicons
            name="calendar-outline"
            size={48}
            color={semanticColors.textMuted}
          />
          <Text style={[styles.emptyTitle, { color: semanticColors.textPrimary }]}>
            This event is gone
          </Text>
          <Text style={[styles.emptyBody, { color: semanticColors.textMuted }]}>
            It may have been removed or never existed. Head back to find what’s
            happening now.
          </Text>
          <HapticPressable
            intent="medium"
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Back to community"
            testID="community-event-detail-empty-action"
            style={[styles.emptyCta, { backgroundColor: semanticColors.accent }]}
          >
            <Text
              style={[styles.emptyCtaLabel, { color: semanticColors.textOnAccent }]}
            >
              Back to community
            </Text>
          </HapticPressable>
        </View>
      </SafeAreaView>
    );
  }

  const summary = rsvpSummary(event);
  const meta = stateMeta(event.state);
  const viewerStatus = event.viewer_rsvp_status;
  const showRsvp = !event.canceled && event.state !== 'reflected';

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
            {event.canceled ? 'Canceled' : meta.label}
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
          <>
            <HapticPressable
              intent="medium"
              onPress={onOpenLink}
              accessibilityRole="link"
              accessibilityLabel={`${linkLabel(event.state)} (opens outside the app)`}
              testID="community-event-detail-link"
              style={[styles.linkButton, { borderColor: semanticColors.accent }]}
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
            {linkError ? (
              <Text
                style={[styles.inlineError, { color: semantic.danger.fg }]}
                testID="community-event-detail-link-error"
              >
                {linkError}
              </Text>
            ) : null}
          </>
        ) : null}

        {showRsvp ? (
          <View style={styles.rsvpBlock}>
            <RsvpSection
              status={viewerStatus}
              pending={rsvp.isPending}
              onRsvp={onRsvp}
              colors={semanticColors}
            />
            {rsvpError ? (
              <Text
                style={[styles.inlineError, { color: semantic.danger.fg }]}
                testID="community-event-rsvp-error"
              >
                {rsvpError}
              </Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <CompletionToast state={completion.toast} />
    </SafeAreaView>
  );
}

// ─── RSVP section: state-specific hierarchy (UX) ─────────────────────────────

interface RsvpColors {
  textPrimary: string;
  textMuted: string;
  textOnAccent: string;
  accent: string;
  bgSurface: string;
  border: string;
}

interface RsvpSectionProps {
  status: string | null;
  pending: boolean;
  onRsvp: (status: CommunityClientRsvpStatus, confirmation: string) => void;
  colors: RsvpColors;
}

/**
 * Renders ONE primary RSVP path for the viewer's current state (Hick's Law:
 * a single obvious next action, secondary choices de-emphasised):
 *   - not responded → primary "Going" + secondary "Maybe"
 *   - going         → calm "You're going" confirmation + quiet Change / Withdraw
 *   - maybe         → primary "Switch to going" + quiet Change / Withdraw
 *   - declined      → primary "Going" + secondary "Maybe" (re-offer)
 * Selected state is reinforced with a check glyph + label, never colour alone.
 */
function RsvpSection({
  status,
  pending,
  onRsvp,
  colors,
}: RsvpSectionProps): React.ReactElement {
  const going = status === 'going';
  const maybe = status === 'maybe';

  if (going) {
    return (
      <View style={styles.rsvpStateWrap}>
        <View
          style={styles.rsvpConfirmRow}
          accessibilityRole="text"
          accessibilityLabel="You're going. RSVP'd: going."
          testID="community-event-rsvp-going-state"
        >
          <Ionicons name="checkmark-circle" size={20} color={semantic.success.icon} />
          <Text style={[styles.rsvpConfirmText, { color: colors.textPrimary }]}>
            You’re going
          </Text>
        </View>
        <View style={styles.rsvpQuietRow}>
          <QuietRsvpButton
            label="Change to maybe"
            a11y="Change RSVP to maybe"
            disabled={pending}
            onPress={() => onRsvp('maybe', 'Changed to maybe.')}
            color={colors.textMuted}
            border={colors.border}
            testID="community-event-rsvp-maybe"
          />
          <QuietRsvpButton
            label="Withdraw"
            a11y="Withdraw your RSVP"
            disabled={pending}
            onPress={() => onRsvp('declined', 'RSVP withdrawn.')}
            color={colors.textMuted}
            border={colors.border}
            testID="community-event-rsvp-declined"
          />
        </View>
      </View>
    );
  }

  // maybe → primary switch to going; not-responded / declined → offer Going.
  const heading = maybe ? 'You said maybe' : 'Will you be there?';
  return (
    <View style={styles.rsvpStateWrap}>
      <Text style={[styles.rsvpHeading, { color: colors.textPrimary }]}>
        {heading}
      </Text>
      <PrimaryRsvpButton
        label={maybe ? 'Switch to going' : 'Going'}
        a11y={maybe ? "Switch RSVP to going" : "RSVP going"}
        selected={false}
        disabled={pending}
        onPress={() => onRsvp('going', "You're going.")}
        colors={colors}
        testID="community-event-rsvp-going"
      />
      <View style={styles.rsvpQuietRow}>
        <QuietRsvpButton
          label={maybe ? 'Selected: maybe' : 'Maybe'}
          a11y={maybe ? "RSVP'd: maybe" : 'RSVP maybe'}
          disabled={pending}
          selected={maybe}
          onPress={() => onRsvp('maybe', 'Marked as maybe.')}
          color={maybe ? colors.accent : colors.textMuted}
          border={maybe ? colors.accent : colors.border}
          testID="community-event-rsvp-maybe"
        />
        {!maybe ? (
          <QuietRsvpButton
            label="Can’t make it"
            a11y="RSVP can't make it"
            disabled={pending}
            onPress={() => onRsvp('declined', 'Marked as can’t make it.')}
            color={colors.textMuted}
            border={colors.border}
            testID="community-event-rsvp-declined"
          />
        ) : null}
      </View>
    </View>
  );
}

function PrimaryRsvpButton({
  label,
  a11y,
  selected,
  disabled,
  onPress,
  colors,
  testID,
}: {
  label: string;
  a11y: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
  colors: RsvpColors;
  testID: string;
}): React.ReactElement {
  return (
    <HapticPressable
      intent="success"
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ selected, disabled }}
      testID={testID}
      style={[styles.rsvpPrimary, { backgroundColor: colors.accent }]}
    >
      {selected ? (
        <Ionicons name="checkmark" size={16} color={colors.textOnAccent} />
      ) : null}
      <Text style={[styles.rsvpPrimaryLabel, { color: colors.textOnAccent }]}>
        {label}
      </Text>
    </HapticPressable>
  );
}

function QuietRsvpButton({
  label,
  a11y,
  disabled,
  selected = false,
  onPress,
  color,
  border,
  testID,
}: {
  label: string;
  a11y: string;
  disabled: boolean;
  selected?: boolean;
  onPress: () => void;
  color: string;
  border: string;
  testID: string;
}): React.ReactElement {
  return (
    <HapticPressable
      intent="light"
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ selected, disabled }}
      testID={testID}
      style={[styles.rsvpQuiet, { borderColor: border }]}
    >
      {selected ? <Ionicons name="checkmark" size={14} color={color} /> : null}
      <Text style={[styles.rsvpQuietLabel, { color }]}>{label}</Text>
    </HapticPressable>
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
  inlineError: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: spacing.xs,
  },
  rsvpBlock: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  rsvpStateWrap: {
    gap: spacing.sm,
  },
  rsvpHeading: {
    fontSize: 16,
    fontWeight: '600',
  },
  rsvpConfirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rsvpConfirmText: {
    fontSize: 16,
    fontWeight: '600',
  },
  rsvpPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
  },
  rsvpPrimaryLabel: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  rsvpQuietRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  rsvpQuiet: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rsvpQuietLabel: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 320,
  },
  emptyCta: {
    marginTop: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  emptyCtaLabel: {
    fontSize: 15,
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
