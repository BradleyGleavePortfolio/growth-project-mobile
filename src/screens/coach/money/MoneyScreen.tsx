/**
 * S-COACH-MOB-2 — TGP Money, the coach's money page (owner 10-01 11:36:
 * "Money = a coach Home card that expands into full pages, Business metrics
 * merge into it"). Replaces the retired Earnings and Business metrics
 * screens; both old routes redirect here.
 *
 * Sections, each loaded from a live route and failing on its own:
 *   Net to you      /v1/coach/money/summary (Today / 30d / 90d / YTD with
 *                   change vs the previous period; tap for the breakdown)
 *   Needs attention /v1/coach/money/attention (failed payments with the
 *                   card-update state, disputes, Stripe requirements)
 *   Payouts         /coach/connect/payouts (next payout + recent)
 *   Business        summary.recurring (MRR, paying, churn, new) +
 *                   /coach/connect/metrics (roster counts)
 *   Recent charges  /v1/coach/money/charges (last 5, See all)
 *   Footer          Payout settings (Stripe Express dashboard), Packages
 * Every state is handled: loading, empty (no Stripe yet -> set up), error
 * with specific copy and a reference, offline (last numbers kept).
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as WebBrowser from "expo-web-browser";
import { useTheme, ThemeColors } from "../../../theme/ThemeProvider";
import {
  coachMoneyApi,
  MONEY_RANGES,
  nextPayout,
  type AttentionItem,
  type MoneyPayout,
  type MoneyRange,
  type MoneySummary,
} from "../../../api/coachMoneyApi";
import { coachSetupApi } from "../../../api/coachSetupApi";
import { connectCopy } from "../../../lib/coachSetup/connectCopy";
import {
  describeError,
  type FriendlyError,
} from "../../../lib/coachSetup/errors";
import {
  attentionCopy,
  breakdownRows,
  changeLine,
  chargeIsProblem,
  chargeStateLabel,
  money,
  PAYOUT_LABEL,
  RANGE_LABEL,
  shortDate,
} from "../../../lib/money/moneyCopy";
import { assertStripeUrl } from "../../../utils/stripeUrlValidator";
import { useNetworkStatus } from "../../../hooks/useNetworkStatus";
import SetupNotice from "../../../components/coach/setup/SetupNotice";
import KpiTile from "../../../components/command-center/KpiTile";
import AlertRow from "../../../components/command-center/AlertRow";
import type {
  CoachTabParamList,
  SettingsStackParamList,
} from "../../../navigation/CoachNavigator";
import { useSection } from "./useSection";
import { SafeAreaView } from "react-native-safe-area-context";
import MoneyBack from "./MoneyBack";

type Nav = NativeStackNavigationProp<SettingsStackParamList, "CoachMoney">;

export default function MoneyScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<Nav>();
  const { isOnline } = useNetworkStatus();
  const [range, setRange] = useState<MoneyRange>("30d");
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [dashError, setDashError] = useState<FriendlyError | null>(null);

  const summary = useSection(
    () => coachMoneyApi.summary(range),
    "load your Money numbers",
    [range],
  );
  const attention = useSection(
    () => coachMoneyApi.attention(),
    "load what needs your attention",
    [],
  );
  const charges = useSection(
    () => coachMoneyApi.charges("all", { limit: 5 }),
    "load your recent charges",
    [],
  );
  const payouts = useSection(
    () => coachMoneyApi.payouts(10),
    "load your payouts",
    [],
  );
  const roster = useSection(
    () => coachMoneyApi.roster(),
    "load your client numbers",
    [],
  );
  const connect = useSection(
    () => coachSetupApi.connectStatus(),
    "check your Stripe status",
    [],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      summary.reload(),
      attention.reload(),
      charges.reload(),
      payouts.reload(),
      roster.reload(),
      connect.reload(),
    ]);
    setRefreshing(false);
  }, [summary, attention, charges, payouts, roster, connect]);

  const tabNav =
    navigation.getParent<NativeStackNavigationProp<CoachTabParamList>>();
  const messageClient = (a: AttentionItem) => {
    if (!a.client) return;
    tabNav?.navigate("ClientsStack", {
      screen: "ClientMessages",
      params: { clientId: a.client.id, clientName: a.client.name },
    });
  };
  const openStripeSetup = () =>
    navigation.navigate("CoachSetup", { section: "get_paid" });

  const openPayoutSettings = async () => {
    setOpening(true);
    setDashError(null);
    try {
      const url = await coachMoneyApi.dashboardLink();
      assertStripeUrl(url, "MoneyScreen.payoutSettings");
      await WebBrowser.openBrowserAsync(url);
    } catch (err) {
      setDashError(describeError(err, "open your payout settings"));
    } finally {
      setOpening(false);
    }
  };

  const c = connect.data;
  const stripeActive = c?.state === "active";
  const s = summary.data;
  const noSalesYet =
    s !== null &&
    s.totals.chargeCount === 0 &&
    (charges.data?.charges.length ?? 0) === 0;
  const anyLoaded = [summary, attention, charges, payouts, connect].some(
    (x) => x.loadedAt !== null,
  );
  const firstLoad =
    !anyLoaded && [summary, connect].some((x) => x.loading) && isOnline;

  if (firstLoad) {
    return (
      <View style={styles.centred} testID="money-loading">
        <ActivityIndicator
          color={colors.primary}
          accessibilityLabel="Loading Money"
        />
      </View>
    );
  }

  const lastLoaded = summary.loadedAt
    ? new Date(summary.loadedAt).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <SafeAreaView style={styles.page} edges={["top"]}>
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.inner}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={colors.primary}
          />
        }
        testID="money-screen"
      >
        <MoneyBack />
        <Text style={styles.h1} accessibilityRole="header">
          Money
        </Text>

        {!isOnline ? (
          <View
            style={styles.offline}
            accessibilityRole="alert"
            testID="money-offline"
          >
            <Text style={styles.offlineTitle}>You are offline</Text>
            <Text style={styles.offlineBody}>
              {lastLoaded
                ? `These are the numbers from ${lastLoaded}. Pull down to refresh once you are back online.`
                : "Connect to the internet, then pull down to load your numbers."}
            </Text>
          </View>
        ) : null}

        {/* Stripe setup state: the setup action when payouts are not ready. */}
        {c && !stripeActive ? (
          <View style={styles.card} testID="money-setup">
            <Text style={styles.cardTitle}>{connectCopy(c).title}</Text>
            <Text style={styles.body}>{connectCopy(c).body}</Text>
            <TouchableOpacity
              style={styles.primary}
              onPress={openStripeSetup}
              accessibilityRole="button"
              accessibilityLabel={connectCopy(c).action ?? "Set up payouts"}
              testID="money-setup-open"
            >
              <Text style={styles.primaryText}>
                {connectCopy(c).action ?? "Set up payouts"}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {connect.error && !c ? (
          <SetupNotice
            error={connect.error}
            onRetry={() => void connect.reload()}
            testID="money-connect-error"
          />
        ) : null}

        {/* Net to you */}
        <View style={styles.card} testID="money-net">
          <View
            style={styles.chips}
            accessibilityRole="tablist"
            accessibilityLabel="Time period"
          >
            {MONEY_RANGES.map((r) => (
              <TouchableOpacity
                key={r}
                onPress={() => setRange(r)}
                style={[styles.chip, r === range && styles.chipOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: r === range }}
                accessibilityLabel={RANGE_LABEL[r]}
                testID={`money-range-${r}`}
              >
                <Text
                  style={[styles.chipText, r === range && styles.chipTextOn]}
                >
                  {RANGE_LABEL[r]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {summary.error && !s ? (
            <SetupNotice
              error={summary.error}
              onRetry={() => void summary.reload()}
              testID="money-summary-error"
            />
          ) : s ? (
            <NetBlock
              s={s}
              range={range}
              loading={summary.loading}
              open={showBreakdown}
              onToggle={() => setShowBreakdown((v) => !v)}
              styles={styles}
            />
          ) : (
            <ActivityIndicator
              color={colors.primary}
              accessibilityLabel="Loading net to you"
            />
          )}
          {noSalesYet ? (
            <View testID="money-empty">
              <Text style={styles.body}>
                {stripeActive
                  ? "No sales yet. Share your invite link so a client can buy your package."
                  : "No sales yet. Connect Stripe so clients can pay you, or start with a free package."}
              </Text>
              <TouchableOpacity
                onPress={() =>
                  stripeActive
                    ? navigation.navigate("CoachSetup", { section: "invite" })
                    : openStripeSetup()
                }
                style={styles.linkBtn}
                accessibilityRole="button"
                testID="money-empty-action"
              >
                <Text style={styles.link}>
                  {stripeActive ? "Share your invite link" : "Connect Stripe"}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        {/* Needs attention */}
        <Text style={styles.h2} accessibilityRole="header">
          Needs attention
          {attention.data && attention.data.count > 0
            ? ` (${attention.data.count})`
            : ""}
        </Text>
        {attention.error && !attention.data ? (
          <SetupNotice
            error={attention.error}
            onRetry={() => void attention.reload()}
            testID="money-attention-error"
          />
        ) : attention.data ? (
          attention.data.items.length === 0 ? (
            <Text style={styles.body} testID="money-attention-empty">
              Nothing needs you right now.
            </Text>
          ) : (
            attention.data.items.map((a) => {
              const copy = attentionCopy(a);
              const act =
                copy.action === "update_stripe"
                  ? openStripeSetup
                  : () => messageClient(a);
              return (
                <AlertRow
                  key={`${a.kind}-${a.id}`}
                  clientName={copy.title}
                  message={copy.lines.join(" ")}
                  messageLines={6}
                  actionLabel={
                    copy.action === "message_client" && !a.client
                      ? undefined
                      : copy.actionLabel
                  }
                  onPress={act}
                  testID={`money-attention-${a.kind}-${a.id}`}
                />
              );
            })
          )
        ) : (
          <ActivityIndicator
            color={colors.primary}
            accessibilityLabel="Loading what needs your attention"
          />
        )}

        {/* Payouts */}
        <Text style={styles.h2} accessibilityRole="header">
          Payouts
        </Text>
        <View style={styles.card} testID="money-payouts">
          {payouts.error && !payouts.data ? (
            <SetupNotice
              error={payouts.error}
              onRetry={() => void payouts.reload()}
              testID="money-payouts-error"
            />
          ) : payouts.data ? (
            <PayoutsBlock
              list={payouts.data}
              stripeActive={stripeActive}
              styles={styles}
            />
          ) : (
            <ActivityIndicator
              color={colors.primary}
              accessibilityLabel="Loading payouts"
            />
          )}
        </View>

        {/* Business (the old Business metrics, folded in) */}
        <Text style={styles.h2} accessibilityRole="header">
          Business
        </Text>
        {s ? (
          <View testID="money-business">
            <View style={styles.tiles}>
              <KpiTile
                label="Monthly recurring"
                value={money(s.recurring.mrrCents, s.currency)}
                testID="money-kpi-mrr"
              />
              <KpiTile
                label="Paying clients"
                value={s.recurring.payingClients}
                testID="money-kpi-paying"
              />
            </View>
            <View style={styles.tiles}>
              <KpiTile
                label="New paying, 30 days"
                value={s.recurring.newClients30d}
                testID="money-kpi-new"
              />
              <KpiTile
                label="Canceled, 30 days"
                value={s.recurring.churned30d}
                testID="money-kpi-churn"
              />
            </View>
            {roster.data ? (
              <View style={styles.tiles}>
                <KpiTile
                  label="Clients on your roster"
                  value={roster.data.rosterClients}
                  testID="money-kpi-roster"
                />
                <KpiTile
                  label="Joined, 30 days"
                  value={roster.data.joined30d}
                  testID="money-kpi-joined"
                />
              </View>
            ) : roster.error ? (
              <SetupNotice
                error={roster.error}
                onRetry={() => void roster.reload()}
                testID="money-roster-error"
              />
            ) : null}
            {roster.data &&
            (roster.data.team.acquired30d > 0 ||
              roster.data.team.churned30d > 0) ? (
              <View style={styles.tiles}>
                <KpiTile
                  label="Your team gained, 30 days"
                  value={roster.data.team.acquired30d}
                  testID="money-kpi-team-acquired"
                />
                <KpiTile
                  label="Your team lost, 30 days"
                  value={roster.data.team.churned30d}
                  testID="money-kpi-team-churned"
                />
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Recent charges */}
        <Text style={styles.h2} accessibilityRole="header">
          Recent charges
        </Text>
        <View style={styles.card} testID="money-charges">
          {charges.error && !charges.data ? (
            <SetupNotice
              error={charges.error}
              onRetry={() => void charges.reload()}
              testID="money-charges-error"
            />
          ) : charges.data ? (
            charges.data.charges.length === 0 ? (
              <Text style={styles.body}>No charges yet.</Text>
            ) : (
              charges.data.charges.map((ch) => (
                <TouchableOpacity
                  key={ch.id}
                  style={styles.row}
                  onPress={() =>
                    navigation.navigate("CoachMoneyCharge", { chargeId: ch.id })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`${ch.client.name}, ${ch.packageName}, ${money(
                    ch.amountCents,
                    ch.currency,
                  )}, ${chargeStateLabel(ch)}. Open the breakdown`}
                  testID={`money-charge-${ch.id}`}
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
                      style={[
                        styles.rowSub,
                        chargeIsProblem(ch) && styles.problem,
                      ]}
                    >
                      {chargeStateLabel(ch)}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))
            )
          ) : (
            <ActivityIndicator
              color={colors.primary}
              accessibilityLabel="Loading recent charges"
            />
          )}
          <TouchableOpacity
            onPress={() => navigation.navigate("CoachMoneyCharges", {})}
            style={styles.linkBtn}
            accessibilityRole="button"
            accessibilityLabel="See all charges"
            testID="money-charges-all"
          >
            <Text style={styles.link}>See all charges</Text>
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <View style={styles.footer} testID="money-footer">
          <TouchableOpacity
            onPress={() =>
              stripeActive ? void openPayoutSettings() : openStripeSetup()
            }
            disabled={opening}
            style={styles.footerRow}
            accessibilityRole="button"
            accessibilityLabel="Payout settings"
            accessibilityHint={
              stripeActive
                ? "Opens your Stripe payout dashboard"
                : "Opens Stripe setup. Payout settings open once Stripe has approved your account"
            }
            accessibilityState={{ busy: opening, disabled: opening }}
            testID="money-payout-settings"
          >
            <Text style={styles.footerText}>
              {opening ? "Opening payout settings" : "Payout settings"}
            </Text>
            {!stripeActive ? (
              <Text style={styles.rowSub}>Finish Stripe setup first</Text>
            ) : null}
          </TouchableOpacity>
          {dashError ? (
            <SetupNotice
              error={dashError}
              onRetry={() => void openPayoutSettings()}
              testID="money-payout-settings-error"
            />
          ) : null}
          <TouchableOpacity
            onPress={() => navigation.navigate("CoachPackagesList")}
            style={styles.footerRow}
            accessibilityRole="button"
            accessibilityLabel="Packages"
            testID="money-packages"
          >
            <Text style={styles.footerText}>Packages</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function NetBlock({
  s,
  range,
  loading,
  open,
  onToggle,
  styles,
}: {
  s: MoneySummary;
  range: MoneyRange;
  loading: boolean;
  open: boolean;
  onToggle: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  const change = changeLine(range, s.changeCents, s.changePct, s.currency);
  const rows = breakdownRows({
    priceCents: s.totals.grossCents,
    processingCents: s.totals.processingCents,
    platformFeeCents: s.totals.platformFeeCents,
    headCoachSplitCents: s.totals.headCoachSplitCents,
    refundedCents: s.totals.refundedCents,
    headCoachIncomeCents: s.totals.headCoachIncomeCents,
    netCents: s.totals.netCents,
    processingPaidBy: s.totals.processingPaidBy,
  });
  return (
    <View>
      <TouchableOpacity
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open, busy: loading }}
        accessibilityLabel={`Net to you, ${RANGE_LABEL[range]}: ${money(
          s.totals.netCents,
          s.currency,
        )}. ${change ?? ""}. ${open ? "Hide" : "Show"} how we got there`}
        testID="money-net-toggle"
      >
        <Text style={styles.eyebrow}>Net to you, {RANGE_LABEL[range]}</Text>
        <Text style={styles.hero} testID="money-net-amount">
          {money(s.totals.netCents, s.currency)}
        </Text>
        {change ? (
          <Text style={styles.rowSub} testID="money-net-change">
            {change}
          </Text>
        ) : null}
        <Text style={styles.link}>
          {open ? "Hide how we got there" : "How we got there"}
        </Text>
      </TouchableOpacity>
      {open ? (
        <View testID="money-net-breakdown">
          {rows.map((r) => (
            <View key={r.key} style={styles.bRow} accessible>
              <Text style={r.sign === 0 ? styles.bTotal : styles.bLabel}>
                {r.label}
              </Text>
              <Text style={r.sign === 0 ? styles.bTotal : styles.bLabel}>
                {r.sign < 0 ? "-" : ""}
                {money(r.cents, s.currency)}
              </Text>
              {r.note ? <Text style={styles.bNote}>{r.note}</Text> : null}
            </View>
          ))}
          <Text style={styles.bNote}>
            Counts sales made in this period, minus refunds and chargebacks on
            them.
          </Text>
        </View>
      ) : null}
      {s.heldFromNextSaleCents !== null && s.heldFromNextSaleCents > 0 ? (
        <View style={styles.held} testID="money-held">
          <Text style={styles.bLabel}>
            Held from your next sale:{" "}
            {money(s.heldFromNextSaleCents, s.currency)}
          </Text>
          <Text style={styles.bNote}>
            After a refund or chargeback, TGP keeps its 2% and the Stripe fees
            on that charge from your next sale, on top of that sale's usual
            fees.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function PayoutsBlock({
  list,
  stripeActive,
  styles,
}: {
  list: MoneyPayout[];
  stripeActive: boolean;
  styles: ReturnType<typeof makeStyles>;
}) {
  const next = nextPayout(list);
  if (list.length === 0) {
    return (
      <Text style={styles.body} testID="money-payouts-empty">
        {stripeActive
          ? "No payouts yet. Stripe sends your first payout a few days after your first sale."
          : "Payouts start once Stripe has approved your account."}
      </Text>
    );
  }
  return (
    <View>
      {next ? (
        <View testID="money-next-payout">
          <Text style={styles.eyebrow}>Next payout</Text>
          <Text style={styles.rowAmount}>
            {money(next.amountCents, next.currency)}
          </Text>
          <Text style={styles.rowSub}>
            {next.arrivalDate
              ? `Expected in your bank on ${shortDate(next.arrivalDate)}`
              : PAYOUT_LABEL[next.status]}
          </Text>
        </View>
      ) : null}
      {list.slice(0, 5).map((p) => (
        <View
          key={p.id}
          style={styles.row}
          accessible
          accessibilityLabel={`${money(p.amountCents, p.currency)}, ${PAYOUT_LABEL[p.status]}${
            p.arrivalDate ? `, ${shortDate(p.arrivalDate)}` : ""
          }`}
        >
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>
              {money(p.amountCents, p.currency)}
            </Text>
            {p.failureMessage ? (
              <Text style={[styles.rowSub, styles.problem]}>
                {p.failureMessage}
              </Text>
            ) : null}
          </View>
          <View style={styles.rowEnd}>
            <Text
              style={[
                styles.rowSub,
                (p.status === "failed" || p.status === "canceled") &&
                  styles.problem,
              ]}
            >
              {PAYOUT_LABEL[p.status]}
            </Text>
            <Text style={styles.rowSub}>{shortDate(p.arrivalDate) ?? ""}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    inner: { padding: 16, paddingBottom: 48 },
    centred: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.background,
    },
    h1: {
      fontFamily: "CormorantGaramond_400Regular",
      fontSize: 32,
      color: colors.textPrimary,
      marginBottom: 12,
    },
    h2: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 17,
      color: colors.textPrimary,
      marginTop: 20,
      marginBottom: 8,
    },
    card: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: 16,
      marginBottom: 12,
    },
    cardTitle: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 16,
      color: colors.textPrimary,
      marginBottom: 4,
    },
    body: {
      fontFamily: "Inter_400Regular",
      fontSize: 14,
      lineHeight: 20,
      color: colors.textSecondary,
      marginVertical: 6,
    },
    eyebrow: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 12,
      letterSpacing: 0.6,
      textTransform: "uppercase",
      color: colors.textSecondary,
    },
    hero: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 34,
      color: colors.textPrimary,
      marginVertical: 4,
    },
    chips: { flexDirection: "row", flexWrap: "wrap", marginBottom: 12 },
    chip: {
      minHeight: 44,
      paddingHorizontal: 12,
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
      marginRight: 8,
      marginBottom: 8,
    },
    chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: {
      fontFamily: "Inter_500Medium",
      fontSize: 14,
      color: colors.textPrimary,
    },
    chipTextOn: { color: colors.textOnPrimary },
    primary: {
      backgroundColor: colors.primary,
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 10,
    },
    primaryText: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 15,
      color: colors.textOnPrimary,
    },
    linkBtn: { minHeight: 44, justifyContent: "center" },
    link: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 14,
      color: colors.primary,
      marginTop: 6,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 56,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowText: { flex: 1, marginRight: 8 },
    rowEnd: { alignItems: "flex-end" },
    rowTitle: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 15,
      color: colors.textPrimary,
    },
    rowAmount: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 16,
      color: colors.textPrimary,
    },
    rowSub: {
      fontFamily: "Inter_400Regular",
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    problem: { color: colors.error },
    tiles: { flexDirection: "row", gap: 8, marginBottom: 8 },
    bRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      paddingVertical: 6,
    },
    bLabel: {
      fontFamily: "Inter_400Regular",
      fontSize: 14,
      color: colors.textPrimary,
    },
    bTotal: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 15,
      color: colors.textPrimary,
    },
    bNote: {
      width: "100%",
      fontFamily: "Inter_400Regular",
      fontSize: 12,
      lineHeight: 17,
      color: colors.textSecondary,
      marginTop: 2,
    },
    held: {
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    offline: {
      borderWidth: 1,
      borderColor: colors.warning,
      padding: 12,
      marginBottom: 12,
      backgroundColor: colors.surface,
    },
    offlineTitle: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 15,
      color: colors.textPrimary,
    },
    offlineBody: {
      fontFamily: "Inter_400Regular",
      fontSize: 14,
      lineHeight: 20,
      color: colors.textSecondary,
    },
    footer: { marginTop: 20 },
    footerRow: {
      minHeight: 52,
      justifyContent: "center",
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    footerText: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 15,
      color: colors.primary,
    },
  });
