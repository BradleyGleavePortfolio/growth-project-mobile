/**
 * PlanTermsBlock — the terms a client reads before paying, shared by every
 * package-selling surface: price and interval, what is charged today
 * (including any one-time part), the trial length and the date of the first
 * charge, and that the plan can be canceled anytime in the app.
 */
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../theme/ThemeProvider";
import type { SemanticTokens } from "../../theme/tokens";
import { planTerms, type PurchasablePackage } from "../../lib/planTerms";

export default function PlanTermsBlock({
  pkg,
  now,
  testID = "plan-terms",
}: {
  pkg: PurchasablePackage;
  now?: Date;
  testID?: string;
}) {
  const { semanticColors } = useTheme();
  const styles = useMemo(() => makeStyles(semanticColors), [semanticColors]);
  const terms = planTerms(pkg, now);
  return (
    <View style={styles.wrap} testID={testID} accessibilityRole="summary">
      <Text style={styles.price} testID={`${testID}-price`}>
        {terms.price}
      </Text>
      <Text style={styles.line} testID={`${testID}-first-charge`}>
        {terms.firstCharge}
      </Text>
      {terms.renewal ? (
        <Text style={styles.line} testID={`${testID}-renewal`}>
          {terms.renewal}
        </Text>
      ) : null}
    </View>
  );
}

const makeStyles = (c: SemanticTokens) =>
  StyleSheet.create({
    wrap: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      paddingTop: 12,
      marginTop: 4,
      marginBottom: 12,
      gap: 6,
    },
    price: {
      fontFamily: "Inter_500Medium",
      fontSize: 15,
      color: c.textPrimary,
    },
    line: {
      fontFamily: "Inter_400Regular",
      fontSize: 13,
      lineHeight: 19,
      color: c.textMuted,
    },
  });
