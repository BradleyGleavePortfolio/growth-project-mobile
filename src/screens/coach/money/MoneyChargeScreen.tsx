/**
 * S-COACH-MOB-2 — one charge, with how the price became the coach's net:
 * price - card processing - TGP 2% (- head coach share - refunds) = net
 * (GET /v1/coach/money/charges/:id; another coach's id is a 404 with
 * MONEY_CHARGE_NOT_FOUND and gets specific copy).
 */
import React, { useMemo } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../../../theme/ThemeProvider";
import { coachMoneyApi, type ChargeState } from "../../../api/coachMoneyApi";
import {
  breakdownRows,
  cadenceLabel,
  chargeIsProblem,
  chargeStateLabel,
  money,
  shortDate,
} from "../../../lib/money/moneyCopy";
import SetupNotice from "../../../components/coach/setup/SetupNotice";
import type {
  CoachTabParamList,
  SettingsStackParamList,
} from "../../../navigation/CoachNavigator";
import { makeStyles } from "./MoneyScreen";
import { useSection } from "./useSection";
import { SafeAreaView } from "react-native-safe-area-context";
import MoneyBack from "./MoneyBack";

type Props = NativeStackScreenProps<SettingsStackParamList, "CoachMoneyCharge">;

/**
 * B-332-8 (Opus): what happened for a charge that moved no money, or null
 * when money moved (paid, refunded, disputed) or is still moving (pending).
 */
export function noMoneyMovedCopy(state: ChargeState | null): string | null {
  switch (state) {
    case "failed":
      return "The card payment did not go through, so the client was not charged and nothing from this charge reaches your payouts. Needs attention on Money shows whether TGP tries the card again.";
    case "canceled":
      return "The client started checkout but did not finish it, so nothing was charged.";
    default:
      return null;
  }
}

export default function MoneyChargeScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const id = route.params.chargeId;
  const detail = useSection(
    () => coachMoneyApi.charge(id),
    "load this charge",
    [id],
  );
  const d = detail.data;

  if (!d) {
    return (
      <View ph-no-capture style={styles.centred} testID="money-charge-screen">
        {detail.error ? (
          <View style={styles.inner}>
            <SetupNotice
              error={detail.error}
              onRetry={() => void detail.reload()}
              testID="money-charge-error"
            />
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.linkBtn}
              accessibilityRole="button"
              testID="money-charge-back"
            >
              <Text style={styles.link}>Back to Money</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ActivityIndicator
            color={colors.primary}
            accessibilityLabel="Loading this charge"
          />
        )}
      </View>
    );
  }

  const c = d.charge;
  const rows = breakdownRows({
    priceCents: d.priceCents,
    processingCents: d.processingCents,
    platformFeeCents: d.platformFeeCents,
    headCoachSplitCents: d.headCoachSplitCents,
    refundedCents: d.refundedCents,
    netCents: d.netCents,
    processingPaidBy: d.processingPaidBy,
  });
  const tabNav =
    navigation.getParent<NativeStackNavigationProp<CoachTabParamList>>();
  // B-332-8 (Opus): a failed payment or an unfinished checkout moved no
  // money, so it never shows "Clients paid" or "check back once it clears".
  const noMoney = noMoneyMovedCopy(c.state);
  const pending = c.state === "pending";

  return (
    <SafeAreaView ph-no-capture style={styles.page} edges={["top"]}>
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.inner}
        testID="money-charge-screen"
      >
        <MoneyBack />
        <Text style={styles.h1} accessibilityRole="header">
          {money(c.amountCents, c.currency)}
        </Text>
        <Text style={[styles.rowSub, chargeIsProblem(c) && styles.problem]}>
          {chargeStateLabel(c)}
        </Text>
        <View style={styles.card}>
          <Text style={styles.rowTitle}>{c.client.name}</Text>
          <Text style={styles.rowSub} testID="money-charge-meta">
            {[c.packageName, cadenceLabel(c), shortDate(c.createdAt)]
              .filter(Boolean)
              .join(", ")}
          </Text>
        </View>
        {noMoney ? (
          <View style={styles.card} testID="money-charge-no-money">
            <Text style={styles.rowTitle}>No money moved</Text>
            <Text style={styles.body}>{noMoney}</Text>
          </View>
        ) : null}
        {noMoney ? null : (
          <Text style={styles.h2} accessibilityRole="header">
            How this adds up to your net
          </Text>
        )}
        {noMoney ? null : (
          <View style={styles.card} testID="money-charge-breakdown">
            {!d.settled && pending ? (
              <Text style={styles.body} testID="money-charge-unsettled">
                This charge has not settled yet, so the fees are not final.
                Check back once the payment clears.
              </Text>
            ) : null}
            {!d.settled && !pending ? (
              <Text style={styles.body} testID="money-charge-fees-pending">
                Stripe has not posted the fees for this charge yet, so the
                amounts below are not final.
              </Text>
            ) : null}
            {rows.map((r) => (
              <View
                key={r.key}
                style={styles.bRow}
                accessible
                accessibilityLabel={`${r.label}: ${r.sign < 0 ? "minus " : ""}${money(
                  r.cents,
                  c.currency,
                )}`}
              >
                <Text style={r.sign === 0 ? styles.bTotal : styles.bLabel}>
                  {r.label}
                </Text>
                <Text style={r.sign === 0 ? styles.bTotal : styles.bLabel}>
                  {r.sign < 0 ? "-" : ""}
                  {money(r.cents, c.currency)}
                </Text>
                {r.note ? <Text style={styles.bNote}>{r.note}</Text> : null}
              </View>
            ))}
          </View>
        )}
        {c.client.id ? (
          <TouchableOpacity
            onPress={() =>
              tabNav?.navigate("ClientsStack", {
                screen: "ClientMessages",
                params: { clientId: c.client.id, clientName: c.client.name },
              })
            }
            style={styles.primary}
            accessibilityRole="button"
            accessibilityLabel={`Message ${c.client.name}`}
            testID="money-charge-message"
          >
            <Text style={styles.primaryText}>Message {c.client.name}</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
