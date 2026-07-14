/**
 * ImportDataScreen — coach-facing entry to the v0.3 site-agnostic import.
 *
 * Honest scope (this PR): intro → data-driven platform picker (incl.
 * Custom/Other) → safe external login-site open, with a clear explanation of
 * the browser-extension prerequisite. The live pairing-code mint/poll and the
 * import progress mirror are the chained follow-up (PR-M2). This screen NEVER
 * claims an import has started, progressed, or completed — it hands the coach
 * to their prior platform's login page and explains what happens next.
 *
 * Gated by featureFlags.extensionImport (default OFF). Mounts no network path.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import type { ThemeColors } from '../../theme/ThemeProvider';
import {
  IMPORT_PLATFORMS,
  CUSTOM_PLATFORM_ID,
  findImportPlatform,
} from '../../constants/importPlatforms';
import { safeImportLoginUrl } from '../../utils/safeImportLoginUrl';
import { track } from '../../analytics/posthog.service';
import { AnalyticsEvents } from '../../analytics/events';
import type { ImportFlowState } from '../../types/extensionImport';

export default function ImportDataScreen(): React.ReactElement {
  const { colors } = useTheme();
  const [state, setState] = useState<ImportFlowState>({ phase: 'intro' });
  const [customUrl, setCustomUrl] = useState('');

  React.useEffect(() => {
    track(AnalyticsEvents.IMPORT_ENTRY_OPENED);
  }, []);

  const openLogin = useCallback(async (platformId: string, rawUrl: string | null) => {
    const safe = safeImportLoginUrl(rawUrl);
    if (!safe) {
      setState({
        phase: 'failed',
        message:
          'That site link is not a valid, secure (https) web address. Check it and try again.',
      });
      track(AnalyticsEvents.IMPORT_LOGIN_OPEN_FAILED, { platform: platformId, reason: 'invalid_url' });
      return;
    }
    setState({ phase: 'openingLogin', platformId, loginUrl: safe });
    try {
      const supported = await Linking.canOpenURL(safe);
      if (!supported) throw new Error('unsupported');
      await Linking.openURL(safe);
      track(AnalyticsEvents.IMPORT_LOGIN_OPENED, { platform: platformId });
      setState({ phase: 'awaitingExtension', platformId });
    } catch {
      track(AnalyticsEvents.IMPORT_LOGIN_OPEN_FAILED, { platform: platformId, reason: 'open_failed' });
      setState({
        phase: 'failed',
        message: "We couldn't open that site in your browser. Please try again.",
      });
    }
  }, []);

  const selectPlatform = useCallback(
    (platformId: string) => {
      track(AnalyticsEvents.IMPORT_PLATFORM_SELECTED, { platform: platformId });
      if (platformId === CUSTOM_PLATFORM_ID) {
        setState({ phase: 'customUrlEntry', url: '', valid: false });
        return;
      }
      const platform = findImportPlatform(platformId);
      void openLogin(platformId, platform?.loginUrl ?? null);
    },
    [openLogin],
  );

  const onCustomUrlChange = useCallback((text: string) => {
    setCustomUrl(text);
    setState({ phase: 'customUrlEntry', url: text, valid: safeImportLoginUrl(text) != null });
  }, []);

  const styles = makeStyles(colors);
  const customValid = state.phase === 'customUrlEntry' && state.valid;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="import-data-screen">
      <Text style={styles.title} accessibilityRole="header">
        Import your coaching data
      </Text>
      <Text style={styles.body}>
        Bring your clients and history across from a platform you already use. Pick a
        service below to open its login page in your browser.
      </Text>

      <View style={styles.prereq} accessibilityRole="summary">
        <Ionicons name="information-circle-outline" size={18} color={colors.info} />
        <Text style={styles.prereqText}>
          You'll log in with your own account. The Growth Project browser extension then
          asks to start the import — we never see or store your other platform's password.
        </Text>
      </View>

      {(state.phase === 'failed' || state.phase === 'openingLogin') && (
        <View
          style={[styles.status, state.phase === 'failed' ? styles.statusError : styles.statusInfo]}
          accessibilityLiveRegion="polite"
          testID="import-status"
        >
          <Text style={styles.statusText}>
            {state.phase === 'failed' ? state.message : 'Opening the login page…'}
          </Text>
        </View>
      )}

      {state.phase === 'awaitingExtension' && (
        <View style={[styles.status, styles.statusInfo]} accessibilityLiveRegion="polite" testID="import-status">
          <Text style={styles.statusText}>
            Log in on the page we just opened. When you're in, the browser extension will
            prompt you to start the import. You can close this screen — nothing is imported
            until you confirm in the extension.
          </Text>
        </View>
      )}

      <Text style={styles.sectionHeader}>Choose a platform</Text>
      {IMPORT_PLATFORMS.map((platform) => (
        <TouchableOpacity
          key={platform.id}
          style={styles.row}
          onPress={() => selectPlatform(platform.id)}
          accessibilityRole="button"
          accessibilityLabel={`Import from ${platform.label}`}
          accessibilityHint={
            platform.id === CUSTOM_PLATFORM_ID
              ? 'Enter your own site address to import from any platform'
              : `Opens the ${platform.label} login page in your browser`
          }
          testID={`import-platform-${platform.id}`}
        >
          <Ionicons name={platform.icon} size={22} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>{platform.label}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      ))}

      {state.phase === 'customUrlEntry' && (
        <View style={styles.customBox} testID="import-custom-box">
          <Text style={styles.sectionHeader}>Your platform's login page</Text>
          <TextInput
            style={styles.input}
            value={customUrl}
            onChangeText={onCustomUrlChange}
            placeholder="https://app.yourplatform.com/login"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            inputMode="url"
            accessibilityLabel="Custom platform login web address"
            testID="import-custom-url"
          />
          <TouchableOpacity
            style={[styles.primaryBtn, !customValid && styles.primaryBtnDisabled]}
            disabled={!customValid}
            onPress={() => openLogin(CUSTOM_PLATFORM_ID, customUrl)}
            accessibilityRole="button"
            accessibilityLabel="Open login page"
            accessibilityState={{ disabled: !customValid }}
            testID="import-custom-open"
          >
            <Text style={styles.primaryBtnText}>Open login page</Text>
          </TouchableOpacity>
          {customUrl.length > 0 && !customValid && (
            <Text style={styles.hint} testID="import-custom-hint">
              Enter a secure https web address (public sites only).
            </Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 20, gap: 12 },
    title: { fontSize: 24, fontWeight: '700', color: colors.textPrimary },
    body: { fontSize: 15, lineHeight: 22, color: colors.textSecondary },
    prereq: {
      flexDirection: 'row',
      gap: 10,
      padding: 14,
      borderRadius: 12,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    prereqText: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.textSecondary },
    status: { padding: 14, borderRadius: 12 },
    statusInfo: { backgroundColor: colors.surface },
    statusError: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.error },
    statusText: { fontSize: 14, lineHeight: 20, color: colors.textPrimary },
    sectionHeader: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginTop: 8 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 16,
      paddingHorizontal: 16,
      borderRadius: 12,
      backgroundColor: colors.surface,
    },
    rowLabel: { flex: 1, fontSize: 16, color: colors.textPrimary },
    customBox: { gap: 10, marginTop: 4 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      padding: 14,
      fontSize: 15,
      color: colors.textPrimary,
      backgroundColor: colors.surface,
    },
    primaryBtn: {
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingVertical: 15,
      alignItems: 'center',
    },
    primaryBtnDisabled: { opacity: 0.4 },
    primaryBtnText: { color: colors.textOnPrimary, fontSize: 16, fontWeight: '600' },
    hint: { fontSize: 13, color: colors.error },
  });
}
