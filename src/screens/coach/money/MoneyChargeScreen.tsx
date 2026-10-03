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
import { coachMoneyApi } from "../../../api/coachMoneyApi";
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
      <View style={styles.centred} testID="money-charge-screen">
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

  return (
    <SafeAreaView style={styles.page} edges={["top"]}>
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
            {[
              c.packageName,
              cadenceLabel(c),
              shortDate(c.createdAt),
            ]
              .filter(Boolean)
              .join(", ")}
          </Text>
        </View>
        <Text style={styles.h2} accessibilityRole="header">
          How this adds up to your net
        </Text>
        <View style={styles.card} testID="money-charge-breakdown">
          {!d.settled ? (
            <Text style={styles.body} testID="money-charge-unsettled">
              This charge has not settled yet, so the fees are not final. Check
              back once the payment clears.
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
