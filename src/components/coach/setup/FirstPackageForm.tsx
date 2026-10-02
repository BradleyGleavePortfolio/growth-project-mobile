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
  type CoachPackage,
  type PackageBillingInterval,
  type PackageCreateInput,
} from "../../../api/packagesApi";
import { coachSetupApi } from "../../../api/coachSetupApi";
import {
  describeError,
  type FriendlyError,
} from "../../../lib/coachSetup/errors";
import { generateIdempotencyKey } from "../../../utils/idempotency";
import { errorStatus } from "../../../types/common";
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

interface PendingCreate {
  input: PackageCreateInput;
  /** Device time the create was sent; bounds the lookup without a snapshot. */
  startedAt: number;
}

/** A 4xx (other than 408 / 409 / 429) means the server did not create it. */
export function isDefinitiveRejection(err: unknown): boolean {
  const status = errorStatus(err);
  return (
    status !== undefined &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 409 &&
    status !== 429
  );
}

function sameInput(pkg: CoachPackage, input: PackageCreateInput): boolean {
  return (
    pkg.title.trim() === input.title &&
    pkg.priceCents === input.priceCents &&
    pkg.billingInterval === input.billingInterval
  );
}

async function snapshotIds(): Promise<Set<string> | null> {
  try {
    const res = await coachPackagesApi.list();
    return new Set(res.data.map((p) => p.id));
  } catch {
    // Without a snapshot the lookup falls back to name, price and time.
    return null;
  }
}

// Ten minutes either side of the device clock covers ordinary clock skew.
const LOOKUP_SKEW_MS = 10 * 60_000;

/**
 * After a create with no definitive answer, find the package the server
 * may have committed. Throws when the lookup itself fails, so the coach
 * retries again rather than risking a duplicate. Exported for tests.
 */
export async function findCommitted(
  attempt: PendingCreate,
  known: Set<string> | null,
): Promise<CoachPackage | null> {
  const res = await coachPackagesApi.list();
  const match = res.data.find((p) => {
    if (known && known.has(p.id)) return false;
    if (!sameInput(p, attempt.input)) return false;
    if (known) return true;
    const at = Date.parse(p.createdAt);
    return Number.isFinite(at) && at >= attempt.startedAt - LOOKUP_SKEW_MS;
  });
  return match ?? null;
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
  // B-329-1: a retry must never create a second package.
  //  - `created` holds the package once the server has answered create;
  //    a retry after a publish / invite / bind failure resumes from there
  //    and never calls create again.
  //  - `pending` holds an attempt whose create got no definitive answer
  //    (offline, timeout, 5xx): the server may have committed it, so the
  //    retry looks the package up first (ids we had not seen before, same
  //    name, price and billing) and adopts it instead of creating again.
  //  - The idempotency key rotates only after a definitive 4xx from create
  //    (nothing was created, the coach fixes the input and sends again).
  const idemKey = useRef(generateIdempotencyKey());
  const created = useRef<CoachPackage | null>(null);
  const pending = useRef<PendingCreate | null>(null);
  const knownIds = useRef<Set<string> | null>(null);

  const submit = async () => {
    const problem = validatePackage({ title, free, priceText });
    setInvalid(problem);
    setError(null);
    if (problem) return;
    setBusy(true);
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
      let pkg = created.current;
      if (!pkg && pending.current) {
        pkg = await findCommitted(pending.current, knownIds.current);
        if (pkg) created.current = pkg;
      }
      if (!pkg) {
        if (!knownIds.current) knownIds.current = await snapshotIds();
        const attempt: PendingCreate = {
          input,
          startedAt: Date.now(),
        };
        pending.current = attempt;
        try {
          const res = await coachPackagesApi.create(input, idemKey.current);
          pkg = res.data;
          created.current = pkg;
          pending.current = null;
        } catch (err) {
          if (isDefinitiveRejection(err)) {
            // The server refused it: nothing exists. Next send is new.
            pending.current = null;
            idemKey.current = generateIdempotencyKey();
          }
          throw err;
        }
      } else if (!sameInput(pkg, input)) {
        // The coach changed the details after a partial failure: update
        // the package we already have rather than making another one.
        const res = await coachPackagesApi.update(pkg.id, input);
        pkg = res.data;
        created.current = pkg;
      }
      await coachSetupApi.publishPackage(pkg.id);
      let freeOnJoin = false;
      if (priceCents === 0) {
        const invite = await coachSetupApi.inviteLink();
        await coachSetupApi.bindFreePackage(invite.code, pkg.id);
        freeOnJoin = true;
      }
      onCreated({
        id: pkg.id,
        title: pkg.title || input.title,
        priceCents,
        billingInterval,
        freeOnJoin,
      });
    } catch (err) {
      setError(describeError(err, "create your package"));
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
