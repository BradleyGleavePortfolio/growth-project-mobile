/**
 * CoachPackagesScreen — package CRUD for the coach.
 *
 * Wired to backend PR #215 via `coachPaymentsApi`:
 *   - GET    /v1/coach/packages
 *   - POST   /v1/coach/packages
 *   - PATCH  /v1/coach/packages/:id
 *   - DELETE /v1/coach/packages/:id
 *
 * Behaviour:
 *  - 404 / 501 from the list endpoint => "Connect Stripe to create plans"
 *    CTA that opens onboarding via `coachConnectApi.createOnboardingLink`.
 *  - Coaches can create, edit, and archive packages. Archived packages
 *    remain in Stripe history so existing subscribers keep paying — we
 *    just hide the package from clients.
 *  - The 2% TGP platform fee + Stripe processing fee are surfaced
 *    inline so coaches can set price expectations honestly.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';

import {
  coachPaymentsApi,
  type CoachPackageRecord,
  type CoachPackageInput,
} from '../../api/coachPaymentsApi';
import { coachConnectApi, type ConnectResult } from '../../api/coachConnectApi';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

const DEFAULT_INPUT: CoachPackageInput = {
  name: '',
  description: '',
  type: 'recurring',
  price: 0,
  currency: 'USD',
  interval: 'month',
  trial_days: null,
  features: [],
  active: true,
};

function PackageEditor({
  visible,
  initial,
  busy,
  onClose,
  onSave,
  colors,
  styles,
}: {
  visible: boolean;
  initial: CoachPackageInput;
  busy: boolean;
  onClose: () => void;
  onSave: (input: CoachPackageInput) => void;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [input, setInput] = useState<CoachPackageInput>(initial);
  const [priceText, setPriceText] = useState<string>(String(initial.price ?? ''));
  const [featuresText, setFeaturesText] = useState<string>(
    (initial.features ?? []).join('\n'),
  );

  useEffect(() => {
    if (visible) {
      setInput(initial);
      setPriceText(String(initial.price ?? ''));
      setFeaturesText((initial.features ?? []).join('\n'));
    }
  }, [visible, initial]);

  const handleSave = () => {
    const price = Number(priceText.replace(/[^0-9.]/g, ''));
    if (!input.name.trim()) {
      Alert.alert('Name required', 'Give this package a short name your clients will see.');
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      Alert.alert('Price required', 'Enter a price greater than zero.');
      return;
    }
    onSave({
      ...input,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      price,
      features: featuresText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      interval: input.type === 'recurring' ? input.interval ?? 'month' : null,
      trial_days: input.type === 'recurring' ? input.trial_days ?? null : null,
    });
  };

  // Net to coach preview using the documented 2% TGP platform fee + a
  // typical 2.9%+30¢ Stripe blended rate. Surfaced as a hint, not as
  // authoritative — actual fees come from the earnings screen.
  const grossPrice = Number(priceText.replace(/[^0-9.]/g, '')) || 0;
  const stripeFee = grossPrice > 0 ? grossPrice * 0.029 + 0.3 : 0;
  const platformFee = grossPrice * 0.02;
  const netEstimate = Math.max(0, grossPrice - stripeFee - platformFee);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalBackdrop}
      >
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {initial.name ? 'Edit package' : 'New package'}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              style={styles.input}
              value={input.name}
              onChangeText={(name) => setInput((s) => ({ ...s, name }))}
              placeholder="e.g. 1:1 Coaching"
              placeholderTextColor={colors.textMuted}
            />

            <Text style={styles.fieldLabel}>Description (optional)</Text>
            <TextInput
              style={[styles.input, { minHeight: 64, textAlignVertical: 'top' }]}
              value={input.description ?? ''}
              onChangeText={(description) => setInput((s) => ({ ...s, description }))}
              placeholder="What does the client get?"
              placeholderTextColor={colors.textMuted}
              multiline
            />

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Price</Text>
                <TextInput
                  style={styles.input}
                  value={priceText}
                  onChangeText={setPriceText}
                  placeholder="199"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Currency</Text>
                <TextInput
                  style={styles.input}
                  value={input.currency}
                  onChangeText={(currency) =>
                    setInput((s) => ({ ...s, currency: currency.toUpperCase().slice(0, 3) }))
                  }
                  autoCapitalize="characters"
                  maxLength={3}
                />
              </View>
            </View>

            {grossPrice > 0 ? (
              <Text style={styles.feeHint}>
                Estimated net per charge: {formatMoney(netEstimate, input.currency)} ·
                {'  '}TGP fee 2% ({formatMoney(platformFee, input.currency)}) +
                Stripe fees (~{formatMoney(stripeFee, input.currency)}). Final
                fees shown on Earnings.
              </Text>
            ) : null}

            <Text style={styles.fieldLabel}>Type</Text>
            <View style={styles.segmentRow}>
              {(['recurring', 'one_time'] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.segment, input.type === t && styles.segmentActive]}
                  onPress={() => setInput((s) => ({ ...s, type: t }))}
                  accessibilityRole="button"
                  accessibilityLabel={`Type ${t}`}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      input.type === t && styles.segmentTextActive,
                    ]}
                  >
                    {t === 'recurring' ? 'Subscription' : 'One-time'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {input.type === 'recurring' ? (
              <>
                <Text style={styles.fieldLabel}>Billing interval</Text>
                <View style={styles.segmentRow}>
                  {(['month', 'year'] as const).map((iv) => (
                    <TouchableOpacity
                      key={iv}
                      style={[styles.segment, input.interval === iv && styles.segmentActive]}
                      onPress={() => setInput((s) => ({ ...s, interval: iv }))}
                      accessibilityRole="button"
                      accessibilityLabel={`Interval ${iv}`}
                    >
                      <Text
                        style={[
                          styles.segmentText,
                          input.interval === iv && styles.segmentTextActive,
                        ]}
                      >
                        {iv === 'month' ? 'Monthly' : 'Yearly'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.fieldLabel}>Trial days (optional)</Text>
                <TextInput
                  style={styles.input}
                  value={input.trial_days != null ? String(input.trial_days) : ''}
                  onChangeText={(t) => {
                    const n = Number(t.replace(/[^0-9]/g, ''));
                    setInput((s) => ({
                      ...s,
                      trial_days: t === '' ? null : Math.min(60, Math.max(0, n)),
                    }));
                  }}
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                />
              </>
            ) : null}

            <Text style={styles.fieldLabel}>Features (one per line, optional)</Text>
            <TextInput
              style={[styles.input, { minHeight: 96, textAlignVertical: 'top' }]}
              value={featuresText}
              onChangeText={setFeaturesText}
              placeholder={'Weekly check-ins\nCustom macros\nUnlimited messaging'}
              placeholderTextColor={colors.textMuted}
              multiline
            />

            <View style={styles.toggleRow}>
              <Text style={styles.fieldLabel}>Visible to clients</Text>
              <Switch
                value={input.active !== false}
                onValueChange={(active) => setInput((s) => ({ ...s, active }))}
              />
            </View>

            <TouchableOpacity
              style={[styles.saveBtn, busy && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Save package"
            >
              {busy ? (
                <ActivityIndicator color={colors.textOnPrimary} />
              ) : (
                <Text style={styles.saveBtnText}>Save</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function CoachPackagesScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();

  const [packages, setPackages] = useState<ConnectResult<CoachPackageRecord[]> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorInitial, setEditorInitial] = useState<CoachPackageInput>(DEFAULT_INPUT);
  const [editorTargetId, setEditorTargetId] = useState<string | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(async () => {
    const res = await coachPaymentsApi.listPackages();
    setPackages(res);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    try {
      const res = await coachConnectApi.createOnboardingLink('packages');
      if (res.ok) await Linking.openURL(res.data.url);
    } finally {
      setConnecting(false);
    }
  }, []);

  const openNew = () => {
    setEditorInitial({ ...DEFAULT_INPUT });
    setEditorTargetId(null);
    setEditorOpen(true);
  };

  const openEdit = (pkg: CoachPackageRecord) => {
    setEditorInitial({
      name: pkg.name,
      description: pkg.description,
      type: pkg.type,
      price: pkg.price,
      currency: pkg.currency,
      interval: pkg.interval,
      trial_days: pkg.trial_days ?? null,
      features: pkg.features ?? [],
      active: pkg.active,
    });
    setEditorTargetId(pkg.id);
    setEditorOpen(true);
  };

  const handleSave = useCallback(
    async (input: CoachPackageInput) => {
      setEditorBusy(true);
      try {
        const res = editorTargetId
          ? await coachPaymentsApi.updatePackage(editorTargetId, input)
          : await coachPaymentsApi.createPackage(input);
        if (!res.ok) {
          Alert.alert(
            'Could not save',
            res.reason === 'not_configured'
              ? 'Backend not ready yet — connect Stripe first.'
              : res.message,
          );
          return;
        }
        setEditorOpen(false);
        await load();
      } finally {
        setEditorBusy(false);
      }
    },
    [editorTargetId, load],
  );

  const handleArchive = useCallback(
    (pkg: CoachPackageRecord) => {
      const action = pkg.active ? 'Hide' : 'Restore';
      const verb = pkg.active ? 'hide' : 'restore';
      Alert.alert(
        `${action} package?`,
        pkg.active && pkg.active_subscribers > 0
          ? `${pkg.active_subscribers} active subscriber(s) keep paying — they're unaffected. New clients won't see this package.`
          : `Clients will ${pkg.active ? 'no longer see' : 'see'} this package.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: action,
            style: pkg.active ? 'destructive' : 'default',
            onPress: async () => {
              const res = pkg.active
                ? await coachPaymentsApi.archivePackage(pkg.id)
                : await coachPaymentsApi.updatePackage(pkg.id, { active: true });
              if (!res.ok) {
                Alert.alert(
                  `Could not ${verb}`,
                  res.reason === 'not_configured' ? 'Backend not ready yet.' : res.message,
                );
                return;
              }
              await load();
            },
          },
        ],
      );
    },
    [load],
  );

  if (!packages) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const notConfigured = !packages.ok && packages.reason === 'not_configured';

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Packages</Text>
        <TouchableOpacity
          onPress={openNew}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel="New package"
          disabled={notConfigured}
        >
          <Ionicons
            name="add"
            size={26}
            color={notConfigured ? colors.textMuted : colors.textPrimary}
          />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {notConfigured ? (
          <View style={styles.gate}>
            <Ionicons name="card-outline" size={36} color={colors.textMuted} />
            <Text style={styles.gateTitle}>Connect Stripe to create plans</Text>
            <Text style={styles.gateBody}>
              Packages are billed through your connected Stripe account. The
              Growth Project's platform fee is 2% of gross; Stripe fees are
              passed through. Once connected, clients see plans inside the
              app and check out securely.
            </Text>
            <TouchableOpacity
              style={[styles.cta, connecting && styles.ctaDisabled]}
              onPress={handleConnect}
              disabled={connecting}
              accessibilityRole="button"
              accessibilityLabel="Connect Stripe"
            >
              {connecting ? (
                <ActivityIndicator color={colors.textOnPrimary} />
              ) : (
                <Text style={styles.ctaText}>Connect Stripe</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : packages.ok ? (
          packages.data.length === 0 ? (
            <View style={styles.gate}>
              <Text style={styles.gateTitle}>No packages yet</Text>
              <Text style={styles.gateBody}>
                Tap + to publish your first plan. Clients see plans inside the
                app and pay through Stripe Checkout.
              </Text>
            </View>
          ) : (
            packages.data.map((pkg) => (
              <View key={pkg.id} style={styles.pkgRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pkgName}>{pkg.name}</Text>
                  <Text style={styles.pkgSub}>
                    {formatMoney(pkg.price, pkg.currency)}
                    {pkg.type === 'recurring' && pkg.interval ? ` / ${pkg.interval}` : ''}
                    {pkg.type === 'recurring' ? ` · ${pkg.active_subscribers} active` : ''}
                  </Text>
                  {!pkg.active ? (
                    <Text style={styles.pkgArchivedHint}>Hidden from clients</Text>
                  ) : null}
                </View>
                <TouchableOpacity
                  onPress={() => openEdit(pkg)}
                  style={styles.iconBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${pkg.name}`}
                >
                  <Ionicons name="pencil" size={18} color={colors.primary} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleArchive(pkg)}
                  style={styles.iconBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`${pkg.active ? 'Hide' : 'Restore'} ${pkg.name}`}
                >
                  <Ionicons
                    name={pkg.active ? 'eye-off-outline' : 'eye-outline'}
                    size={18}
                    color={colors.textMuted}
                  />
                </TouchableOpacity>
              </View>
            ))
          )
        ) : (
          <TouchableOpacity onPress={load} style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={18} color="#fff" />
            <Text style={styles.errorBannerText}>
              {packages.reason === 'error' ? packages.message : 'Could not load.'} Tap to retry.
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <PackageEditor
        visible={editorOpen}
        initial={editorInitial}
        busy={editorBusy}
        onClose={() => setEditorOpen(false)}
        onSave={handleSave}
        colors={colors}
        styles={styles}
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 56,
      paddingBottom: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    topTitle: { fontSize: 18, fontWeight: '500', color: colors.textPrimary },
    iconBtn: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    content: { padding: 20, paddingBottom: 40 },
    gate: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 12 },
    gateTitle: { fontSize: 18, fontWeight: '600', color: colors.textPrimary, marginTop: 12 },
    gateBody: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: 8,
      lineHeight: 19,
    },
    cta: {
      marginTop: 20,
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingHorizontal: 20,
      paddingVertical: 12,
    },
    ctaDisabled: { opacity: 0.5 },
    ctaText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 14 },
    pkgRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    pkgName: { fontSize: 15, fontWeight: '500', color: colors.textPrimary },
    pkgSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
    pkgArchivedHint: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.error,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 8,
    },
    errorBannerText: { color: '#fff', fontSize: 13, flex: 1 },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    modalSheet: {
      backgroundColor: colors.background,
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 32,
      maxHeight: '92%',
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    modalTitle: { fontSize: 18, fontWeight: '600', color: colors.textPrimary },
    fieldLabel: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 14,
      marginBottom: 6,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    input: {
      backgroundColor: colors.surface,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: colors.textPrimary,
      fontSize: 14,
    },
    segmentRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 2,
    },
    segment: {
      flex: 1,
      paddingVertical: 10,
      alignItems: 'center',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    segmentActive: {
      backgroundColor: colors.primaryPale,
      borderColor: colors.primary,
    },
    segmentText: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
    segmentTextActive: { color: colors.primary, fontWeight: '600' },
    feeHint: {
      fontSize: 11,
      color: colors.textMuted,
      marginTop: 6,
      lineHeight: 15,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 18,
    },
    saveBtn: {
      marginTop: 24,
      backgroundColor: colors.primary,
      paddingVertical: 14,
      borderRadius: 10,
      alignItems: 'center',
    },
    saveBtnDisabled: { opacity: 0.5 },
    saveBtnText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 15 },
  });
