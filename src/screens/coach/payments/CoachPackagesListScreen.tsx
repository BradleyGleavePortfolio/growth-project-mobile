/**
 * CoachPackagesListScreen — coach's saved offerings (active + archived).
 *
 * Wires GET /v1/coach/packages and a 404 → empty-state branch. When the
 * backend module isn't deployed (PACKAGES_NOT_CONFIGURED), the screen
 * renders an actionable "coming soon" state with the upstream message,
 * never a fake list.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';

import { coachPackagesApi, CoachPackage } from '../../../api/packagesApi';
import { errorCode, errorMessage, errorStatus } from '../../../types/common';
import { mediumTap } from '../../../utils/haptics';
import { track } from '../../../lib/analytics';
import { useTheme, ThemeColors } from '../../../theme/ThemeProvider';
import { formatCurrencyCents } from '../../../utils/currency';

interface Props {
  navigation: NavigationProp<ParamListBase>;
}

interface EmptyConfig {
  // Code stays for telemetry/logs only — never rendered.
  code: string;
  title: string;
  body: string;
}

function packagesConfigCopy(code: string): { title: string; body: string } {
  switch (code) {
    case 'PACKAGES_NOT_CONFIGURED':
      return {
        title: 'Create your first package',
        body: 'Create your first package to get started.',
      };
    default:
      return {
        title: 'Packages coming soon',
        body: 'Coach packages are not enabled in this environment yet.',
      };
  }
}

export default function CoachPackagesListScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<CoachPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [configState, setConfigState] = useState<EmptyConfig | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    setConfigState(null);
    try {
      const res = await coachPackagesApi.list();
      setItems(res.data ?? []);
    } catch (err) {
      const code = errorCode(err);
      const httpCode = errorStatus(err);
      if (httpCode === 404) {
        const resolvedCode = code ?? 'PACKAGES_NOT_CONFIGURED';
        console.warn('[coach-packages] config blocker', resolvedCode);
        setConfigState({ code: resolvedCode, ...packagesConfigCopy(resolvedCode) });
        setItems([]);
      } else {
        setError(errorMessage(err, 'Could not load packages.'));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    track('coach_packages_list_opened');
    const unsub = navigation.addListener('focus', load);
    load();
    return unsub;
  }, [navigation, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const handleCreate = () => {
    mediumTap();
    navigation.navigate('CoachPackageEdit', { packageId: null });
  };

  const handleOpenItem = (pkg: CoachPackage) => {
    mediumTap();
    // Pass the full row through nav params: the edit screen has no
    // `GET /v1/coach/packages/:id` route to fetch from yet.
    navigation.navigate('CoachPackageEdit', { packageId: pkg.id, initialPackage: pkg });
  };

  const renderEmpty = () => {
    if (configState) {
      return (
        <View style={styles.emptyWrap}>
          <Ionicons name="construct-outline" size={32} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>{configState.title}</Text>
          <Text style={styles.emptyBody}>{configState.body}</Text>
        </View>
      );
    }
    return (
      <View style={styles.emptyWrap}>
        <Ionicons name="pricetags-outline" size={32} color={colors.textMuted} />
        <Text style={styles.emptyTitle}>No packages yet</Text>
        <Text style={styles.emptyBody}>
          Create an offering — a 1:1 plan, a 12-week program, a meal plan
          subscription — and share the link with prospective clients.
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={handleCreate}>
          <Ionicons name="add" size={18} color={colors.textOnPrimary} />
          <Text style={styles.primaryBtnText}>Create your first package</Text>
        </TouchableOpacity>
      </View>
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
        <Text style={styles.topTitle}>Packages</Text>
        {!configState ? (
          <TouchableOpacity
            onPress={handleCreate}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Create package"
          >
            <Ionicons name="add" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        ) : (
          <View style={styles.backBtn} />
        )}
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => p.id}
          contentContainerStyle={
            items.length === 0 ? styles.contentEmpty : styles.content
          }
          ListEmptyComponent={renderEmpty()}
          ListHeaderComponent={
            error ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>{error}</Text>
              </View>
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item }) => (
            <PackageRow
              pkg={item}
              colors={colors}
              styles={styles}
              onPress={() => handleOpenItem(item)}
            />
          )}
        />
      )}
    </View>
  );
}

function PackageRow({
  pkg,
  colors,
  styles,
  onPress,
}: {
  pkg: CoachPackage;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
  onPress: () => void;
}) {
  const archived = pkg.status === 'archived';
  return (
    <TouchableOpacity
      style={[styles.card, archived && styles.cardArchived]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Edit ${pkg.title}`}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {pkg.title}
        </Text>
        <View
          style={[
            styles.pill,
            archived ? styles.pillArchived : styles.pillActive,
          ]}
        >
          <Text
            style={[
              styles.pillText,
              archived
                ? { color: colors.textMuted }
                : { color: colors.primary },
            ]}
          >
            {archived ? 'Archived' : pkg.status === 'draft' ? 'Draft' : 'Active'}
          </Text>
        </View>
      </View>
      <Text style={styles.cardPrice}>
        {formatCurrencyCents(pkg.priceCents, pkg.currency)}
        {pkg.billingInterval !== 'one_time' ? (
          <Text style={styles.cardPriceMeta}>
            {' '}/ {pkg.intervalCount > 1 ? `${pkg.intervalCount} ` : ''}
            {pkg.billingInterval === 'monthly'
              ? 'mo'
              : pkg.billingInterval === 'quarterly'
              ? 'qtr'
              : 'yr'}
          </Text>
        ) : null}
      </Text>
      <View style={styles.cardMetaRow}>
        <Text style={styles.cardMeta}>
          {pkg.subscriberCount} {pkg.subscriberCount === 1 ? 'client' : 'clients'}
        </Text>
        <Text style={styles.cardMeta}>
          {formatCurrencyCents(pkg.monthlyRevenueCents, pkg.currency)} / mo
        </Text>
      </View>
    </TouchableOpacity>
  );
}

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
    loadingWrap: { paddingVertical: 60, alignItems: 'center' },
    content: { paddingHorizontal: 24, paddingBottom: 40, gap: 12 },
    contentEmpty: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 40 },
    emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 40 },
    emptyTitle: {
      fontSize: 18,
      fontWeight: '500',
      color: colors.textPrimary,
      marginTop: 8,
    },
    emptyBody: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      paddingHorizontal: 8,
      lineHeight: 20,
    },
    errorCode: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.primary,
      paddingHorizontal: 18,
      paddingVertical: 12,
      borderRadius: 2,
      marginTop: 12,
    },
    primaryBtnText: {
      color: colors.textOnPrimary,
      fontSize: 14,
      fontWeight: '500',
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 4,
      padding: 16,
    },
    cardArchived: { opacity: 0.6 },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 8,
      marginBottom: 6,
    },
    cardTitle: {
      flex: 1,
      fontSize: 16,
      fontWeight: '500',
      color: colors.textPrimary,
    },
    pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
    pillActive: { backgroundColor: colors.primaryPale },
    pillArchived: { backgroundColor: colors.surfaceElevated },
    pillText: { fontSize: 11, fontWeight: '500', textTransform: 'uppercase' },
    cardPrice: {
      fontSize: 18,
      fontWeight: '500',
      color: colors.textPrimary,
      marginBottom: 6,
    },
    cardPriceMeta: { fontSize: 13, fontWeight: '400', color: colors.textSecondary },
    cardMetaRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 4,
    },
    cardMeta: { fontSize: 12, color: colors.textSecondary },
    errorBanner: {
      backgroundColor: colors.noticeWarningIconBg,
      padding: 10,
      borderRadius: 4,
      marginBottom: 12,
    },
    errorBannerText: { fontSize: 13, color: colors.textPrimary },
  });
