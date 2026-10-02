import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  ActivityIndicator,
  ScrollView,
  AppState,
} from "react-native";
import { SkeletonList } from "../../ui/skeletons/Skeleton";
import { useTheme } from "../../theme/useTheme";
import {
  dataExportApi,
  dataExportErrorCode,
  DataExportRecord,
  DataExportResponseError,
  DATA_EXPORT_BAD_RESPONSE,
  DOWNLOAD_ROUTE,
  legacyDownloadPath,
} from "../../services/dataExportApi";
import { env } from "../../config/env";
import {
  extractRequestId,
  newRequestId,
  REQUEST_ID_HEADER,
} from "../../utils/correlation";
import { captureError } from "../../services/sentry";
import { authEvents } from "../../utils/authEvents";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { SUPPORT_EMAIL } from "../../constants/support";

// ─── Screen state ─────────────────────────────────────────────────────────────

/** What happened, what to do next, and a support reference when we have one. */
interface Notice {
  title: string;
  message: string;
  reference: string | null;
}

type NextAction = "request" | "reload";

type ScreenState =
  | { phase: "idle"; notice?: Notice | null }
  | { phase: "loading" }
  | { phase: "requesting" }
  | { phase: "polling"; record: DataExportRecord }
  | {
      phase: "ready";
      record: DataExportRecord;
      downloading: boolean;
      notice: Notice | null;
    }
  | { phase: "unavailable"; record: DataExportRecord }
  | { phase: "failed"; notice: Notice; next: NextAction }
  | { phase: "expired" };

type Step = "load" | "request" | "download";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Archives are kept 7 days; each download link works for 5 minutes. */
const KEEP_DAYS = 7;
const LINK_MINUTES = 5;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getResponseStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as Record<string, unknown>;
  const resp = e["response"];
  if (typeof resp !== "object" || resp === null) return undefined;
  const status = (resp as Record<string, unknown>)["status"];
  return typeof status === "number" ? status : undefined;
}

function isNetworkError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  return "isAxiosError" in err && getResponseStatus(err) === undefined;
}

function isInFuture(iso: string | null | undefined): iso is string {
  return typeof iso === "string" && new Date(iso).getTime() > Date.now();
}

/** The X-Request-Id this app sent with the failed request, if any. */
function sentRequestId(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const headers = (err as { config?: { headers?: unknown } }).config?.headers;
  if (typeof headers !== "object" || headers === null) return null;
  for (const [key, value] of Object.entries(
    headers as Record<string, unknown>,
  )) {
    if (
      key.toLowerCase() === REQUEST_ID_HEADER.toLowerCase() &&
      typeof value === "string" &&
      value
    ) {
      return value;
    }
  }
  return null;
}

/**
 * A support reference that can be searched (B-327-4): the server's request id
 * when it answered, else the X-Request-Id this app sent (the server logs it
 * under that id), else the reference of a malformed answer, else a fresh
 * local one. The same value goes on screen and into the Sentry event.
 */
function supportReference(err: unknown): string {
  if (err instanceof DataExportResponseError) return err.reference;
  return extractRequestId(err) ?? sentRequestId(err) ?? newRequestId();
}

/**
 * What Sentry may see of a failure: the stable codes and the reference, never
 * the raw error (a Linking rejection quotes the download URL, B-327-6).
 */
function safeReport(
  err: unknown,
  step: Step | "open_browser",
  reference: string,
  extra: Record<string, unknown> = {},
): void {
  const name = err instanceof Error ? err.name : typeof err;
  const report = new Error(`data export ${step} failed (${name})`);
  report.name = "DataExportFailure";
  captureError(report, {
    screen: "DataExportScreen",
    step,
    support_reference: reference,
    status: getResponseStatus(err) ?? null,
    code:
      err instanceof DataExportResponseError
        ? err.code
        : dataExportErrorCode(err),
    ...(err instanceof DataExportResponseError
      ? { endpoint: err.endpoint, problem: err.problem }
      : {}),
    ...extra,
  });
}

const NEXT_STEP: Record<Step, string> = {
  load: "tap Check again",
  request: "tap Request my data again",
  download: "tap Download file again",
};

/**
 * Turn any failure into plain words: what happened and the next step that
 * works. Unknown failures carry a searchable reference and go to Sentry
 * under the same reference.
 */
function describeError(err: unknown, step: Step): Notice {
  const status = getResponseStatus(err);
  const code = dataExportErrorCode(err);
  if (isNetworkError(err)) {
    return {
      title: "You appear to be offline",
      message: `We could not reach The Growth Project. Check your connection, then ${NEXT_STEP[step]}.`,
      reference: null,
    };
  }
  if (status === 401) {
    return {
      title: "Your session has ended",
      message:
        "Log in again, then come back to Settings and open Request my data. Your export is kept.",
      reference: extractRequestId(err),
    };
  }
  if (code === "DATA_EXPORT_STORAGE_UNAVAILABLE" || status === 503) {
    return {
      title:
        code === "DATA_EXPORT_STORAGE_UNAVAILABLE"
          ? "File storage is not responding"
          : "The service is busy right now",
      message: `Your data is safe. Wait a minute, then ${NEXT_STEP[step]}.`,
      reference: extractRequestId(err),
    };
  }
  if (status === 429) {
    return {
      title: "Too many attempts",
      message: `Wait a minute, then ${NEXT_STEP[step]}.`,
      reference: extractRequestId(err),
    };
  }
  const reference = supportReference(err);
  safeReport(err, step, reference);
  const verb =
    step === "load"
      ? "load your export"
      : step === "request"
        ? "start your export"
        : "prepare your download";
  const what =
    err instanceof DataExportResponseError || code === DATA_EXPORT_BAD_RESPONSE
      ? "The answer from our server was incomplete, so nothing was opened. "
      : "";
  const nextStep = NEXT_STEP[step];
  return {
    title: `We could not ${verb}`,
    message: `${what}${nextStep.charAt(0).toUpperCase()}${nextStep.slice(1)}. If it keeps happening, email ${SUPPORT_EMAIL} and quote reference ${reference}.`,
    reference,
  };
}

/** Screen state for a status record. */
function stateFor(
  record: DataExportRecord,
  notice: Notice | null = null,
): ScreenState {
  if (record.status === "READY") {
    return record.download_available
      ? { phase: "ready", record, downloading: false, notice }
      : { phase: "unavailable", record };
  }
  if (record.status === "EXPIRED") return { phase: "expired" };
  if (record.status === "FAILED") {
    return {
      phase: "failed",
      next: "request",
      notice: {
        title: "Your last export is not available",
        message: `It did not finish, or its file could not be kept. Nothing in your account changed. Tap Request my data to build a new one. If that does not work either, email ${SUPPORT_EMAIL}.`,
        reference: null,
      },
    };
  }
  return { phase: "polling", record };
}

/** No export on record (any more): start state with a plain note. */
const GONE_NOTICE: Notice = {
  title: "We could not find your export",
  message:
    "There is no export on record for your account now. Tap Request my data to start a new one.",
  reference: null,
};

/** Linking rejections that mean "no app can open this link" (iOS and Android wording). */
function isKnownLaunchFailure(err: unknown): boolean {
  const message = err instanceof Error ? err.message : "";
  return /unable to open url|could not open url|no activity found|cannot open url/i.test(
    message,
  );
}

// Poll interval: 5 seconds while PENDING or RUNNING
const POLL_INTERVAL_MS = 5000;
// Consecutive failed polls before the screen says so.
const POLL_FAILURES_BEFORE_NOTICE = 3;
// Longest single wait for the "request a new export" deadline (the timer is
// re-armed on every render, so long deadlines are reached in steps).
const MAX_DEADLINE_WAIT_MS = 6 * 60 * 60 * 1000;

// ─── Screen ───────────────────────────────────────────────────────────────────

/**
 * DataExportScreen — GDPR Article 20 data portability.
 *
 * Shows the user what data is included, lets them request an export, and
 * polls for completion. When ready, Download file asks the API for a fresh
 * 5-minute link bound to the signed-in user and opens it in the system
 * browser, which saves the JSON file. No file is stored inside the app.
 *
 * Session fence (B-327-2): every load, request, poll and download belongs to
 * the session that started it. Logout, login, any auth change or leaving the
 * screen retires that session; a late answer from a retired session is
 * dropped, and the browser is never opened for it.
 *
 * Note: per doctrine, no emoji, no confetti, no inline hex colours.
 * All colours come from useTheme().colors.
 */
export default function DataExportScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const user = useCurrentUser();

  const [state, setState] = useState<ScreenState>({ phase: "loading" });
  const [clock, setClock] = useState(0);

  // ── Session fence ─────────────────────────────────────────────────────────

  const mounted = useRef(true);
  const sessionEpoch = useRef(0);
  const userId = useRef<string | null>(null);
  userId.current = user?.id ?? null;
  const reload = useRef<(() => void) | null>(null);

  useEffect(() => {
    mounted.current = true;
    const retire = () => {
      sessionEpoch.current += 1;
    };
    const onLogout = () => {
      retire();
      // Nothing of the signed-out account stays on screen.
      if (mounted.current) setState({ phase: "loading" });
    };
    const onLogin = () => {
      retire();
      reload.current?.();
    };
    const offChange = authEvents.onAuthChange(retire);
    authEvents.on("logout", onLogout);
    authEvents.on("login", onLogin);
    return () => {
      mounted.current = false;
      retire();
      offChange();
      authEvents.off("logout", onLogout);
      authEvents.off("login", onLogin);
    };
  }, []);

  /** Capture the current session; `live()` is false once it is retired. */
  const begin = useCallback(() => {
    const epoch = sessionEpoch.current;
    const owner = userId.current;
    return {
      live: () =>
        mounted.current &&
        epoch === sessionEpoch.current &&
        (owner === null || userId.current === owner),
    };
  }, []);

  // The signed-in identity changing under the screen also retires the session.
  const lastUser = useRef<string | null>(null);
  useEffect(() => {
    const id = user?.id ?? null;
    if (lastUser.current !== null && id !== lastUser.current)
      sessionEpoch.current += 1;
    lastUser.current = id;
  }, [user?.id]);

  // ── Load existing export status ───────────────────────────────────────────

  const loadStatus = useCallback(
    async (notice: Notice | null = null) => {
      const op = begin();
      try {
        const record = await dataExportApi.getStatus();
        if (!op.live()) return;
        setState(record ? stateFor(record, notice) : { phase: "idle", notice });
      } catch (err: unknown) {
        if (!op.live()) return;
        if (getResponseStatus(err) === 404) {
          setState({ phase: "idle", notice });
        } else {
          setState({
            phase: "failed",
            next: "reload",
            notice: describeError(err, "load"),
          });
        }
      }
    },
    [begin],
  );

  useEffect(() => {
    reload.current = () => void loadStatus();
    void loadStatus();
  }, [loadStatus]);

  // ── Polling while PENDING / RUNNING (B-327-5) ─────────────────────────────
  // One request at a time: the next poll is scheduled only after the previous
  // one settled, and every result is fenced by this effect's generation, so a
  // slow older answer can never overwrite a newer state.

  useEffect(() => {
    if (state.phase !== "polling") return;
    const op = begin();
    let active = true;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const current = () => active && op.live();

    const tick = async () => {
      try {
        const record = await dataExportApi.getStatus();
        if (!current()) return;
        failures = 0;
        if (!record) {
          // The export is gone (erased, or never stored): stop, start over.
          active = false;
          setState({ phase: "idle", notice: GONE_NOTICE });
          return;
        }
        if (record.status !== "PENDING" && record.status !== "RUNNING") {
          active = false;
          setState(stateFor(record));
          return;
        }
      } catch (err: unknown) {
        if (!current()) return;
        failures += 1;
        if (failures >= POLL_FAILURES_BEFORE_NOTICE) {
          active = false;
          setState({
            phase: "failed",
            next: "reload",
            notice: describeError(err, "load"),
          });
          return;
        }
      }
      if (current()) timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
    };

    timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [state.phase, begin]);

  // ── Replacement deadline (C-327-1) ────────────────────────────────────────
  // Re-render when next_request_at passes, and when the app comes back to
  // the foreground, so "Request a new export" appears on time. The backend
  // limit stays authoritative.

  const deadline =
    state.phase === "ready" ? (state.record.next_request_at ?? null) : null;
  useEffect(() => {
    if (!deadline) return;
    const wait = new Date(deadline).getTime() - Date.now();
    if (!Number.isFinite(wait) || wait <= 0) return;
    const timer = setTimeout(
      () => setClock((n) => n + 1),
      Math.min(wait + 250, MAX_DEADLINE_WAIT_MS),
    );
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") setClock((n) => n + 1);
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [deadline, clock]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleRequest = useCallback(async () => {
    const op = begin();
    setState({ phase: "requesting" });
    try {
      const record = await dataExportApi.requestExport();
      if (!op.live()) return;
      setState({ phase: "polling", record });
    } catch (err: unknown) {
      if (!op.live()) return;
      const code = dataExportErrorCode(err);
      if (code === "DATA_EXPORT_RATE_LIMITED") {
        await loadStatus({
          title: "You already have a recent export",
          message:
            "Exports can be requested once every 24 hours. Download the one below, or request a new one when the time shown has passed.",
          reference: null,
        });
        return;
      }
      if (
        code === "DATA_EXPORT_IN_PROGRESS" ||
        code === "EXPORT_ALREADY_IN_PROGRESS" ||
        (getResponseStatus(err) === 409 && code === null)
      ) {
        // One is already being built: show its progress.
        await loadStatus();
        return;
      }
      setState({
        phase: "failed",
        next: "request",
        notice: describeError(err, "request"),
      });
    }
  }, [begin, loadStatus]);

  const openInBrowser = useCallback(
    async (
      record: DataExportRecord,
      path: string,
      op: { live: () => boolean },
    ) => {
      // Last check before an external side effect: the session that asked
      // for this link must still be the one on screen (B-327-2).
      if (!op.live() || !path.startsWith(DOWNLOAD_ROUTE)) return;
      try {
        await Linking.openURL(`${env.API_URL}${path}`);
        if (!op.live()) return;
        setState({
          phase: "ready",
          record,
          downloading: false,
          notice: {
            title: "Download started in your browser",
            message: `If nothing downloads, come back and tap Download file again. Each link works for ${LINK_MINUTES} minutes.`,
            reference: null,
          },
        });
      } catch (err: unknown) {
        if (!op.live()) return;
        const reference = newRequestId();
        const known = isKnownLaunchFailure(err);
        // Never the raw rejection: it quotes the URL and its token (B-327-6).
        safeReport(err, "open_browser", reference, {
          known_launch_failure: known,
        });
        setState({
          phase: "ready",
          record,
          downloading: false,
          notice: known
            ? {
                title: "Your phone could not open the download",
                message:
                  "Check that a web browser is installed and allowed to open links, then tap Download file again.",
                reference,
              }
            : {
                title: "We could not open your download",
                message: `Tap Download file again. If it keeps happening, email ${SUPPORT_EMAIL} and quote reference ${reference}.`,
                reference,
              },
        });
      }
    },
    [],
  );

  const handleDownload = useCallback(
    async (record: DataExportRecord) => {
      const op = begin();
      setState({ phase: "ready", record, downloading: true, notice: null });
      let path: string;
      try {
        const link = await dataExportApi.createDownloadLink();
        path = link.download_path;
      } catch (err: unknown) {
        if (!op.live()) return;
        const code = dataExportErrorCode(err);
        if (
          getResponseStatus(err) === 404 &&
          code === null &&
          record.download_token
        ) {
          // A backend without /download-link (route 404, no code): use the
          // short-lived token from the status response.
          await openInBrowser(
            record,
            legacyDownloadPath(record.download_token),
            op,
          );
          return;
        }
        if (code === "DATA_EXPORT_EXPIRED") {
          setState({ phase: "expired" });
          return;
        }
        if (code === "DATA_EXPORT_FILE_MISSING") {
          setState({ phase: "unavailable", record });
          return;
        }
        if (
          code === "DATA_EXPORT_NOT_READY" ||
          code === "DATA_EXPORT_NOT_FOUND"
        ) {
          await loadStatus();
          return;
        }
        setState({
          phase: "ready",
          record,
          downloading: false,
          notice: describeError(err, "download"),
        });
        return;
      }
      await openInBrowser(record, path, op);
    },
    [begin, loadStatus, openInBrowser],
  );

  const handleReload = useCallback(async () => {
    setState({ phase: "loading" });
    await loadStatus();
  }, [loadStatus]);

  const handleReset = useCallback(() => {
    setState({ phase: "idle" });
  }, []);

  const renderNotice = (notice: Notice | null | undefined) =>
    notice ? (
      <View style={styles.noticeBox} accessibilityRole="alert">
        <Text style={styles.noticeTitle}>{notice.title}</Text>
        <Text style={styles.statusBody}>{notice.message}</Text>
        {notice.reference ? (
          <Text style={styles.caption} selectable>
            Reference: {notice.reference}
          </Text>
        ) : null}
      </View>
    ) : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      accessibilityLabel="Data export screen"
    >
      <Text style={styles.heading}>Request my data</Text>

      <Text style={styles.body}>
        Under UK/EU data protection law (GDPR Article 20), you have the right to
        receive a complete copy of all the personal data The Growth Project
        holds about you. Your export will include:
      </Text>

      <View style={styles.listContainer}>
        {INCLUDED_DATA.map((item) => (
          <View key={item} style={styles.listRow}>
            <View style={styles.bullet} />
            <Text style={styles.listText}>{item}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.caption}>
        The file is in JSON format and can be opened in any text editor or
        imported into compatible tools. We keep it for {KEEP_DAYS} days after it
        is ready. Each tap on Download file makes a private link that works for{" "}
        {LINK_MINUTES} minutes and only for you.
      </Text>

      {/* ── State-specific UI ── */}

      {state.phase === "loading" && <SkeletonList count={4} />}

      {state.phase === "idle" && (
        <>
          {renderNotice(state.notice)}
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleRequest}
            accessibilityLabel="Request my data export"
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>Request my data</Text>
          </TouchableOpacity>
        </>
      )}

      {state.phase === "requesting" && (
        <View style={styles.statusRow}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.statusText}>Sending request...</Text>
        </View>
      )}

      {state.phase === "polling" && (
        <View style={styles.statusCard}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.statusHeading}>Export in progress</Text>
          <Text style={styles.statusBody}>
            We are assembling your file. This usually takes under 60 seconds.
            Your export will be available to download from this screen when it
            is ready. This screen updates automatically, and you can leave it
            and come back.
          </Text>
          <Text style={styles.caption}>
            Requested {formatDate(state.record.created_at)}
          </Text>
        </View>
      )}

      {state.phase === "ready" && (
        <View style={styles.statusCard}>
          <Text style={styles.statusHeading}>Your file is ready</Text>
          <Text style={styles.statusBody}>
            Your data export is ready to download.
            {state.record.file_size_bytes
              ? ` File size: ${formatFileSize(state.record.file_size_bytes)}.`
              : ""}
            {state.record.expires_at
              ? ` Available until ${formatDate(state.record.expires_at)}.`
              : ""}
          </Text>
          {renderNotice(state.notice)}
          <TouchableOpacity
            style={[
              styles.primaryButton,
              state.downloading && styles.buttonBusy,
            ]}
            onPress={() => handleDownload(state.record)}
            disabled={state.downloading}
            accessibilityLabel="Download your data file"
            accessibilityRole="button"
            accessibilityState={{
              disabled: state.downloading,
              busy: state.downloading,
            }}
          >
            {state.downloading ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <Text style={styles.primaryButtonText}>Download file</Text>
            )}
          </TouchableOpacity>
          <Text style={styles.caption}>
            The download opens in your browser, which saves the file. The file
            is not stored inside the app.
          </Text>
          {isInFuture(state.record.next_request_at) ? (
            <Text style={styles.caption}>
              You can request a new export after{" "}
              {formatDateTime(state.record.next_request_at)}.
            </Text>
          ) : (
            <TouchableOpacity
              style={styles.ghostButton}
              onPress={handleRequest}
              accessibilityLabel="Request a new data export"
              accessibilityRole="button"
            >
              <Text style={styles.ghostButtonText}>Request a new export</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {state.phase === "unavailable" && (
        <View style={styles.statusCard}>
          <Text style={styles.statusHeading}>
            This file is no longer available
          </Text>
          <Text style={styles.statusBody}>
            The file for your last export is gone, so it cannot be downloaded.
            Your data is unchanged. Request a new export and it will be ready
            here in about a minute.
          </Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleRequest}
            accessibilityLabel="Request a new data export"
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>Request a new export</Text>
          </TouchableOpacity>
        </View>
      )}

      {state.phase === "failed" && (
        <View style={styles.statusCard}>
          <Text style={styles.errorHeading}>{state.notice.title}</Text>
          <Text style={styles.statusBody}>{state.notice.message}</Text>
          {state.notice.reference ? (
            <Text style={styles.caption} selectable>
              Reference: {state.notice.reference}
            </Text>
          ) : null}
          {state.next === "reload" ? (
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleReload}
              accessibilityLabel="Check your export status again"
              accessibilityRole="button"
            >
              <Text style={styles.primaryButtonText}>Check again</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleRequest}
              accessibilityLabel="Request my data again"
              accessibilityRole="button"
            >
              <Text style={styles.primaryButtonText}>Request my data</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.ghostButton}
            onPress={handleReset}
            accessibilityLabel="Go back to the start"
            accessibilityRole="button"
          >
            <Text style={styles.ghostButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {state.phase === "expired" && (
        <View style={styles.statusCard}>
          <Text style={styles.statusHeading}>Previous export expired</Text>
          <Text style={styles.statusBody}>
            Your last export has expired (files are kept for {KEEP_DAYS} days).
            You can request a fresh export below.
          </Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleRequest}
            accessibilityLabel="Request a fresh data export"
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>Request new export</Text>
          </TouchableOpacity>
        </View>
      )}

      <Text style={styles.legalNote}>
        If you plan to delete your account, download your data first. Once
        deletion is confirmed your data cannot be recovered.
      </Text>
    </ScrollView>
  );
}

// ─── What's included ──────────────────────────────────────────────────────────

const INCLUDED_DATA = [
  "Profile and account details",
  "Weight, food, and water logs",
  "Workout sessions",
  "Fasting windows",
  "Habits and habit completions",
  "Check-ins (morning and evening)",
  "Meal plans",
  "Coaching messages you sent",
  "Build Week progress",
  "Lesson completions",
  "Diagnostic submission results",
  "Notification preferences",
  "Community wins you posted",
  "All previous export requests",
  "Audit log entries about your account",
];

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ReturnType<typeof useTheme>["colors"]) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: 24,
      paddingBottom: 48,
    },
    heading: {
      fontFamily: "CormorantGaramond_600SemiBold",
      fontSize: 28,
      color: colors.textPrimary,
      marginBottom: 16,
    },
    body: {
      fontFamily: "Inter_400Regular",
      fontSize: 15,
      lineHeight: 22,
      color: colors.textPrimary,
      marginBottom: 16,
    },
    caption: {
      fontFamily: "Inter_400Regular",
      fontSize: 13,
      lineHeight: 19,
      color: colors.textPrimary,
      opacity: 0.6,
      marginTop: 8,
    },
    listContainer: {
      marginBottom: 16,
    },
    listRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      marginBottom: 8,
    },
    bullet: {
      width: 4,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.textPrimary,
      marginTop: 9,
      marginRight: 10,
      flexShrink: 0,
    },
    listText: {
      fontFamily: "Inter_400Regular",
      fontSize: 15,
      lineHeight: 22,
      color: colors.textPrimary,
      flex: 1,
    },
    spinner: {
      marginTop: 32,
    },
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginTop: 24,
    },
    statusText: {
      fontFamily: "Inter_400Regular",
      fontSize: 15,
      color: colors.textPrimary,
    },
    statusCard: {
      marginTop: 24,
      padding: 20,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      gap: 12,
    },
    statusHeading: {
      fontFamily: "CormorantGaramond_600SemiBold",
      fontSize: 20,
      color: colors.textPrimary,
    },
    errorHeading: {
      fontFamily: "CormorantGaramond_600SemiBold",
      fontSize: 20,
      color: colors.error,
    },
    statusBody: {
      fontFamily: "Inter_400Regular",
      fontSize: 15,
      lineHeight: 22,
      color: colors.textPrimary,
    },
    primaryButton: {
      backgroundColor: colors.primary,
      paddingVertical: 14,
      paddingHorizontal: 24,
      borderRadius: 8,
      alignItems: "center",
      marginTop: 8,
    },
    primaryButtonText: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 15,
      color: colors.background,
    },
    buttonBusy: {
      opacity: 0.7,
    },
    noticeBox: {
      borderLeftWidth: 3,
      borderLeftColor: colors.border,
      paddingLeft: 12,
      gap: 4,
    },
    noticeTitle: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 15,
      color: colors.textPrimary,
    },
    ghostButton: {
      paddingVertical: 12,
      paddingHorizontal: 24,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
    },
    ghostButtonText: {
      fontFamily: "Inter_400Regular",
      fontSize: 15,
      color: colors.textPrimary,
    },
    legalNote: {
      fontFamily: "Inter_400Regular",
      fontSize: 13,
      lineHeight: 19,
      color: colors.textPrimary,
      opacity: 0.5,
      marginTop: 32,
      textAlign: "center",
    },
  });
}
