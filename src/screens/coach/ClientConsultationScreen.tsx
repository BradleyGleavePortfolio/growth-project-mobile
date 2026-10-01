/**
 * ClientConsultationScreen — the coach's read of one client's consultation
 * answers (owner decision 2026-09-30). Reached from client detail, Summary,
 * "Consultation". Registered only behind featureFlags.coachConsultationView
 * (OFF by default, ON in the `clinic` EAS profile).
 *
 * Reads GET /coach/clients/:clientId/consultation (backend #607). Read-only:
 * the coach never edits the client's answers. The readiness items are shown
 * first when any is yes, because that is what the coach must act on. This is
 * personal training: the screen shows what the client said, nothing more, and
 * makes no medical judgement.
 *
 * States: loading; answers; `none` (no answers on file); `unavailable` (the
 * server does not have this view yet, before #607 deploys); error with retry.
 * The query opts out of the persisted cache (`meta.persist: false`) so the
 * answers are never written to device storage.
 */
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { RouteProp } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import {
  fetchClientConsultation,
  type ConsultationView,
} from "../../api/coachConsultationApi";
import { spacing, typography } from "../../theme/tokens";
import type { SemanticTokens } from "../../theme/tokens";
import { useTheme } from "../../theme/ThemeProvider";

export type ClientConsultationParams = {
  clientId: string;
  clientName?: string;
};

interface Props {
  route: RouteProp<
    { ClientConsultation: ClientConsultationParams },
    "ClientConsultation"
  >;
}

export function consultationQueryKey(clientId: string) {
  return ["coach", "consultation", clientId] as const;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function ClientConsultationScreen({
  route,
}: Props): React.ReactElement {
  const { clientId, clientName } = route.params;
  const { semanticColors: sc } = useTheme();
  const styles = makeStyles(sc);
  const q = useQuery({
    queryKey: consultationQueryKey(clientId),
    queryFn: () => fetchClientConsultation(clientId),
    meta: { persist: false },
    retry: false,
  });

  const header = (
    <>
      <Text style={[typography.eyebrow, { color: sc.textMuted }]}>
        Consultation
      </Text>
      <Text
        style={[typography.h2, { color: sc.textPrimary }]}
        accessibilityRole="header"
      >
        {clientName ?? "Client"}
      </Text>
    </>
  );

  let body: React.ReactNode;
  if (q.isLoading) {
    body = (
      <View style={styles.center} testID="consultation-loading">
        <ActivityIndicator color={sc.textMuted} />
      </View>
    );
  } else if (q.isError) {
    body = (
      <View style={styles.card} testID="consultation-error">
        <Text style={[typography.body, { color: sc.textPrimary }]}>
          The consultation answers could not be loaded.
        </Text>
        <Pressable
          onPress={() => q.refetch()}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          testID="consultation-retry"
          style={styles.retry}
        >
          <Text style={[typography.bodyMd, { color: sc.textPrimary }]}>
            Try again
          </Text>
        </Pressable>
      </View>
    );
  } else if (q.data?.kind === "unavailable") {
    body = (
      <View style={styles.card} testID="consultation-unavailable">
        <Text style={[typography.body, { color: sc.textPrimary }]}>
          Consultation answers are not available on this server yet.
        </Text>
        <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
          They will appear here once the update reaches the server. Nothing is
          lost in the meantime.
        </Text>
      </View>
    );
  } else if (q.data?.kind === "none" || !q.data) {
    body = (
      <View style={styles.card} testID="consultation-none">
        <Text style={[typography.body, { color: sc.textPrimary }]}>
          No consultation answers are on file for this client yet.
        </Text>
        <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
          Answers show up here as soon as the client saves their consultation.
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
    >
      {header}
      {body}
    </ScrollView>
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
  const flagged = view.screening.items.filter((i) => i.answer === "yes");
  const status = view.submitted_at
    ? `Completed ${formatDate(view.submitted_at)}`
    : `In progress, last saved ${formatDate(view.saved_at)}`;
  return (
    <View testID="consultation-answers" style={{ gap: spacing.sm }}>
      <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
        {status}
      </Text>

      <View
        style={[
          styles.card,
          view.screening.any_yes
            ? { borderColor: sc.accent, borderWidth: 1 }
            : null,
        ]}
      >
        <Text style={[typography.h3, { color: sc.textPrimary }]}>
          Readiness questions
        </Text>
        {view.screening.any_yes ? (
          <>
            <Text
              style={[typography.bodySmall, { color: sc.textMuted }]}
              testID="consultation-screening-flag"
            >
              The client answered yes to{" "}
              {flagged.length === 1
                ? "one question"
                : `${flagged.length} questions`}
              . Check in with them before their first session.
            </Text>
            {flagged.map((item) => (
              <View key={item.key} style={styles.answer}>
                <Text style={[typography.bodyMd, { color: sc.textPrimary }]}>
                  {item.question}
                </Text>
                <Text style={[typography.body, { color: sc.textPrimary }]}>
                  Yes
                </Text>
                {item.note ? (
                  <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
                    {item.note}
                  </Text>
                ) : null}
              </View>
            ))}
          </>
        ) : (
          <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
            {view.screening.items.length > 0
              ? "No to every readiness question."
              : "Not answered yet."}
          </Text>
        )}
      </View>

      {view.chapters.map((chapter) => (
        <View
          key={chapter.key}
          style={styles.card}
          testID={`consultation-chapter-${chapter.key}`}
        >
          <Text style={[typography.h3, { color: sc.textPrimary }]}>
            {chapter.title}
          </Text>
          {chapter.answers.length === 0 ? (
            <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
              Not answered yet.
            </Text>
          ) : (
            chapter.answers.map((a) => (
              <View key={a.screen} style={styles.answer}>
                <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
                  {a.question}
                </Text>
                <Text style={[typography.body, { color: sc.textPrimary }]}>
                  {a.answer_label}
                </Text>
              </View>
            ))
          )}
        </View>
      ))}

      {view.consent.agreed_at ? (
        <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
          Consent given {formatDate(view.consent.agreed_at)}.
        </Text>
      ) : null}
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(sc: SemanticTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: sc.bgPrimary },
    content: {
      padding: spacing.lg,
      gap: spacing.sm,
      paddingBottom: spacing["3xl"],
    },
    center: { paddingVertical: spacing.xl, alignItems: "center" },
    card: {
      backgroundColor: sc.bgSurface,
      borderRadius: 12,
      padding: spacing.lg,
      gap: spacing.xs,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: sc.border,
    },
    answer: { paddingTop: spacing.sm, gap: 2 },
    retry: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  });
}
