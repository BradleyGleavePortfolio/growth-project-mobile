/**
 * S-COACH — first package, prefilled. Matches backend #629: a package is
 * free (one-time, $0) or paid at $19.99 or more. Creates the package, makes
 * it live, and for a free package attaches it to the coach's invite link so
 * a client who joins with the link gets it straight away.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
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
  type PackageCreateInput,
} from "../../../api/packagesApi";
import { coachSetupApi } from "../../../api/coachSetupApi";
import {
  describeError,
  type FriendlyError,
} from "../../../lib/coachSetup/errors";
import {
  clearIntent,
  createPackageOnce,
  intentStorageCopy,
  IntentStorageError,
  isDefinitiveRejection,
  loadIntent,
  type PackageCreateIntent,
} from "../../../lib/coachSetup/packageCreateIntent";
import { useCurrentUser } from "../../../hooks/useCurrentUser";
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

// Shared with the package editor (B-329-1); re-exported for existing callers.
export { isDefinitiveRejection };

/** Specific copy when device storage could not hold the create's identity. */
export function storageFailure(err: IntentStorageError): FriendlyError {
  const copy = intentStorageCopy(err);
  return {
    ...copy,
    requestId: null,
    code: `PACKAGE_INTENT_${err.reason.toUpperCase()}`,
    retryable: true,
  };
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
  // B-329-1 / OR-112-16: one create attempt = one Idempotency-Key + one
  // body, written to device storage before it is sent and re-sent unchanged
  // on every retry (second tap, timeout, app restart). The backend replays
  // the package that key created, and a retry that arrives while the first
  // try is still running waits for it, so a retry can never make a second
  // package. See lib/coachSetup/packageCreateIntent.ts.
  const user = useCurrentUser();
  const coachId = user?.id ?? null;
  const intent = useRef<PackageCreateIntent | null>(null);
  const hydrated = useRef<Promise<void> | null>(null);
  const [resumed, setResumed] = useState(false);
  // A second tap before React re-renders the disabled button must not
  // start a second submit.
  const inFlight = useRef(false);

  // The account this form belongs to, for re-checks after every await: a
  // sign-out or account switch mid-create must not write into the next
  // account's form or storage.
  const coachRef = useRef(coachId);
  coachRef.current = coachId;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    hydrated.current = loadIntent(coachId).then((read) => {
      if (!live || read.kind !== "found" || intent.current) return;
      const stored = read.intent;
      intent.current = stored;
      // Show the coach the package that was on its way, as it was sent.
      setTitle(stored.input.title);
      setFree(stored.input.priceCents === 0);
      if (stored.input.priceCents > 0)
        setPriceText((stored.input.priceCents / 100).toFixed(2));
      setMonthly(stored.input.billingInterval !== "one_time");
      setResumed(true);
    });
    return () => {
      live = false;
    };
  }, [coachId]);

  const submit = async () => {
    const problem = validatePackage({ title, free, priceText });
    setInvalid(problem);
    setError(null);
    if (problem || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const owner = coachId;
    const stillOwner = () => mounted.current && coachRef.current === owner;
    const priceCents = free ? 0 : (parsePriceCents(priceText) ?? 0);
    const billingInterval: PackageBillingInterval =
      free || !monthly ? "one_time" : "monthly";
    const input: PackageCreateInput = {
      title: title.trim(),
      description: defaultDescription ?? null,
      priceCents,
      currency: "usd",
      billingInterval,
      intervalCount: 1,
      trialDays: 0,
      features: [],
    };
    try {
      if (hydrated.current) await hydrated.current;
      let earlier = intent.current;
      if (!earlier) {
        // B-329-1: read storage again before any fresh create. A failed read
        // is not "nothing was sent": stop with specific copy instead.
        const read = await loadIntent(owner);
        if (read.kind === "unreadable")
          throw new IntentStorageError("unreadable");
        if (read.kind === "no_account")
          throw new IntentStorageError("no_account");
        if (read.kind === "found") earlier = read.intent;
      }
      if (!stillOwner()) return;
      const { packageId } = await createPackageOnce({
        coachId: owner,
        scope: "wizard",
        input,
        earlier,
        deps: {
          create: (body, key) => coachPackagesApi.create(body, key),
          update: (id, body) => coachPackagesApi.update(id, body),
        },
        onIntent: (next) => {
          if (coachRef.current === owner) intent.current = next;
        },
      });
      if (!stillOwner()) return;
      await coachSetupApi.publishPackage(packageId);
      let freeOnJoin = false;
      if (priceCents === 0) {
        const invite = await coachSetupApi.inviteLink();
        await coachSetupApi.bindFreePackage(invite.code, packageId);
        freeOnJoin = true;
      }
      if (!stillOwner()) return;
      intent.current = null;
      await clearIntent(owner);
      setResumed(false);
      onCreated({
        id: packageId,
        title: input.title,
        priceCents,
        billingInterval,
        freeOnJoin,
      });
    } catch (err) {
      if (!stillOwner()) return;
      setError(
        err instanceof IntentStorageError
          ? storageFailure(err)
          : describeError(err, "create your package"),
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <View testID={testID}>
      {resumed ? (
        <Text style={styles.help} testID={`${testID}-resumed`}>
          Your package from earlier is saved here. Tap Create package to finish
          it. It will not be made twice.
        </Text>
      ) : null}
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
        onPress={() => {
          void submit();
        }}
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
