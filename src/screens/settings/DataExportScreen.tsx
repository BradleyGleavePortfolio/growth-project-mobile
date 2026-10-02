import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SkeletonList } from '../../ui/skeletons/Skeleton';
import { useTheme } from '../../theme/useTheme';
import {
  dataExportApi,
  dataExportErrorCode,
  DataExportRecord,
} from '../../services/dataExportApi';
import { env } from '../../config/env';
import { extractRequestId } from '../../utils/correlation';
import { captureError } from '../../services/sentry';

// ─── Screen state ─────────────────────────────────────────────────────────────

/** What happened, what to do next, and a support reference when we have one. */
interface Notice {
  title: string;
  message: string;
  reference: string | null;
}

type NextAction = 'request' | 'reload';

type ScreenState =
  | { phase: 'idle'; notice?: Notice | null }
  | { phase: 'loading' }
  | { phase: 'requesting' }
  | { phase: 'polling'; record: DataExportRecord }
  | { phase: 'ready'; record: DataExportRecord; downloading: boolean; notice: Notice | null }
  | { phase: 'unavailable'; record: DataExportRecord }
  | { phase: 'failed'; notice: Notice; next: NextAction }
  | { phase: 'expired' };

type Step = 'load' | 'request' | 'download';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SUPPORT_EMAIL = 'hello@thegrowthproject.app';

/** Archives are kept 7 days; each download link works for 5 minutes. */
const KEEP_DAYS = 7;
const LINK_MINUTES = 5;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getResponseStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as Record<string, unknown>;
  const resp = e['response'];
  if (typeof resp !== 'object' || resp === null) return undefined;
  const status = (resp as Record<string, unknown>)['status'];
  return typeof status === 'number' ? status : undefined;
}

function isNetworkError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  return 'isAxiosError' in err && getResponseStatus(err) === undefined;
}

function isInFuture(iso: string | null | undefined): iso is string {
  return typeof iso === 'string' && new Date(iso).getTime() > Date.now();
}

const NEXT_STEP: Record<Step, string> = {
  load: 'tap Check again',
  request: 'tap Request my data again',
  download: 'tap Download file again',
};

/**
 * Turn any failure into plain words: what happened and the next step that
 * works. Unknown failures carry the server's request reference and go to
 * Sentry so support can find them.
 */
function describeError(err: unknown, step: Step): Notice {
  const status = getResponseStatus(err);
  const code = dataExportErrorCode(err);
  const reference = extractRequestId(err);
  if (isNetworkError(err)) {
    return {
      title: 'You appear to be offline',
      message: `We could not reach The Growth Project. Check your connection, then ${NEXT_STEP[step]}.`,
      reference: null,
    };
  }
  if (status === 401) {
    return {
      title: 'Your session has ended',
      message:
        'Log in again, then come back to Settings and open Request my data. Your export is kept.',
      reference,
    };
  }
  if (code === 'DATA_EXPORT_STORAGE_UNAVAILABLE' || status === 503) {
    return {
      title:
        code === 'DATA_EXPORT_STORAGE_UNAVAILABLE'
          ? 'File storage is not responding'
          : 'The service is busy right now',
      message: `Your data is safe. Wait a minute, then ${NEXT_STEP[step]}.`,
      reference,
    };
  }
  if (status === 429) {
    return {
      title: 'Too many attempts',
      message: `Wait a minute, then ${NEXT_STEP[step]}.`,
      reference,
    };
  }
  captureError(err, { screen: 'DataExportScreen', step, status, code, request_id: reference });
  const verb =
    step === 'load' ? 'load your export' : step === 'request' ? 'start your export' : 'prepare your download';
  const contact = reference
    ? `If it keeps happening, email ${SUPPORT_EMAIL} and quote reference ${reference}.`
    : `If it keeps happening, email ${SUPPORT_EMAIL} and tell us the time it happened.`;
  const nextStep = NEXT_STEP[step];
  return {
    title: `We could not ${verb}`,
    message: `${nextStep.charAt(0).toUpperCase()}${nextStep.slice(1)}. ${contact}`,
    reference,
  };
}

/** Screen state for a status record. */
function stateFor(record: DataExportRecord, notice: Notice | null = null): ScreenState {
  if (record.status === 'READY') {
    return record.download_available
      ? { phase: 'ready', record, downloading: false, notice }
      : { phase: 'unavailable', record };
  }
  if (record.status === 'EXPIRED') return { phase: 'expired' };
  if (record.status === 'FAILED') {
    return {
      phase: 'failed',
      next: 'request',
      notice: {
        title: 'Your last export did not finish',
        message: `Nothing was lost. Tap Request my data to build a new one. If it fails again, email ${SUPPORT_EMAIL}.`,
        reference: null,
      },
    };
  }
  return { phase: 'polling', record };
}

// Poll interval: 5 seconds while PENDING or RUNNING
const POLL_INTERVAL_MS = 5000;
// Consecutive failed polls before the screen says so.
const POLL_FAILURES_BEFORE_NOTICE = 3;

// ─── Screen ───────────────────────────────────────────────────────────────────

/**
 * DataExportScreen — GDPR Article 20 data portability.
 *
 * Shows the user what data is included, lets them request an export, and
 * polls for completion. When ready, Download file asks the API for a fresh
 * 5-minute link bound to the signed-in user and opens it in the system
 * browser, which saves the JSON file. No file is stored inside the app.
 *
 * Note: per doctrine, no emoji, no confetti, no inline hex colours.
 * All colours come from useTheme().colors.
 */
export default function DataExportScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [state, setState] = useState<ScreenState>({ phase: 'loading' });
  const pollFailures = useRef(0);

  // ── Load existing export status ───────────────────────────────────────────

  const loadStatus = useCallback(async (notice: Notice | null = null) => {
    try {
      const record = await dataExportApi.getStatus();
      setState(record ? stateFor(record, notice) : { phase: 'idle', notice });
    } catch (err: unknown) {
      if (getResponseStatus(err) === 404) {
        setState({ phase: 'idle', notice });
      } else {
        setState({ phase: 'failed', next: 'reload', notice: describeError(err, 'load') });
      }
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // ── Polling while PENDING / RUNNING ───────────────────────────────────────

  useEffect(() => {
    if (state.phase !== 'polling') return;
    pollFailures.current = 0;

    const interval = setInterval(async () => {
      try {
        const record = await dataExportApi.getStatus();
        pollFailures.current = 0;
        if (!record) return;
        if (record.status !== 'PENDING' && record.status !== 'RUNNING') {
          clearInterval(interval);
          setState(stateFor(record));
        }
        // Still PENDING / RUNNING — keep polling
      } catch (err: unknown) {
        pollFailures.current += 1;
        if (pollFailures.current >= POLL_FAILURES_BEFORE_NOTICE) {
          clearInterval(interval);
          setState({ phase: 'failed', next: 'reload', notice: describeError(err, 'load') });
        }
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [state.phase]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleRequest = useCallback(async () => {
    setState({ phase: 'requesting' });
    try {
      const record = await dataExportApi.requestExport();
      setState({ phase: 'polling', record });
    } catch (err: unknown) {
      const code = dataExportErrorCode(err);
      if (code === 'DATA_EXPORT_RATE_LIMITED') {
        await loadStatus({
          title: 'You already have a recent export',
          message:
            'Exports can be requested once every 24 hours. Download the one below, or request a new one when the time shown has passed.',
          reference: null,
        });
        return;
      }
      if (
        code === 'DATA_EXPORT_IN_PROGRESS' ||
        code === 'EXPORT_ALREADY_IN_PROGRESS' ||
        (getResponseStatus(err) === 409 && code === null)
      ) {
        // One is already being built: show its progress.
        await loadStatus();
        return;
      }
      setState({ phase: 'failed', next: 'request', notice: describeError(err, 'request') });
    }
  }, [loadStatus]);

  const openInBrowser = useCallback(async (record: DataExportRecord, url: string) => {
    try {
      await Linking.openURL(url);
      setState({
        phase: 'ready',
        record,
        downloading: false,
        notice: {
          title: 'Download started in your browser',
          message: `If nothing downloads, come back and tap Download file again. Each link works for ${LINK_MINUTES} minutes.`,
          reference: null,
        },
      });
    } catch (err: unknown) {
      captureError(err, { screen: 'DataExportScreen', step: 'open_browser' });
      setState({
        phase: 'ready',
        record,
        downloading: false,
        notice: {
          title: 'Your phone could not open the download',
          message:
            'Check that a web browser is installed and allowed to open links, then tap Download file again.',
          reference: null,
        },
      });
    }
  }, []);

  const handleDownload = useCallback(
    async (record: DataExportRecord) => {
      setState({ phase: 'ready', record, downloading: true, notice: null });
      let url: string;
      try {
        const link = await dataExportApi.createDownloadLink();
        url = `${env.API_URL}${link.download_path}`;
      } catch (err: unknown) {
        const code = dataExportErrorCode(err);
        if (getResponseStatus(err) === 404 && code === null && record.download_token) {
          // A backend without /download-link (route 404, no code): use the
          // short-lived token from the status response.
          url = `${env.API_URL}/v1/me/data-export/download?token=${encodeURIComponent(record.download_token)}`;
          await openInBrowser(record, url);
          return;
        }
        if (code === 'DATA_EXPORT_EXPIRED') {
          setState({ phase: 'expired' });
          return;
        }
        if (code === 'DATA_EXPORT_FILE_MISSING') {
          setState({ phase: 'unavailable', record });
          return;
        }
        if (code === 'DATA_EXPORT_NOT_READY' || code === 'DATA_EXPORT_NOT_FOUND') {
          await loadStatus();
          return;
        }
        setState({ phase: 'ready', record, downloading: false, notice: describeError(err, 'download') });
        return;
      }
      await openInBrowser(record, url);
    },
    [loadStatus, openInBrowser],
  );

  const handleReload = useCallback(async () => {
    setState({ phase: 'loading' });
    await loadStatus();
  }, [loadStatus]);

  const handleReset = useCallback(() => {
    setState({ phase: 'idle' });
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
        receive a complete copy of all the personal data The Growth Project holds
        about you. Your export will include:
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
        is ready. Each tap on Download file makes a private link that works for{' '}
        {LINK_MINUTES} minutes and only for you.
      </Text>

      {/* ── State-specific UI ── */}

      {state.phase === 'loading' && (
        <SkeletonList count={4} />
      )}

      {state.phase === 'idle' && (
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

      {state.phase === 'requesting' && (
        <View style={styles.statusRow}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.statusText}>Sending request...</Text>
        </View>
      )}

      {state.phase === 'polling' && (
        <View style={styles.statusCard}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.statusHeading}>Export in progress</Text>
          <Text style={styles.statusBody}>
            We are assembling your file. This usually takes under 60 seconds.
            Your export will be available to download from this screen when it
            is ready. This screen updates automatically, and you can leave it and
            come back.
          </Text>
          <Text style={styles.caption}>
            Requested {formatDate(state.record.created_at)}
          </Text>
        </View>
      )}

      {state.phase === 'ready' && (
        <View style={styles.statusCard}>
          <Text style={styles.statusHeading}>Your file is ready</Text>
          <Text style={styles.statusBody}>
            Your data export is ready to download.
            {state.record.file_size_bytes
              ? ` File size: ${formatFileSize(state.record.file_size_bytes)}.`
              : ''}
            {state.record.expires_at
              ? ` Available until ${formatDate(state.record.expires_at)}.`
              : ''}
          </Text>
          {renderNotice(state.notice)}
          <TouchableOpacity
            style={[styles.primaryButton, state.downloading && styles.buttonBusy]}
            onPress={() => handleDownload(state.record)}
            disabled={state.downloading}
            accessibilityLabel="Download your data file"
            accessibilityRole="button"
            accessibilityState={{ disabled: state.downloading, busy: state.downloading }}
          >
            {state.downloading ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <Text style={styles.primaryButtonText}>Download file</Text>
            )}
          </TouchableOpacity>
          <Text style={styles.caption}>
            The download opens in your browser, which saves the file. The file is
            not stored inside the app.
          </Text>
          {isInFuture(state.record.next_request_at) ? (
            <Text style={styles.caption}>
              You can request a new export after{' '}
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

      {state.phase === 'unavailable' && (
        <View style={styles.statusCard}>
          <Text style={styles.statusHeading}>This file is no longer available</Text>
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

      {state.phase === 'failed' && (
        <View style={styles.statusCard}>
          <Text style={styles.errorHeading}>{state.notice.title}</Text>
          <Text style={styles.statusBody}>{state.notice.message}</Text>
          {state.notice.reference ? (
            <Text style={styles.caption} selectable>
              Reference: {state.notice.reference}
            </Text>
          ) : null}
          {state.next === 'reload' ? (
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

      {state.phase === 'expired' && (
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
  'Profile and account details',
  'Weight, food, and water logs',
  'Workout sessions',
  'Fasting windows',
  'Habits and habit completions',
  'Check-ins (morning and evening)',
  'Meal plans',
  'Coaching messages you sent',
  'Build Week progress',
  'Lesson completions',
  'Diagnostic submission results',
  'Notification preferences',
  'Community wins you posted',
  'All previous export requests',
  'Audit log entries about your account',
];

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ReturnType<typeof useTheme>['colors']) {
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
      fontFamily: 'CormorantGaramond_600SemiBold',
      fontSize: 28,
      color: colors.textPrimary,
      marginBottom: 16,
    },
    body: {
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      lineHeight: 22,
      color: colors.textPrimary,
      marginBottom: 16,
    },
    caption: {
      fontFamily: 'Inter_400Regular',
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
      flexDirection: 'row',
      alignItems: 'flex-start',
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
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      lineHeight: 22,
      color: colors.textPrimary,
      flex: 1,
    },
    spinner: {
      marginTop: 32,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginTop: 24,
    },
    statusText: {
      fontFamily: 'Inter_400Regular',
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
      fontFamily: 'CormorantGaramond_600SemiBold',
      fontSize: 20,
      color: colors.textPrimary,
    },
    errorHeading: {
      fontFamily: 'CormorantGaramond_600SemiBold',
      fontSize: 20,
      color: colors.error,
    },
    statusBody: {
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      lineHeight: 22,
      color: colors.textPrimary,
    },
    primaryButton: {
      backgroundColor: colors.primary,
      paddingVertical: 14,
      paddingHorizontal: 24,
      borderRadius: 8,
      alignItems: 'center',
      marginTop: 8,
    },
    primaryButtonText: {
      fontFamily: 'Inter_600SemiBold',
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
      fontFamily: 'Inter_600SemiBold',
      fontSize: 15,
      color: colors.textPrimary,
    },
    ghostButton: {
      paddingVertical: 12,
      paddingHorizontal: 24,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    ghostButtonText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      color: colors.textPrimary,
    },
    legalNote: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      lineHeight: 19,
      color: colors.textPrimary,
      opacity: 0.5,
      marginTop: 32,
      textAlign: 'center',
    },
  });
}
