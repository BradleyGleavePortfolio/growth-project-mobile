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
 *   Footer          Payout settings (Stripe Express dashboard), Export CSV
 *                   for taxes (/v1/coach/money/export.csv), Packages
 * A coach who sells in more than one currency switches currency; amounts in
 * different currencies are never added together (#641 B-641-3). Every
 * number is shown only under the period and currency it was loaded for
 * (B-332-1).
 * Every state is handled: loading, empty (no Stripe yet -> set up), error
 * with specific copy and a reference, offline (last numbers kept).
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
  windowsFor,
  type AttentionItem,
  type MoneyPayout,
  type MoneyRange,
  type MoneySummary,
} from "../../../api/coachMoneyApi";
import { coachSetupApi } from "../../../api/coachSetupApi";
import { connectCopy } from "../../../lib/coachSetup/connectCopy";
import {
  describeError,
  SUB_COACH_BILLING_BLOCKED,
  type FriendlyError,
} from "../../../lib/coachSetup/errors";
import { noteHeadCoachHandlesMoney } from "../../../lib/money/headCoachRole";
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
import { captureError } from "../../../services/sentry";
import { featureFlags } from "../../../config/featureFlags";
// §2.12 Roman payout notice, moved here from the deleted Earnings screen
// (C-332-2). Gated behind romanChat.
import RomanPayoutNotice from "../../../components/roman/RomanPayoutNotice";
import { assertStripeUrl } from "../../../utils/stripeUrlValidator";
import { useNetworkStatus } from "../../../hooks/useNetworkStatus";
import SetupNotice from "../../../components/coach/setup/SetupNotice";
import { CsvFileError, shareCsvFile } from "../../../lib/money/csvFile";
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

/** Specific copy for a CSV that could not be saved or shared (OR-114-4). */
export function csvFileFailure(err: CsvFileError): FriendlyError {
  return err.reason === "write"
    ? {
        title: "Your CSV could not be saved on this phone",
        body: "Free up some space on the phone, then export again.",
        requestId: null,
        code: "MONEY_CSV_WRITE_FAILED",
        retryable: true,
      }
    : {
        title: "The share sheet did not open",
        body: "Close any other share sheet that is open, then export again.",
        requestId: null,
        code: "MONEY_CSV_SHARE_FAILED",
        retryable: true,
      };
}

export default function MoneyScreen({
  route,
}: {
  route?: { params?: SettingsStackParamList["CoachMoney"] };
} = {}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<Nav>();
  // B-332-7: the navigator passes the route; Back returns to Home when the
  // Home card opened this page.
  const fromHome = route?.params?.from === "home";
  const { isOnline } = useNetworkStatus();
  const [range, setRange] = useState<MoneyRange>("30d");
  // null = the server's default currency (USD when the coach has any).
  const [currency, setCurrency] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<FriendlyError | null>(null);
  const [exportedAsText, setExportedAsText] = useState(false);
  // An export that finishes after the screen closed (sign-out swaps the
  // stack) or after a newer export started never opens a share sheet or
  // writes state: the CSV belongs to the session that asked for it.
  const mountedRef = useRef(true);
  const exportEpoch = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [dashError, setDashError] = useState<FriendlyError | null>(null);

  // B-332-1: every summary is tagged with the period and currency it was
  // loaded for. Numbers are shown only under their own period's name; a
  // slow or failed switch never relabels the previous period's money.
  const summary = useSection(
    async () => ({
      range,
      currency,
      summary: await coachMoneyApi.summary(range, { currency }),
    }),
    "load your Money numbers",
    [range, currency],
  );
  // B-332-4 (Sol): the currencies this coach has, remembered from the last
  // summary that loaded, so a failed or slow currency switch never removes
  // the way back to a currency that works.
  const [knownCurrencies, setKnownCurrencies] = useState<{
    list: string[];
    serverDefault: string | null;
  }>({ list: [], serverDefault: null });
  const loadedSummary = summary.data;
  useEffect(() => {
    if (!loadedSummary) return;
    const sm = loadedSummary.summary;
    setKnownCurrencies((prev) => ({
      list: sm.currencies.length > 0 ? sm.currencies : prev.list,
      serverDefault:
        loadedSummary.currency === null ? sm.currency : prev.serverDefault,
    }));
  }, [loadedSummary]);
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

  // The newest payout Stripe has put in the bank, for the Roman notice.
  const lastPaid =
    payouts.data
      ?.filter((p) => p.status === "paid" && p.arrivalDate)
      .sort(
        (a, b) =>
          Date.parse(b.arrivalDate as string) -
          Date.parse(a.arrivalDate as string),
      )[0] ?? null;
  const c = connect.data;
  const stripeActive = c?.state === "active";
  const tagged = summary.data;
  // The summary for exactly the period and currency on screen, or null.
  const s =
    tagged && tagged.range === range && tagged.currency === currency
      ? tagged.summary
      : null;
  // Business figures (MRR, paying, new, canceled) do not depend on the
  // period, so the last summary in the same currency can show them.
  const business =
    s ?? (tagged && tagged.currency === currency ? tagged.summary : null);
  const currencies =
    business && business.currencies.length > 0
      ? business.currencies
      : knownCurrencies.list;
  const shownCurrency = business?.currency ?? null;
  // The chip that is selected: the requested currency, else the one the
  // server chose by default.
  const selectedCurrency =
    currency ?? shownCurrency ?? knownCurrencies.serverDefault;
  // C-332-11 (Opus): "No sales yet" only when the charges list actually
  // loaded and is empty, never while it loads or after it failed.
  const noSalesYet =
    s !== null &&
    s.totals.chargeCount === 0 &&
    charges.data !== null &&
    charges.error === null &&
    charges.data.charges.length === 0;
  // B-332-9 (Opus): an active sub-coach's money is the head coach's. Once
  // any section says so, the page shows that once, with no sections, no
  // payout settings and no export.
  const headCoachHandles = [
    summary,
    attention,
    charges,
    payouts,
    roster,
    connect,
  ].some((x) => x.error?.code === SUB_COACH_BILLING_BLOCKED);
  const summaryLoaded = summary.data !== null;
  useEffect(() => {
    if (headCoachHandles) noteHeadCoachHandlesMoney(true);
    else if (summaryLoaded) noteHeadCoachHandlesMoney(false);
  }, [headCoachHandles, summaryLoaded]);
  const anyLoaded = [summary, attention, charges, payouts, connect].some(
    (x) => x.loadedAt !== null,
  );
  const firstLoad =
    !anyLoaded && [summary, connect].some((x) => x.loading) && isOnline;

  if (headCoachHandles) {
    return (
      <SafeAreaView ph-no-capture style={styles.page} edges={["top"]}>
        <ScrollView
          style={styles.page}
          contentContainerStyle={styles.inner}
          testID="money-screen"
        >
          <MoneyBack toHome={fromHome} />
          <Text style={styles.h1} accessibilityRole="header">
            Money
          </Text>
          <View
            style={styles.card}
            testID="money-head-coach"
            accessible
            accessibilityLabel="Money is handled by your head coach. Their practice takes payments and receives payouts for the clients you coach. Ask your head coach about payments."
          >
            <Text style={styles.rowTitle}>
              Money is handled by your head coach
            </Text>
            <Text style={styles.body}>
              Your head coach&apos;s practice takes payments and receives
              payouts for the clients you coach. Ask your head coach about
              payments.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (firstLoad) {
    return (
      <View ph-no-capture style={styles.centred} testID="money-loading">
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

  // C-332-4 / C-641-4 / OR-114-4: the selected period, in the selected
  // currency, as the server's tax CSV, handed to the share sheet as a real
  // .csv file (lib/money/csvFile.ts). Only where the system cannot share
  // files does it go out as text, and the screen says so.
  const exportCsv = async () => {
    const epoch = ++exportEpoch.current;
    const current = () => mountedRef.current && exportEpoch.current === epoch;
    setExporting(true);
    setExportError(null);
    setExportedAsText(false);
    try {
      const w = windowsFor(range, new Date());
      const out = await coachMoneyApi.exportCsv(
        { from: w.from, to: w.to },
        currency ?? shownCurrency,
      );
      if (!current()) return;
      const how = await shareCsvFile(out.csv, out.filename);
      if (current()) setExportedAsText(how === "text");
    } catch (err) {
      if (!current()) return;
      if (err instanceof CsvFileError) {
        setExportError(csvFileFailure(err));
        captureError(err, {
          area: "coach_money",
          action: `export_csv_${err.reason}`,
        });
      } else {
        setExportError(describeError(err, "export your money as a CSV file"));
        if (!(err as { response?: unknown } | null)?.response)
          captureError(err, { area: "coach_money", action: "export_csv" });
      }
    } finally {
      if (current()) setExporting(false);
    }
  };

  return (
    <SafeAreaView ph-no-capture style={styles.page} edges={["top"]}>
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
        <MoneyBack toHome={fromHome} />
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
          {currencies.length > 1 ? (
            <View
              style={styles.chips}
              accessibilityRole="tablist"
              accessibilityLabel="Currency"
              testID="money-currencies"
            >
              {currencies.map((cur) => {
                const on = cur === selectedCurrency;
                return (
                  <TouchableOpacity
                    key={cur}
                    onPress={() => setCurrency(cur)}
                    style={[styles.chip, on && styles.chipOn]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`Show amounts in ${cur.toUpperCase()}`}
                    testID={`money-currency-${cur}`}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>
                      {cur.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
          {s ? (
            <>
              <NetBlock
                s={s}
                range={range}
                loading={summary.loading}
                open={showBreakdown}
                onToggle={() => setShowBreakdown((v) => !v)}
                styles={styles}
              />
              {summary.error ? (
                <View testID="money-summary-stale">
                  <Text style={styles.bNote}>
                    {lastLoaded
                      ? `These are the numbers from ${lastLoaded}. They could not be refreshed.`
                      : "These numbers could not be refreshed."}
                  </Text>
                  <SetupNotice
                    error={summary.error}
                    onRetry={() => void summary.reload()}
                    testID="money-summary-error"
                  />
                </View>
              ) : null}
            </>
          ) : summary.error ? (
            <View testID="money-summary-failed">
              <Text style={styles.eyebrow}>
                Net to you, {RANGE_LABEL[range]}
              </Text>
              <SetupNotice
                error={summary.error}
                onRetry={() => void summary.reload()}
                testID="money-summary-error"
              />
            </View>
          ) : (
            <ActivityIndicator
              color={colors.primary}
              accessibilityLabel={`Loading net to you, ${RANGE_LABEL[range]}`}
              testID="money-summary-loading"
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
            <>
              {featureFlags.romanChat &&
              lastPaid != null &&
              shortDate(lastPaid.arrivalDate) ? (
                <RomanPayoutNotice
                  amount={money(lastPaid.amountCents, lastPaid.currency)}
                  sentOn={shortDate(lastPaid.arrivalDate) as string}
                  mode="default"
                  testID="roman-payout-card"
                />
              ) : null}
              <PayoutsBlock
                list={payouts.data}
                stripeActive={stripeActive}
                styles={styles}
              />
            </>
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
        {business ? (
          <View testID="money-business">
            {summary.error && lastLoaded ? (
              // C-332-6: kept from an earlier load; say when.
              <Text style={styles.bNote} testID="money-business-stale">
                {`These are the numbers from ${lastLoaded}. They could not be refreshed.`}
              </Text>
            ) : null}
            <View style={styles.tiles}>
              <KpiTile
                label="Monthly recurring"
                value={money(business.recurring.mrrCents, business.currency)}
                testID="money-kpi-mrr"
              />
              <KpiTile
                label="Paying clients"
                value={business.recurring.payingClients}
                testID="money-kpi-paying"
              />
            </View>
            <View style={styles.tiles}>
              <KpiTile
                label="New paying, 30 days"
                value={business.recurring.newClients30d}
                testID="money-kpi-new"
              />
              <KpiTile
                label="Canceled, 30 days"
                value={business.recurring.churned30d}
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
            onPress={() => void exportCsv()}
            disabled={exporting}
            style={styles.footerRow}
            accessibilityRole="button"
            accessibilityLabel={`Export CSV for taxes, ${RANGE_LABEL[range]}`}
            accessibilityHint="Sales, refunds and chargebacks for the selected period, ready for your accountant"
            accessibilityState={{ busy: exporting, disabled: exporting }}
            testID="money-export-csv"
          >
            <Text style={styles.footerText}>
              {exporting ? "Preparing your CSV" : "Export CSV for taxes"}
            </Text>
            <Text style={styles.rowSub}>
              {RANGE_LABEL[range]}
              {shownCurrency ? `, ${shownCurrency.toUpperCase()}` : ""}
            </Text>
          </TouchableOpacity>
          {exportError ? (
            <SetupNotice
              error={exportError}
              onRetry={() => void exportCsv()}
              testID="money-export-csv-error"
            />
          ) : null}
          {exportedAsText && !exportError ? (
            <Text
              style={styles.rowSub}
              accessibilityLiveRegion="polite"
              testID="money-export-csv-text"
            >
              This device cannot attach files from TGP, so the CSV was shared as
              text. Paste it into a spreadsheet, or export again on a phone that
              can share files.
            </Text>
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
        )}. ${change ?? ""}. ${open ? "Hide" : "Show"} how this adds up`}
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
          {open ? "Hide how this adds up" : "How this adds up"}
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
            Counts sales made in this period, minus refunds and chargebacks made
            in this period, including those on earlier sales.
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
