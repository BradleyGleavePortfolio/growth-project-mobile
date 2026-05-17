import React, { useCallback, useEffect, useState } from 'react';
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
import { dataExportApi, DataExportRecord } from '../../services/dataExportApi';
import { env } from '../../config/env';

// ─── Screen state ─────────────────────────────────────────────────────────────

type ScreenState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'requesting' }
  | { phase: 'polling'; record: DataExportRecord }
  | { phase: 'ready'; record: DataExportRecord }
  | { phase: 'failed'; error: string }
  | { phase: 'expired' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function getResponseStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as Record<string, unknown>;
  const resp = e['response'];
  if (typeof resp !== 'object' || resp === null) return undefined;
  const status = (resp as Record<string, unknown>)['status'];
  return typeof status === 'number' ? status : undefined;
}

// Poll interval: 5 seconds while PENDING or RUNNING
const POLL_INTERVAL_MS = 5000;

// ─── Screen ───────────────────────────────────────────────────────────────────

/**
 * DataExportScreen — GDPR Article 20 data portability.
 *
 * Shows the user what data is included, lets them request an export, and
 * polls for completion. When ready, a button opens the signed download URL
 * in the external browser. No files are streamed through the app.
 *
 * Note: per doctrine, no emoji, no confetti, no inline hex colours.
 * All colours come from useTheme().colors.
 */
export default function DataExportScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [state, setState] = useState<ScreenState>({ phase: 'loading' });

  // ── Load existing export status on mount ──────────────────────────────────

  const loadStatus = useCallback(async () => {
    try {
      const record = await dataExportApi.getStatus();
      if (!record) {
        setState({ phase: 'idle' });
        return;
      }
      if (record.status === 'READY') {
        setState({ phase: 'ready', record });
      } else if (record.status === 'EXPIRED') {
        setState({ phase: 'expired' });
      } else if (record.status === 'FAILED') {
        setState({ phase: 'failed', error: 'The last export attempt failed. You can request a new one.' });
      } else {
        // PENDING or RUNNING — start polling
        setState({ phase: 'polling', record });
      }
    } catch (err: unknown) {
      if (getResponseStatus(err) === 404) {
        // No export has been requested yet
        setState({ phase: 'idle' });
      } else {
        setState({ phase: 'failed', error: 'Could not load export status. Please try again.' });
      }
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // ── Polling while PENDING / RUNNING ───────────────────────────────────────

  useEffect(() => {
    if (state.phase !== 'polling') return;

    const interval = setInterval(async () => {
      try {
        const record = await dataExportApi.getStatus();
        if (!record) return;

        if (record.status === 'READY') {
          clearInterval(interval);
          setState({ phase: 'ready', record });
        } else if (record.status === 'FAILED') {
          clearInterval(interval);
          setState({ phase: 'failed', error: 'The export failed. Please try requesting again.' });
        } else if (record.status === 'EXPIRED') {
          clearInterval(interval);
          setState({ phase: 'expired' });
        }
        // Still PENDING / RUNNING — keep polling
      } catch {
        // Transient error — keep polling
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
      if (getResponseStatus(err) === 409) {
        setState({
          phase: 'failed',
          error: 'An export is already in progress. Check back shortly.',
        });
      } else {
        setState({
          phase: 'failed',
          error: 'Could not start export. Please try again in a moment.',
        });
      }
    }
  }, []);

  const handleDownload = useCallback(async (record: DataExportRecord) => {
    if (!record.download_token) return;
    const url = `${env.API_URL}/v1/me/data-export/download?token=${record.download_token}`;
    await Linking.openURL(url);
  }, []);

  const handleReset = useCallback(() => {
    setState({ phase: 'idle' });
  }, []);

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
        imported into compatible tools. The download link is valid for 7 days.
      </Text>

      {/* ── State-specific UI ── */}

      {state.phase === 'loading' && (
        <SkeletonList count={4} />
      )}

      {state.phase === 'idle' && (
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={handleRequest}
          accessibilityLabel="Request my data export"
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>Request my data</Text>
        </TouchableOpacity>
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
            You will receive an email when it is ready. You can also keep this
            screen open and it will update automatically.
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
              ? ` This link expires on ${formatDate(state.record.expires_at)}.`
              : ''}
          </Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => handleDownload(state.record)}
            accessibilityLabel="Download your data file"
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>Download file</Text>
          </TouchableOpacity>
          <Text style={styles.caption}>
            The download opens in your browser. The file is not stored inside
            the app.
          </Text>
          <TouchableOpacity
            style={styles.ghostButton}
            onPress={handleRequest}
            accessibilityLabel="Request a new data export"
            accessibilityRole="button"
          >
            <Text style={styles.ghostButtonText}>Request a new export</Text>
          </TouchableOpacity>
        </View>
      )}

      {state.phase === 'failed' && (
        <View style={styles.statusCard}>
          <Text style={styles.errorHeading}>Export unavailable</Text>
          <Text style={styles.statusBody}>{state.error}</Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleRequest}
            accessibilityLabel="Try requesting your data again"
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>Try again</Text>
          </TouchableOpacity>
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
            Your last export link has expired (download links last 7 days).
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
