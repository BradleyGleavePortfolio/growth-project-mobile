/**
 * ClientConsultationScreen — the coach's read of one client's consultation
 * answers (owner decision 2026-09-30: the coach sees every client's
 * consultation answers, easily). Reached from client detail > Summary >
 * "Consultation" card (ConsultationSummaryCard).
 *
 * Reads GET /coach/clients/:clientId/consultation (backend #607, live in
 * production; contract in src/api/coachConsultationApi.ts). Read-only: the
 * coach never edits the client's answers. Readiness answers come first when
 * any is yes, because that is what the coach acts on. Personal training only:
 * the screen shows what the client said and makes no medical judgement.
 *
 * States: loading; answers; none (nothing on file yet); and one specific
 * failure state per cause (offline, busy, session ended, unexpected with a
 * short support reference and a support email). Unexpected failures go to
 * Sentry with status, bounded code and reference only, never answers. The
 * query opts out of the persisted cache (`meta.persist: false`), so answers
 * are never written to device storage.
 */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import {
  ConsultationLoadError,
  consultationQueryKey,
  formatConsultationDate,
  loadClientConsultation,
  screeningSummary,
  type ConsultationView,
} from '../../api/coachConsultationApi';
import { reportUnexpected } from '../../lib/consultation/report';
import { shortReference } from '../../utils/correlation';
import { signOut } from '../../services/authActions';
import {
  SupportEmailFallback,
  useSupportEmail,
} from '../../components/support/SupportEmailFallback';
import { spacing, typography } from '../../theme/tokens';
import type { SemanticTokens } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';

export type ClientConsultationParams = {
  clientId: string;
  clientName?: string;
};

interface Props {
  route: RouteProp<{ ClientConsultation: ClientConsultationParams }, 'ClientConsultation'>;
}

/** Plain first name for copy ("Sam's answers"), falling back to "this client". */
export function firstNameOf(name: string | undefined): string | null {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return first ? first : null;
}

/** Copy for each failure kind: what happened, then what to do. */
export function failureCopy(err: unknown): { title: string; body: string } {
  const kind = err instanceof ConsultationLoadError ? err.kind : 'unexpected';
  switch (kind) {
    case 'offline':
      return {
        title: 'No connection',
        body: 'The answers could not load because this phone is offline. Check your connection, then try again.',
      };
    case 'busy':
      return {
        title: 'A lot of requests just now',
        body: 'The server asked for a short pause. Wait a few seconds, then try again.',
      };
    case 'session':
      return {
        title: 'Your session has ended',
        body: 'For your clients\u2019 privacy, log in again to see their answers.',
      };
    default:
      return {
        title: 'The answers did not load',
        body: 'Try again. If it keeps happening, email support and quote the reference below.',
      };
  }
}

export default function ClientConsultationScreen({ route }: Props): React.ReactElement {
  const { clientId, clientName } = route.params;
  const { semanticColors: sc } = useTheme();
  const styles = makeStyles(sc);
  const support = useSupportEmail('Consultation answers did not load');
  const q = useQuery({
    queryKey: consultationQueryKey(clientId),
    queryFn: () => loadClientConsultation(clientId),
    meta: { persist: false },
    retry: false,
    staleTime: 30_000,
  });

  // Report each unexpected failure once (per error object), never the answers.
  const reported = React.useRef<unknown>(null);
  React.useEffect(() => {
    const err = q.error;
    if (!err || reported.current === err) return;
    reported.current = err;
    if (err instanceof ConsultationLoadError && err.kind !== 'unexpected') return;
    reportUnexpected('coach_consultation_read', {
      status: err instanceof ConsultationLoadError ? err.status : null,
      code: err instanceof ConsultationLoadError ? err.code : 'unknown',
      requestId: err instanceof ConsultationLoadError ? err.requestId : null,
    });
  }, [q.error]);

  const first = firstNameOf(clientName);

  let body: React.ReactNode;
  if (q.isLoading) {
    body = (
      <View
        style={styles.center}
        testID="consultation-loading"
        accessibilityRole="progressbar"
        accessibilityLabel="Loading consultation answers"
      >
        <ActivityIndicator color={sc.textMuted} />
      </View>
    );
  } else if (q.isError) {
    const copy = failureCopy(q.error);
    const kind = q.error instanceof ConsultationLoadError ? q.error.kind : 'unexpected';
    const ref =
      kind === 'unexpected' && q.error instanceof ConsultationLoadError
        ? shortReference(q.error.requestId)
        : null;
    body = (
      <View style={styles.card} testID={`consultation-error-${kind}`} accessibilityRole="alert">
        <Text style={[typography.h3, { color: sc.textPrimary }]}>{copy.title}</Text>
        <Text style={[typography.body, { color: sc.textPrimary }]}>{copy.body}</Text>
        {ref ? (
          <Text
            style={[typography.bodySmall, { color: sc.textMuted }]}
            selectable
            testID="consultation-error-reference"
          >
            Reference {ref}
          </Text>
        ) : null}
        <View style={styles.actions}>
          {kind === 'session' ? (
            <ActionButton
              label="Log in again"
              testID="consultation-login"
              onPress={() => {
                void signOut();
              }}
              sc={sc}
              styles={styles}
            />
          ) : (
            <ActionButton
              label="Try again"
              testID="consultation-retry"
              onPress={() => {
                void q.refetch();
              }}
              sc={sc}
              styles={styles}
            />
          )}
          {kind === 'unexpected' ? (
            <ActionButton
              label="Email support"
              testID="consultation-support"
              onPress={() => {
                void support.open();
              }}
              sc={sc}
              styles={styles}
              quiet
            />
          ) : null}
        </View>
        <SupportEmailFallback
          handle={support}
          linkColor={sc.accentText}
          textStyle={[typography.bodySmall, { color: sc.textMuted }]}
          testID="consultation-support-fallback"
        />
      </View>
    );
  } else if (!q.data || q.data.kind === 'none') {
    body = (
      <View style={styles.card} testID="consultation-none">
        <Text style={[typography.h3, { color: sc.textPrimary }]}>No answers yet</Text>
        <Text style={[typography.body, { color: sc.textPrimary }]}>
          {`No consultation answers are on file for ${first ?? 'this client'} yet.`}
        </Text>
        <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
          {`They appear here as soon as ${first ?? 'your client'} saves the first chapter of the consultation in the app. Pull down to refresh.`}
        </Text>
      </View>
    );
  } else {
    body = <ConsultationBody view={q.data.view} sc={sc} styles={styles} />;
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      testID="client-consultation-screen"
      refreshControl={
        <RefreshControl
          refreshing={q.isRefetching}
          onRefresh={() => {
            void q.refetch();
          }}
          tintColor={sc.textMuted}
        />
      }
    >
      <Text style={[typography.eyebrow, { color: sc.textMuted }]}>Consultation</Text>
      <Text style={[typography.h2, { color: sc.textPrimary }]} accessibilityRole="header">
        {clientName?.trim() ? clientName.trim() : 'Client'}
      </Text>
      {body}
    </ScrollView>
  );
}

function ActionButton({
  label,
  onPress,
  testID,
  sc,
  styles,
  quiet = false,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  sc: SemanticTokens;
  styles: Styles;
  quiet?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [
        styles.action,
        quiet ? styles.actionQuiet : { backgroundColor: sc.accent },
        pressed && { opacity: 0.8 },
      ]}
    >
      <Text style={[typography.bodyMd, { color: quiet ? sc.accentText : sc.textOnAccent }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ConsultationBody({
  view,
  sc,
  styles,
}: {
  view: ConsultationView;
  sc: SemanticTokens;
  styles: Styles;
}): React.ReactElement {
  const flagged = view.screening.items.filter((i) => i.answer === 'yes');
  const summary = screeningSummary(view);
  const status = view.submitted_at
    ? `Completed ${formatConsultationDate(view.submitted_at)}`
    : `In progress, last saved ${formatConsultationDate(view.saved_at)}`;
  let readinessLine: string;
  if (summary.total === 0 || summary.answered === 0) readinessLine = 'Not answered yet.';
  else if (summary.answered < summary.total)
    readinessLine = `No to the ${summary.answered} answered so far, ${summary.total - summary.answered} still to answer.`;
  else readinessLine = 'No to every readiness question.';
  return (
    <View testID="consultation-answers" style={{ gap: spacing.sm }}>
      <Text style={[typography.bodySmall, { color: sc.textMuted }]} testID="consultation-status">
        {status}
      </Text>

      <View
        style={[styles.card, view.screening.any_yes ? { borderColor: sc.accent, borderWidth: 1 } : null]}
        testID="consultation-readiness"
      >
        <Text style={[typography.h3, { color: sc.textPrimary }]}>Readiness questions</Text>
        {view.screening.any_yes ? (
          <>
            <Text style={[typography.bodySmall, { color: sc.textMuted }]} testID="consultation-screening-flag">
              {flagged.length === 1
                ? 'Yes to one question. Talk it through with them before the first session.'
                : `Yes to ${flagged.length} questions. Talk them through with them before the first session.`}
            </Text>
            {flagged.map((item) => (
              <View key={item.key} style={styles.answer}>
                <Text style={[typography.bodyMd, { color: sc.textPrimary }]}>{item.question}</Text>
                <Text style={[typography.body, { color: sc.textPrimary }]}>Yes</Text>
                {item.note ? (
                  <Text style={[typography.bodySmall, { color: sc.textMuted }]}>{item.note}</Text>
                ) : null}
              </View>
            ))}
          </>
        ) : (
          <Text style={[typography.bodySmall, { color: sc.textMuted }]} testID="consultation-readiness-line">
            {readinessLine}
          </Text>
        )}
      </View>

      {view.chapters.map((chapter) => (
        <View key={chapter.key} style={styles.card} testID={`consultation-chapter-${chapter.key}`}>
          <Text style={[typography.h3, { color: sc.textPrimary }]}>{chapter.title}</Text>
          {chapter.answers.length === 0 ? (
            <Text style={[typography.bodySmall, { color: sc.textMuted }]}>Not answered yet.</Text>
          ) : (
            chapter.answers.map((a) => (
              <View key={a.screen} style={styles.answer}>
                <Text style={[typography.bodySmall, { color: sc.textMuted }]}>{a.question}</Text>
                <Text style={[typography.body, { color: sc.textPrimary }]} selectable>
                  {a.answer_label}
                </Text>
              </View>
            ))
          )}
        </View>
      ))}

      {view.consent.agreed_at ? (
        <Text style={[typography.bodySmall, { color: sc.textMuted }]} testID="consultation-consent">
          Agreed to the coaching terms {formatConsultationDate(view.consent.agreed_at)}.
        </Text>
      ) : null}
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(sc: SemanticTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: sc.bgPrimary },
    content: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing['3xl'] },
    center: { paddingVertical: spacing.xl, alignItems: 'center' },
    card: {
      backgroundColor: sc.bgSurface,
      borderRadius: 12,
      padding: spacing.lg,
      gap: spacing.xs,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: sc.border,
    },
    answer: { paddingTop: spacing.sm, gap: 2 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingTop: spacing.sm },
    action: {
      minHeight: 44,
      paddingHorizontal: spacing.lg,
      borderRadius: 22,
      justifyContent: 'center',
      alignItems: 'center',
    },
    actionQuiet: { borderWidth: 1, borderColor: sc.border },
  });
}
