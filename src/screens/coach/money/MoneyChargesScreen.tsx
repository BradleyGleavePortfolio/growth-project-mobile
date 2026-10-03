/**
 * S-COACH-MOB-2 — "See all" charges from the Money page, filtered by
 * All / Paid / Failed / Refunded / Disputed, newest first, paged by the server cursor
 * (GET /v1/coach/money/charges). Tap a charge for its fee breakdown.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTheme } from "../../../theme/ThemeProvider";
import {
  CHARGE_FILTERS,
  coachMoneyApi,
  type ChargeFilter,
  type MoneyCharge,
} from "../../../api/coachMoneyApi";
import {
  describeError,
  type FriendlyError,
} from "../../../lib/coachSetup/errors";
import {
  chargeIsProblem,
  chargeStateLabel,
  FILTER_LABEL,
  money,
  shortDate,
} from "../../../lib/money/moneyCopy";
import { useNetworkStatus } from "../../../hooks/useNetworkStatus";
import SetupNotice from "../../../components/coach/setup/SetupNotice";
import type { SettingsStackParamList } from "../../../navigation/CoachNavigator";
import { makeStyles } from "./MoneyScreen";
import { SafeAreaView } from "react-native-safe-area-context";
import MoneyBack from "./MoneyBack";

type Props = NativeStackScreenProps<
  SettingsStackParamList,
  "CoachMoneyCharges"
>;

const EMPTY: Record<ChargeFilter, string> = {
  all: "No charges yet.",
  paid: "No paid charges yet.",
  failed: "No failed payments. Good news.",
  refunded: "No refunds or chargebacks.",
  disputed: "No disputed charges.",
};

export default function MoneyChargesScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { isOnline } = useNetworkStatus();
  const [filter, setFilter] = useState<ChargeFilter>(
    route.params?.filter ?? "all",
  );
  const [items, setItems] = useState<MoneyCharge[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FriendlyError | null>(null);
  const seq = useRef(0);

  const load = useCallback(
    async (reset: boolean) => {
      const mine = ++seq.current;
      setLoading(true);
      setError(null);
      try {
        const page = await coachMoneyApi.charges(filter, {
          cursor: reset ? null : cursor,
          limit: 20,
        });
        if (mine !== seq.current) return;
        setItems((prev) => (reset ? page.charges : [...prev, ...page.charges]));
        setCursor(page.nextCursor);
        setDone(page.nextCursor === null);
      } catch (err) {
        if (mine !== seq.current) return;
        setError(describeError(err, "load your charges"));
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [filter, cursor],
  );

  useEffect(() => {
    setItems([]);
    setCursor(null);
    setDone(false);
    void load(true);
    // Reload only when the filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  return (
    <SafeAreaView ph-no-capture
      style={styles.page}
      edges={["top"]}
      testID="money-charges-screen"
    >
      <View style={[styles.inner, { paddingBottom: 0 }]}>
        <MoneyBack />
        <Text style={styles.h1} accessibilityRole="header">
          Charges
        </Text>
        {!isOnline ? (
          <View style={styles.offline} accessibilityRole="alert">
            <Text style={styles.offlineTitle}>You are offline</Text>
            <Text style={styles.offlineBody}>
              Connect to the internet to load more charges.
            </Text>
          </View>
        ) : null}
        <View
          style={styles.chips}
          accessibilityRole="tablist"
          accessibilityLabel="Filter charges"
        >
          {CHARGE_FILTERS.map((f) => (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              style={[styles.chip, f === filter && styles.chipOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: f === filter }}
              accessibilityLabel={FILTER_LABEL[f]}
              testID={`money-filter-${f}`}
            >
              <Text
                style={[styles.chipText, f === filter && styles.chipTextOn]}
              >
                {FILTER_LABEL[f]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <FlatList
        data={items}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.inner}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (!loading && !done && !error && items.length > 0) void load(false);
        }}
        renderItem={({ item: ch }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() =>
              navigation.navigate("CoachMoneyCharge", { chargeId: ch.id })
            }
            accessibilityRole="button"
            accessibilityLabel={`${ch.client.name}, ${ch.packageName}, ${money(
              ch.amountCents,
              ch.currency,
            )}, ${chargeStateLabel(ch)}. Open the breakdown`}
            testID={`money-charges-row-${ch.id}`}
          >
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{ch.client.name}</Text>
              <Text style={styles.rowSub}>
                {[ch.packageName, shortDate(ch.createdAt)]
                  .filter(Boolean)
                  .join(", ")}
              </Text>
            </View>
            <View style={styles.rowEnd}>
              <Text style={styles.rowAmount}>
                {money(ch.amountCents, ch.currency)}
              </Text>
              <Text
                style={[styles.rowSub, chargeIsProblem(ch) && styles.problem]}
              >
                {chargeStateLabel(ch)}
              </Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          !loading && !error ? (
            <Text style={styles.body} testID="money-charges-empty">
              {EMPTY[filter]}
            </Text>
          ) : null
        }
        ListFooterComponent={
          <View>
            {loading ? (
              <ActivityIndicator
                color={colors.primary}
                accessibilityLabel="Loading charges"
              />
            ) : null}
            {error ? (
              <SetupNotice
                error={error}
                onRetry={() => void load(items.length === 0)}
                testID="money-charges-screen-error"
              />
            ) : null}
          </View>
        }
      />
    </SafeAreaView>
  );
}
