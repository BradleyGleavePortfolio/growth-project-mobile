/**
 * CoachConnectScreen — Stripe Connect onboarding + dashboard surface.
 *
 * Real-or-flagged contract (matches backend connect.controller.ts):
 *   • GET /v1/connect/accounts/me  → connected? + payout flags
 *   • POST .../create              → idempotent Express account creation
 *   • POST .../onboarding-link     → one-time hosted onboarding URL
 *   • POST .../dashboard-link      → one-time Stripe Express dashboard URL
 *
 * If the backend returns 503 CONNECT_NOT_CONFIGURED, we render an explicit
 * config-required state with the upstream message verbatim — never a
 * shrugging spinner and never fake success.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';

import { connectApi, ConnectStatusResponse } from '../../../api/connectApi';
import { errorCode, errorMessage, errorStatus } from '../../../types/common';
import { mediumTap, successTap } from '../../../utils/haptics';
import { track } from '../../../lib/analytics';
import { useTheme, ThemeColors } from '../../../theme/ThemeProvider';

interface Props {
  navigation: NavigationProp<ParamListBase>;
}

interface ConfigError {
  code: string;
  message: string;
}

export default function CoachConnectScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [status, setStatus] = useState<ConnectStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [configError, setConfigError] = useState<ConfigError | null>(null);

  const load = useCallback(async () => {
    setConfigError(null);
    try {
      const res = await connectApi.getStatus();
      setStatus(res.data);
    } catch (err) {
      const code = errorCode(err);
      const httpCode = errorStatus(err);
      if (httpCode === 503 || code === 'CONNECT_NOT_CONFIGURED') {
        setConfigError({
          code: code ?? 'CONNECT_NOT_CONFIGURED',
          message: errorMessage(
            err,
            'Stripe Connect is not configured on this environment.',
          ),
        });
        setStatus({ connected: false });
      } else if (httpCode === 404) {
        // Endpoint not deployed yet — same actionable state, different copy.
        setConfigError({
          code: 'CONNECT_NOT_DEPLOYED',
          message:
            'Payouts are coming soon. The Connect API is not yet deployed in this environment.',
        });
        setStatus({ connected: false });
      } else {
        Alert.alert('Could not load payouts', errorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    track('coach_connect_opened');
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const handleStartOnboarding = useCallback(async () => {
    mediumTap();
    setBusy(true);
    try {
      // Create-account is idempotent; calling it before mint-link guarantees
      // a row exists for this coach. Backend collapses replays at the Stripe
      // edge via per-coach idempotency keys.
      const connected = status?.connected === true;
      if (!connected) {
        await connectApi.createAccount({});
      }
      const link = await connectApi.createOnboardingLink();
      track('coach_connect_onboarding_started');
      const result = await WebBrowser.openBrowserAsync(link.data.url, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      });
      // Refresh on close so the new charges_enabled / payouts_enabled state
      // shows immediately instead of after a manual pull-to-refresh.
      if (
        result.type === 'cancel' ||
        result.type === 'dismiss' ||
        result.type === 'opened'
      ) {
        await load();
      }
    } catch (err) {
      const code = errorCode(err);
      if (code === 'CONNECT_NOT_CONFIGURED') {
        setConfigError({
          code,
          message: errorMessage(err, 'Stripe Connect is not configured.'),
        });
      } else {
        Alert.alert(
          'Could not open onboarding',
          errorMessage(err, 'Please try again in a moment.'),
        );
      }
    } finally {
      setBusy(false);
    }
  }, [status, load]);

  const handleOpenDashboard = useCallback(async () => {
    mediumTap();
    setBusy(true);
    try {
      const link = await connectApi.createDashboardLink();
      track('coach_connect_dashboard_opened');
      await WebBrowser.openBrowserAsync(link.data.url, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      });
      successTap();
      await load();
    } catch (err) {
      const code = errorCode(err);
      if (code === 'CONNECT_ONBOARDING_INCOMPLETE') {
        Alert.alert(
          'Finish onboarding first',
          'The Stripe dashboard is only available once your Connect onboarding is complete.',
        );
      } else {
        Alert.alert(
          'Could not open Stripe dashboard',
          errorMessage(err, 'Please try again in a moment.'),
        );
      }
    } finally {
      setBusy(false);
    }
  }, [load]);

  const renderBody = () => {
    if (loading) {
      return (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }

    if (configError) {
      return (
        <View style={styles.errorCard}>
          <Ionicons name="construct-outline" size={28} color={colors.warning} />
          <Text style={styles.errorTitle}>Payouts not available yet</Text>
          <Text style={styles.errorBody}>{configError.message}</Text>
          <Text style={styles.errorCode}>{configError.code}</Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={load}>
            <Text style={styles.secondaryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    const connected = status?.connected === true;
    const fullyOnboarded = connected && status.is_fully_onboarded;
    const charges = connected && status.charges_enabled;
    const payouts = connected && status.payouts_enabled;
    const submitted = connected && status.details_submitted;
    const disabled = connected && status.disabled_reason;

    return (
      <>
        <View style={styles.heroCard}>
          <View style={styles.heroIconWrap}>
            <Ionicons
              name={fullyOnboarded ? 'checkmark-circle' : 'wallet-outline'}
              size={28}
              color={fullyOnboarded ? colors.primary : colors.textSecondary}
            />
          </View>
          <Text style={styles.heroTitle}>
            {fullyOnboarded ? 'Payouts active' : 'Get paid for coaching'}
          </Text>
          <Text style={styles.heroBody}>
            {fullyOnboarded
              ? 'Your Stripe account is connected. Payments from your packages land in your bank automatically.'
              : 'Connect your bank through Stripe Express to receive payments from clients who buy your packages. Stripe verifies your identity once — the app never sees your bank details.'}
          </Text>
        </View>

        {connected ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Account status</Text>
            <StatusRow
              label="Identity verified"
              value={submitted}
              colors={colors}
            />
            <StatusRow label="Charges enabled" value={charges} colors={colors} />
            <StatusRow label="Payouts enabled" value={payouts} colors={colors} />
            {disabled ? (
              <View style={styles.warningRow}>
                <Ionicons name="alert-circle" size={16} color={colors.warning} />
                <Text style={styles.warningText}>
                  Stripe paused this account: {status.disabled_reason}. Re-run
                  onboarding to fix the flagged item.
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {!fullyOnboarded ? (
          <TouchableOpacity
            style={[styles.primaryBtn, busy && styles.primaryBtnDisabled]}
            onPress={handleStartOnboarding}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={
              connected ? 'Continue Stripe onboarding' : 'Start Stripe onboarding'
            }
          >
            {busy ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <>
                <Ionicons name="open-outline" size={18} color={colors.textOnPrimary} />
                <Text style={styles.primaryBtnText}>
                  {connected ? 'Continue onboarding' : 'Start onboarding'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.primaryBtn, busy && styles.primaryBtnDisabled]}
            onPress={handleOpenDashboard}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <>
                <Ionicons name="open-outline" size={18} color={colors.textOnPrimary} />
                <Text style={styles.primaryBtnText}>Open Stripe dashboard</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        <Text style={styles.fineprint}>
          Stripe handles all payment data. The Growth Project never stores card or
          bank account information.
        </Text>
      </>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Payouts</Text>
        <View style={styles.backBtn} />
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {renderBody()}
      </ScrollView>
    </View>
  );
}

function StatusRow({
  label,
  value,
  colors,
}: {
  label: string;
  value: boolean;
  colors: ThemeColors;
}) {
  return (
    <View style={statusRowStyles.row}>
      <Text style={[statusRowStyles.label, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <View style={statusRowStyles.right}>
        <Ionicons
          name={value ? 'checkmark-circle' : 'ellipse-outline'}
          size={18}
          color={value ? colors.primary : colors.textMuted}
        />
        <Text
          style={[
            statusRowStyles.value,
            { color: value ? colors.primary : colors.textMuted },
          ]}
        >
          {value ? 'Yes' : 'Pending'}
        </Text>
      </View>
    </View>
  );
}

const statusRowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    alignItems: 'center',
  },
  label: { fontSize: 14 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  value: { fontSize: 13, fontWeight: '500' },
});

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 56,
      paddingBottom: 12,
    },
    backBtn: {
      width: 40,
      height: 40,
      justifyContent: 'center',
      alignItems: 'center',
    },
    topTitle: { fontSize: 18, fontWeight: '500', color: colors.textPrimary },
    content: { paddingHorizontal: 24, paddingBottom: 40 },
    loadingWrap: { paddingVertical: 60, alignItems: 'center' },
    heroCard: {
      backgroundColor: colors.surface,
      borderRadius: 4,
      padding: 20,
      marginBottom: 18,
    },
    heroIconWrap: { marginBottom: 10 },
    heroTitle: {
      fontSize: 20,
      fontWeight: '500',
      color: colors.textPrimary,
      marginBottom: 8,
    },
    heroBody: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
    section: {
      backgroundColor: colors.surface,
      borderRadius: 4,
      padding: 18,
      marginBottom: 18,
    },
    sectionTitle: {
      fontSize: 12,
      fontWeight: '500',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 8,
    },
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.primary,
      paddingVertical: 14,
      borderRadius: 2,
      marginBottom: 12,
    },
    primaryBtnDisabled: { opacity: 0.6 },
    primaryBtnText: {
      color: colors.textOnPrimary,
      fontSize: 15,
      fontWeight: '500',
    },
    fineprint: {
      fontSize: 12,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 18,
      marginTop: 4,
    },
    warningRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 10,
      padding: 10,
      borderRadius: 4,
      backgroundColor: colors.noticeWarningIconBg,
    },
    warningText: {
      flex: 1,
      fontSize: 13,
      color: colors.textPrimary,
      lineHeight: 18,
    },
    errorCard: {
      backgroundColor: colors.surface,
      borderRadius: 4,
      padding: 20,
      gap: 8,
      alignItems: 'center',
    },
    errorTitle: {
      fontSize: 16,
      fontWeight: '500',
      color: colors.textPrimary,
      marginTop: 4,
    },
    errorBody: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 18,
    },
    errorCode: {
      fontSize: 11,
      color: colors.textMuted,
      fontFamily: undefined,
      marginTop: 2,
    },
    secondaryBtn: {
      marginTop: 12,
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    secondaryBtnText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  });
