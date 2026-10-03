/**
 * S-COACH-MOB-2 — the Money card on the coach Home: net to you over the last
 * 30 days, the change on the 30 days before, and a red count of what needs
 * attention. Tapping it opens the full Money page. Before Stripe is set up
 * the card offers the setup action instead of empty numbers.
 * Data: GET /v1/coach/money/summary (30d + compare), GET /coach/connect/status.
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
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useTheme, ThemeColors } from "../../../theme/ThemeProvider";
import { coachMoneyApi, type MoneySummary } from "../../../api/coachMoneyApi";
import { coachSetupApi, type ConnectView } from "../../../api/coachSetupApi";
import {
  describeError,
  isSubCoachBillingBlocked,
  type FriendlyError,
} from "../../../lib/coachSetup/errors";
import { changeLine, money } from "../../../lib/money/moneyCopy";
import { noteHeadCoachHandlesMoney } from "../../../lib/money/headCoachRole";
import { useNetworkStatus } from "../../../hooks/useNetworkStatus";
import SetupNotice from "../setup/SetupNotice";

interface Props {
  onOpenMoney: () => void;
  onSetUpStripe: () => void;
}

export default function MoneyHomeCard({ onOpenMoney, onSetUpStripe }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { isOnline } = useNetworkStatus();
  const [summary, setSummary] = useState<MoneySummary | null>(null);
  const [connect, setConnect] = useState<ConnectView | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  // C-332-1 (Opus): an active sub-coach's money is the head coach's.
  const [headCoachHandles, setHeadCoachHandles] = useState(false);

  // C-332-13 (Opus): every focus reloads, so only the newest load may write,
  // and nothing writes after the card unmounts (sign-out swaps the stack).
  const seq = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    const [s, c] = await Promise.allSettled([
      coachMoneyApi.summary("30d"),
      coachSetupApi.connectStatus(),
    ]);
    if (!alive.current || mine !== seq.current) return;
    if (s.status === "fulfilled") {
      setSummary(s.value);
      setLoadedAt(Date.now());
      setHeadCoachHandles(false);
      noteHeadCoachHandlesMoney(false);
    } else if (isSubCoachBillingBlocked(s.reason)) {
      setHeadCoachHandles(true);
      noteHeadCoachHandlesMoney(true);
    } else {
      setError(describeError(s.reason, "load your Money numbers"));
    }
    if (c.status === "fulfilled") setConnect(c.value);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const notStarted =
    connect !== null &&
    connect.state === "not_started" &&
    (summary?.totals.chargeCount ?? 0) === 0;
  const attention = summary?.attentionCount ?? 0;
  const lastLoaded = loadedAt
    ? new Date(loadedAt).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  const otherCurrencies = (summary?.currencies ?? []).filter(
    (c) => c !== summary?.currency,
  );

  if (headCoachHandles) {
    return (
      <View
        ph-no-capture
        style={styles.card}
        testID="money-home-card-head-coach"
        accessible
        accessibilityLabel="Money is handled by your head coach. Their practice takes payments and receives payouts for the clients you coach."
      >
        <Text style={styles.title}>Money</Text>
        <Text style={styles.sub}>
          Your head coach&apos;s practice takes payments and receives payouts
          for the clients you coach.
        </Text>
      </View>
    );
  }

  return (
    <View ph-no-capture style={styles.card} testID="money-home-card">
      <TouchableOpacity
        onPress={onOpenMoney}
        accessibilityRole="button"
        accessibilityLabel={
          summary
            ? `Money. Net to you, last 30 days: ${money(
                summary.totals.netCents,
                summary.currency,
              )}.${
                attention > 0
                  ? ` ${attention} ${attention === 1 ? "thing needs" : "things need"} your attention.`
                  : ""
              } Open Money`
            : "Open Money"
        }
        testID="money-home-card-open"
      >
        <View style={styles.head}>
          <Text style={styles.title}>Money</Text>
          {attention > 0 ? (
            <View style={styles.badge} testID="money-home-card-attention">
              <Text style={styles.badgeText}>
                {attention} need{attention === 1 ? "s" : ""} attention
              </Text>
            </View>
          ) : null}
        </View>
        {summary ? (
          <>
            <Text style={styles.eyebrow}>Net to you, last 30 days</Text>
            <Text style={styles.amount} testID="money-home-card-net">
              {money(summary.totals.netCents, summary.currency)}
            </Text>
            {changeLine(
              "30d",
              summary.changeCents,
              summary.changePct,
              summary.currency,
            ) ? (
              <Text style={styles.sub}>
                {changeLine(
                  "30d",
                  summary.changeCents,
                  summary.changePct,
                  summary.currency,
                )}
              </Text>
            ) : null}
            {otherCurrencies.length > 0 ? (
              <Text style={styles.sub} testID="money-home-card-currencies">
                {`In ${summary.currency.toUpperCase()}. You also have sales in ${otherCurrencies
                  .map((c) => c.toUpperCase())
                  .join(", ")}; open Money to see each.`}
              </Text>
            ) : null}
            {!isOnline ? (
              <Text style={styles.sub} testID="money-home-card-offline">
                {lastLoaded
                  ? `You are offline. These are the numbers from ${lastLoaded}.`
                  : "You are offline. These are the last numbers loaded."}
              </Text>
            ) : error ? (
              <Text style={styles.sub} testID="money-home-card-stale">
                {lastLoaded
                  ? `These are the numbers from ${lastLoaded}. They could not be refreshed.`
                  : "These numbers could not be refreshed."}
              </Text>
            ) : null}
          </>
        ) : loading ? (
          <ActivityIndicator
            color={colors.primary}
            accessibilityLabel="Loading Money"
          />
        ) : null}
      </TouchableOpacity>
      {error && (!summary || isOnline) ? (
        <SetupNotice
          error={error}
          onRetry={() => void load()}
          testID="money-home-card-error"
        />
      ) : null}
      {notStarted ? (
        <TouchableOpacity
          onPress={onSetUpStripe}
          style={styles.setup}
          accessibilityRole="button"
          accessibilityLabel="Connect Stripe so clients can pay you"
          testID="money-home-card-setup"
        >
          <Text style={styles.setupText}>
            Connect Stripe so clients can pay you
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: 16,
      marginBottom: 16,
    },
    head: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    title: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 17,
      color: colors.textPrimary,
    },
    badge: {
      backgroundColor: colors.error,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 12,
    },
    badgeText: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 13,
      color: colors.textOnPrimary,
    },
    eyebrow: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 12,
      letterSpacing: 0.6,
      textTransform: "uppercase",
      color: colors.textSecondary,
    },
    amount: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 30,
      color: colors.textPrimary,
      marginVertical: 2,
    },
    sub: {
      fontFamily: "Inter_400Regular",
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    setup: { minHeight: 44, justifyContent: "center", marginTop: 8 },
    setupText: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 14,
      color: colors.primary,
    },
  });
