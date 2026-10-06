/**
 * CoachConnectScreen — Stripe Connect onboarding + dashboard surface.
 *
 * Shares the wizard's live requirements, return/refresh handling and retry
 * flow. Details submitted is not identity verified; bank payout timing comes
 * from Stripe, never a promise based only on the enabled switches.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';

import { connectApi } from '../../../api/connectApi';
import { coachSetupApi, type ConnectView } from '../../../api/coachSetupApi';
import GetPaidPanel from '../../../components/coach/setup/GetPaidPanel';
import { describeError } from '../../../lib/coachSetup/errors';
import { mediumTap, successTap } from '../../../utils/haptics';
import { assertStripeUrl } from '../../../utils/stripeUrlValidator';
import { track } from '../../../lib/analytics';
import { useTheme, ThemeColors } from '../../../theme/ThemeProvider';

interface Props {
  navigation: NavigationProp<ParamListBase>;
}

export default function CoachConnectScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [view, setView] = useState<ConnectView | null>(null);
  const [panelVersion, setPanelVersion] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    track('coach_connect_opened');
  }, []);

  const handleOpenDashboard = useCallback(async () => {
    mediumTap();
    setBusy(true);
    try {
      const link = await connectApi.createDashboardLink();
      track('coach_connect_dashboard_opened');
      assertStripeUrl(link.data.url, 'CoachConnectScreen.dashboard');
      await WebBrowser.openBrowserAsync(link.data.url, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      });
      successTap();
      setView(await coachSetupApi.refreshConnectStatus());
      setPanelVersion((n) => n + 1);
    } catch (err) {
      const failure = describeError(err, 'open your Stripe dashboard');
      Alert.alert(failure.title, failure.body);
    } finally {
      setBusy(false);
    }
  }, []);

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
      <ScrollView contentContainerStyle={styles.content}>
        <GetPaidPanel key={panelVersion} onChange={setView} testID="payout-setup" />
        {view?.accountId ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Account status</Text>
            <StatusRow label="Details submitted" value={view.detailsSubmitted} colors={colors} />
            <StatusRow label="Charges enabled" value={view.chargesEnabled} colors={colors} />
            <StatusRow label="Payouts enabled" value={view.payoutsEnabled} colors={colors} />
          </View>
        ) : null}
        {view?.chargesEnabled ? (
          <TouchableOpacity style={[styles.primaryBtn, busy && styles.primaryBtnDisabled]}
            onPress={handleOpenDashboard} disabled={busy}
            accessibilityRole="button" accessibilityLabel="Open Stripe dashboard">
            {busy ? <ActivityIndicator color={colors.textOnPrimary} /> : (
              <Text style={styles.primaryBtnText}>Open Stripe dashboard</Text>
            )}
          </TouchableOpacity>
        ) : null}
        <Text style={styles.fineprint}>
          Stripe collects payment and bank details on its secure pages. Check the
          Stripe dashboard for your payout schedule and bank arrival estimates.
        </Text>
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
