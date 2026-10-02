/**
 * S-COACH — first package, prefilled. Matches backend #629: a package is
 * free (one-time, $0) or paid at $19.99 or more. Creates the package, makes
 * it live, and for a free package attaches it to the coach's invite link so
 * a client who joins with the link gets it straight away.
 */
import React, { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useTheme, ThemeColors } from "../../../theme/ThemeProvider";
import {
  coachPackagesApi,
  type PackageBillingInterval,
} from "../../../api/packagesApi";
import { coachSetupApi } from "../../../api/coachSetupApi";
import {
  describeError,
  type FriendlyError,
} from "../../../lib/coachSetup/errors";
import { generateIdempotencyKey } from "../../../utils/idempotency";
import SetupNotice from "./SetupNotice";

export const PAID_PACKAGE_MIN_CENTS = 1999;

export interface CreatedPackage {
  id: string;
  title: string;
  priceCents: number;
  billingInterval: PackageBillingInterval;
  freeOnJoin: boolean;
}

/** Parse "49", "49.5", "$49.00" into cents; null when it is not a price. */
export function parsePriceCents(text: string): number | null {
  const t = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

/** Client-side check that mirrors the server rule. Exported for tests. */
export function validatePackage(input: {
  title: string;
  free: boolean;
  priceText: string;
}): string | null {
  if (!input.title.trim())
    return "Give the package a name clients will recognise.";
  if (input.free) return null;
  const cents = parsePriceCents(input.priceText);
  if (cents === null) return "Enter a price in dollars, for example 49.00.";
  if (cents < PAID_PACKAGE_MIN_CENTS)
    return "Paid packages start at $19.99, or make it free.";
  return null;
}

interface Props {
  defaultTitle: string;
  defaultDescription?: string | null;
  chargesEnabled: boolean;
  onCreated: (pkg: CreatedPackage) => void;
  testID?: string;
}

export default function FirstPackageForm({
  defaultTitle,
  defaultDescription,
  chargesEnabled,
  onCreated,
  testID = "first-package",
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [title, setTitle] = useState(defaultTitle);
  const [free, setFree] = useState(false);
  const [priceText, setPriceText] = useState("49.00");
  const [monthly, setMonthly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  // One key per attempt so a double tap or a retry after a timeout cannot
  // create two packages.
  const idemKey = useRef(generateIdempotencyKey());

  const submit = async () => {
    const problem = validatePackage({ title, free, priceText });
    setInvalid(problem);
    setError(null);
    if (problem) return;
    setBusy(true);
    const priceCents = free ? 0 : (parsePriceCents(priceText) ?? 0);
    const billingInterval: PackageBillingInterval =
      free || !monthly ? "one_time" : "monthly";
    try {
      const res = await coachPackagesApi.create(
        {
          title: title.trim(),
          description: defaultDescription ?? null,
          priceCents,
          currency: "usd",
          billingInterval,
          intervalCount: 1,
          trialDays: 0,
          features: [],
        },
        idemKey.current,
      );
      const pkg = res.data;
      await coachSetupApi.publishPackage(pkg.id);
      let freeOnJoin = false;
      if (priceCents === 0) {
        const invite = await coachSetupApi.inviteLink();
        await coachSetupApi.bindFreePackage(invite.code, pkg.id);
        freeOnJoin = true;
      }
      onCreated({
        id: pkg.id,
        title: pkg.title,
        priceCents,
        billingInterval,
        freeOnJoin,
      });
    } catch (err) {
      setError(describeError(err, "create your package"));
      idemKey.current = generateIdempotencyKey();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View testID={testID}>
      <Text style={styles.label} nativeID={`${testID}-name-label`}>
        Package name
      </Text>
      <TextInput
        value={title}
        onChangeText={setTitle}
        style={styles.input}
        accessibilityLabel="Package name"
        accessibilityLabelledBy={`${testID}-name-label`}
        maxLength={80}
        testID={`${testID}-title`}
      />
      <View
        style={styles.segment}
        accessibilityRole="radiogroup"
        accessibilityLabel="Price type"
      >
        {[
          { key: "paid", label: "Paid", on: !free },
          { key: "free", label: "Free", on: free },
        ].map((o) => (
          <TouchableOpacity
            key={o.key}
            onPress={() => setFree(o.key === "free")}
            style={[styles.segmentItem, o.on && styles.segmentOn]}
            accessibilityRole="radio"
            accessibilityState={{ checked: o.on }}
            accessibilityLabel={o.label}
            testID={`${testID}-${o.key}`}
          >
            <Text style={[styles.segmentText, o.on && styles.segmentTextOn]}>
              {o.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {free ? (
        <Text style={styles.help}>
          Free packages are one-time. A client who joins with your invite link
          gets it straight away.
        </Text>
      ) : (
        <>
          <Text style={styles.label} nativeID={`${testID}-price-label`}>
            Price in US dollars
          </Text>
          <TextInput
            value={priceText}
            onChangeText={setPriceText}
            style={styles.input}
            keyboardType="decimal-pad"
            accessibilityLabel="Price in US dollars"
            accessibilityHint="Paid packages start at 19 dollars 99"
            testID={`${testID}-price`}
          />
          <View
            style={styles.segment}
            accessibilityRole="radiogroup"
            accessibilityLabel="How often clients pay"
          >
            {[
              { key: "monthly", label: "Every month", on: monthly },
              { key: "once", label: "One time", on: !monthly },
            ].map((o) => (
              <TouchableOpacity
                key={o.key}
                onPress={() => setMonthly(o.key === "monthly")}
                style={[styles.segmentItem, o.on && styles.segmentOn]}
                accessibilityRole="radio"
                accessibilityState={{ checked: o.on }}
                accessibilityLabel={o.label}
                testID={`${testID}-${o.key}`}
              >
                <Text
                  style={[styles.segmentText, o.on && styles.segmentTextOn]}
                >
                  {o.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.help}>
            Paid packages start at $19.99. You keep the price minus Stripe
            processing and the TGP 2% fee.
            {chargesEnabled
              ? ""
              : " Clients can buy it once Stripe has approved your account."}
          </Text>
        </>
      )}
      {invalid ? (
        <Text
          style={styles.invalid}
          accessibilityRole="alert"
          testID={`${testID}-invalid`}
        >
          {invalid}
        </Text>
      ) : null}
      {error ? (
        <SetupNotice
          error={error}
          onRetry={submit}
          testID={`${testID}-error`}
        />
      ) : null}
      <TouchableOpacity
        style={[styles.primary, busy && styles.disabled]}
        onPress={submit}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Create package"
        accessibilityState={{ busy, disabled: busy }}
        testID={`${testID}-create`}
      >
        {busy ? (
          <ActivityIndicator color={colors.textOnPrimary} />
        ) : (
          <Text style={styles.primaryText}>Create package</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    label: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 12,
      marginBottom: 6,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      minHeight: 48,
      paddingHorizontal: 12,
      fontFamily: "Inter_400Regular",
      fontSize: 16,
      color: colors.textPrimary,
      backgroundColor: colors.surface,
    },
    segment: {
      flexDirection: "row",
      marginTop: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    segmentItem: {
      flex: 1,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    segmentOn: { backgroundColor: colors.primary },
    segmentText: {
      fontFamily: "Inter_500Medium",
      fontSize: 14,
      color: colors.textPrimary,
    },
    segmentTextOn: { color: colors.textOnPrimary },
    help: {
      fontFamily: "Inter_400Regular",
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
      marginTop: 10,
    },
    invalid: {
      fontFamily: "Inter_500Medium",
      fontSize: 14,
      color: colors.error,
      marginTop: 10,
    },
    primary: {
      backgroundColor: colors.primary,
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 16,
    },
    disabled: { opacity: 0.6 },
    primaryText: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 15,
      color: colors.textOnPrimary,
    },
  });
