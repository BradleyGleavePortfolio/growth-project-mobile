// SessionsUpcomingScreen — calm list of the client's upcoming coaching calls.
//
// Data comes through getSessionsAdapter(). When the backend is not yet
// deployed the adapter returns realistic mock data and the mock data banner
// is shown so Bradley can see clearly that it is not live. All states —
// disabled, loading, empty, ready, error — render without crashing.

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, spacing, typography } from '../../theme/tokens';
import {
  SESSIONS_DISABLED_PLACEHOLDER,
  SESSIONS_EMPTY_NO_SESSIONS_CLIENT,
  SESSIONS_FAIL_CLOSED_ERROR,
  SESSION_JOIN,
  sessionTypeLabel,
  statusLabelFor,
  videoProviderLabel,
} from '../../constants/sessionsCopy';
import { sessionsFlags } from '../../config/sessionsFlags';
import { getSessionsAdapter } from '../../services/sessions/sessionsClient';
import { joinDisplay } from '../../lib/sessionsStatusDisplay';
import MockDataBanner from '../../components/sessions/MockDataBanner';
import type { MoreStackParamList } from '../../navigation/ClientNavigator';
import type {
  SessionsLoadState,
  UpcomingSessionView,
} from '../../types/sessions';
import { errorMessage } from '../../types/common';

type Props = {
  navigation: NativeStackNavigationProp<MoreStackParamList, 'SessionsUpcoming'>;
  route: RouteProp<MoreStackParamList, 'SessionsUpcoming'>;
};

export default function SessionsUpcomingScreen({ route }: Props) {
  const { clientId } = route.params;
  const [state, setState] = useState<SessionsLoadState>({ kind: 'idle' });

  const load = useCallback(async () => {
    if (!sessionsFlags.SESSIONS_ENABLED) {
      setState({ kind: 'feature_disabled' });
      return;
    }
    setState({ kind: 'loading' });
    try {
      const sessions = await getSessionsAdapter().listUpcomingForClient(
        clientId,
      );
      if (sessions.length === 0) {
        setState({ kind: 'empty_no_sessions' });
      } else {
        setState({ kind: 'ready', sessions });
      }
    } catch (err) {
      setState({ kind: 'error', message: errorMessage(err) });
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={styles.root}>
      <MockDataBanner />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={state.kind === 'loading'}
            onRefresh={load}
          />
        }
      >
        <Text
          style={styles.heading}
          accessibilityRole="header"
        >
          Calls with your coach
        </Text>
        {renderBody(state)}
      </ScrollView>
    </View>
  );
}

function renderBody(state: SessionsLoadState) {
  switch (state.kind) {
    case 'idle':
    case 'loading':
      return (
        <Text
          style={styles.muted}
          accessibilityLabel="Loading your upcoming calls"
        >
          Loading
        </Text>
      );
    case 'feature_disabled':
      return (
        <Placeholder
          title={SESSIONS_DISABLED_PLACEHOLDER.title}
          body={SESSIONS_DISABLED_PLACEHOLDER.body}
          testID="sessions-disabled"
        />
      );
    case 'empty_no_sessions':
      return (
        <Placeholder
          title={SESSIONS_EMPTY_NO_SESSIONS_CLIENT.title}
          body={SESSIONS_EMPTY_NO_SESSIONS_CLIENT.body}
          testID="sessions-empty"
        />
      );
    case 'empty_no_coach':
      return (
        <Placeholder
          title="No coach assigned yet"
          body="Calls appear here once you are matched with a coach."
          testID="sessions-no-coach"
        />
      );
    case 'error':
      return (
        <Placeholder
          title={SESSIONS_FAIL_CLOSED_ERROR.title}
          body={SESSIONS_FAIL_CLOSED_ERROR.body}
          testID="sessions-error"
        />
      );
    case 'ready':
      return (
        <View>
          {state.sessions.map((view) => (
            <SessionCard key={view.session.id} view={view} />
          ))}
        </View>
      );
  }
}

function SessionCard({ view }: { view: UpcomingSessionView }) {
  const join = joinDisplay(view.session);
  const typeLabel = sessionTypeLabel(view.session.type);
  const timeLabel = formatRange(view.session.startsAt, view.session.endsAt);
  const statusLabel = statusLabelFor(view.session.status, 'client');
  return (
    <View
      style={styles.card}
      testID={`session-card-${view.session.id}`}
      accessible
      accessibilityLabel={`${typeLabel}, ${timeLabel}, ${statusLabel}`}
    >
      <Text style={styles.cardType}>{typeLabel}</Text>
      <Text style={styles.cardTime}>{timeLabel}</Text>
      <Text style={styles.cardStatus}>{statusLabel}</Text>
      <Text style={styles.cardProvider}>
        {videoProviderLabel(view.session.videoProvider)}
      </Text>
      {renderJoin(join, view.isJoinable)}
    </View>
  );
}

function renderJoin(
  join: ReturnType<typeof joinDisplay>,
  isJoinable: boolean,
) {
  switch (join.kind) {
    case 'real':
      return (
        <TouchableOpacity
          style={[styles.joinBtn, !isJoinable && styles.joinBtnDisabled]}
          disabled={!isJoinable}
          accessibilityLabel={SESSION_JOIN.joinAction}
          accessibilityRole="button"
          testID="session-join-real"
        >
          <Text style={styles.joinBtnLabel}>{SESSION_JOIN.joinAction}</Text>
        </TouchableOpacity>
      );
    case 'pending':
      return (
        <View style={styles.joinPending} testID="session-join-pending">
          <Text style={styles.joinPendingTitle}>
            {SESSION_JOIN.joinPendingTitle}
          </Text>
          <Text style={styles.joinPendingBody}>
            {SESSION_JOIN.joinPendingBody}
          </Text>
        </View>
      );
    case 'phone':
      return (
        <View style={styles.joinPending} testID="session-join-phone">
          <Text style={styles.joinPendingTitle}>{SESSION_JOIN.joinPhoneTitle}</Text>
          <Text style={styles.joinPendingBody}>{SESSION_JOIN.joinPhoneBody}</Text>
        </View>
      );
    case 'feature_disabled':
      return (
        <View style={styles.joinPending} testID="session-join-flag-off">
          <Text style={styles.joinPendingTitle}>
            {SESSION_JOIN.joinPendingTitle}
          </Text>
        </View>
      );
  }
}

function Placeholder({
  title,
  body,
  testID,
}: {
  title: string;
  body: string;
  testID: string;
}) {
  return (
    <View style={styles.placeholder} testID={testID}>
      <Text style={styles.placeholderTitle}>{title}</Text>
      <Text style={styles.placeholderBody}>{body}</Text>
    </View>
  );
}

function formatRange(startsAt: string, endsAt: string): string {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return '';
  const date = s.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const start = s.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  const end = e.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${date} · ${start} – ${end}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bone },
  scroll: { flex: 1 },
  content: { padding: spacing.lg },
  heading: {
    ...typography.h2,
    color: colors.ink,
    marginBottom: spacing.lg,
  },
  card: {
    backgroundColor: colors.cream,
    padding: spacing.lg,
    borderRadius: 12,
    marginBottom: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.camel,
  },
  cardType: { ...typography.eyebrow, color: colors.charcoal },
  cardTime: { ...typography.h3, color: colors.ink, marginTop: spacing.xs },
  cardStatus: {
    ...typography.body,
    color: colors.forest,
    marginTop: spacing.xs,
  },
  cardProvider: {
    ...typography.caption,
    color: colors.stone,
    marginTop: spacing.xs,
  },
  joinBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.forest,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    alignItems: 'center',
  },
  joinBtnDisabled: { opacity: 0.4 },
  joinBtnLabel: { ...typography.bodyMd, color: colors.bone },
  joinPending: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: 8,
    backgroundColor: colors.bone,
  },
  joinPendingTitle: {
    ...typography.bodyMd,
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  joinPendingBody: { ...typography.body, color: colors.charcoal },
  placeholder: {
    padding: spacing.xl,
    backgroundColor: colors.cream,
    borderRadius: 12,
    alignItems: 'center',
  },
  placeholderTitle: {
    ...typography.h3,
    color: colors.ink,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  placeholderBody: {
    ...typography.body,
    color: colors.charcoal,
    textAlign: 'center',
  },
  muted: { ...typography.body, color: colors.stone },
});
