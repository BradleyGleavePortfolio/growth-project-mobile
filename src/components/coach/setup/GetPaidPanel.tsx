/**
 * S-COACH — "Get paid" panel. Opens Stripe-hosted Express onboarding (Stripe
 * collects bank account and ID) in an in-app browser sheet, closes it when
 * Stripe sends the coach back (tgp://connect/onboarding/return|refresh via the
 * backend HTTPS landing), then re-reads the account from Stripe and shows the
 * truthful state, including anything Stripe still needs and its deadline.
 * A server whose return page does not use that scheme leaves the sheet open
 * until the coach closes it; the status is re-read the same way either way.
 *
 * B-346-2 (agent 118): every load, Stripe visit and re-check belongs to this
 * mount and session. Unmount or any auth change (sign-out, account switch)
 * retires it: an open Stripe sheet is dismissed, and no later answer opens a
 * sheet, re-reads status, sets state or calls onChange. Retry repeats the
 * action that failed.
 *
 * Used by the setup wizard and the Home checklist.
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
import * as WebBrowser from "expo-web-browser";
import { useTheme, ThemeColors } from "../../../theme/ThemeProvider";
import { coachSetupApi, type ConnectView } from "../../../api/coachSetupApi";
import { connectCopy } from "../../../lib/coachSetup/connectCopy";
import {
  describeError,
  type FriendlyError,
} from "../../../lib/coachSetup/errors";
import { assertStripeUrl } from "../../../utils/stripeUrlValidator";
import { authEvents } from "../../../utils/authEvents";
import SetupNotice from "./SetupNotice";

export const CONNECT_RETURN_PREFIX = "tgp://connect/onboarding";

interface Props {
  onChange?: (view: ConnectView) => void;
  testID?: string;
}

export default function GetPaidPanel({ onChange, testID = "get-paid" }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [view, setView] = useState<ConnectView | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [failed, setFailed] = useState<"load" | "open" | "check" | null>(null);
  // "unanswered": the server asked Stripe and got no answer. "saved": this
  // server cannot ask Stripe live, so the status is Stripe's last update.
  const [stale, setStale] = useState<"unanswered" | "saved" | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const mounted = useRef(true);
  const epoch = useRef(0);
  const sheetOpen = useRef(false);
  const retire = useCallback(() => {
    epoch.current += 1;
    if (sheetOpen.current) {
      sheetOpen.current = false;
      try {
        WebBrowser.dismissAuthSession();
      } catch {
        // No sheet to close on this platform.
      }
    }
  }, []);
  /** A check bound to this mount and session, read after every await. */
  const begin = useCallback(() => {
    const mine = epoch.current;
    return () => mounted.current && epoch.current === mine;
  }, []);
  useEffect(() => {
    mounted.current = true;
    const off = authEvents.onAuthChange(() => {
      retire();
      if (!mounted.current) return;
      // Nothing from the earlier account stays on screen.
      setView(null);
      setStale(null);
      setError(null);
      setFailed(null);
      setOpening(false);
      setChecking(false);
      setLoading(false);
    });
    return () => {
      mounted.current = false;
      off();
      retire();
    };
  }, [retire]);

  const apply = useCallback((v: ConnectView) => {
    setView(v);
    onChangeRef.current?.(v);
  }, []);

  const showFresh = useCallback(
    (fresh: ConnectView) => {
      setStale(
        fresh.refreshed
          ? null
          : fresh.refreshUnavailable
            ? "saved"
            : "unanswered",
      );
      apply(fresh);
    },
    [apply],
  );

  const load = useCallback(async () => {
    const live = begin();
    setLoading(true);
    setError(null);
    setFailed(null);
    try {
      const v = await coachSetupApi.connectStatus();
      if (!live()) return;
      apply(v);
    } catch (err) {
      if (!live()) return;
      setError(describeError(err, "load your payout setup"));
      setFailed("load");
    } finally {
      if (live()) setLoading(false);
    }
  }, [apply, begin]);

  useEffect(() => {
    void load();
  }, [load]);

  const openStripe = useCallback(async () => {
    const live = begin();
    setOpening(true);
    setError(null);
    setFailed(null);
    try {
      // Stripe links are single use and expire. When Stripe sends the coach to
      // the refresh URL, mint a new link and reopen once.
      for (let attempt = 0; attempt < 2; attempt++) {
        const link = await coachSetupApi.createOnboardingLink();
        if (!live()) return;
        assertStripeUrl(link.url, "GetPaidPanel.onboarding");
        sheetOpen.current = true;
        const result = await Promise.resolve(
          WebBrowser.openAuthSessionAsync(link.url, CONNECT_RETURN_PREFIX),
        ).finally(() => {
          sheetOpen.current = false;
        });
        if (!live()) return;
        const expired =
          result.type === "success" &&
          typeof result.url === "string" &&
          result.url.includes("/refresh");
        if (!expired) break;
      }
      const fresh = await coachSetupApi.refreshConnectStatus();
      if (!live()) return;
      showFresh(fresh);
    } catch (err) {
      if (!live()) return;
      setError(describeError(err, "open Stripe"));
      setFailed("open");
    } finally {
      if (live()) setOpening(false);
    }
  }, [begin, showFresh]);

  const checkAgain = useCallback(async () => {
    const live = begin();
    setChecking(true);
    setError(null);
    setFailed(null);
    try {
      const fresh = await coachSetupApi.refreshConnectStatus();
      if (!live()) return;
      showFresh(fresh);
    } catch (err) {
      if (!live()) return;
      setError(describeError(err, "check with Stripe"));
      setFailed("check");
    } finally {
      if (live()) setChecking(false);
    }
  }, [begin, showFresh]);

  const retry =
    failed === "open" ? openStripe : failed === "check" ? checkAgain : load;

  if (loading && !view) {
    return (
      <View style={styles.card} testID={`${testID}-loading`}>
        <ActivityIndicator
          color={colors.primary}
          accessibilityLabel="Loading your payout setup"
        />
      </View>
    );
  }

  const copy = view ? connectCopy(view) : null;
  return (
    <View style={styles.card} testID={testID}>
      {copy ? (
        <>
          <Text
            style={styles.title}
            accessibilityRole="header"
            testID={`${testID}-title`}
          >
            {copy.title}
          </Text>
          <Text style={styles.body}>{copy.body}</Text>
          {copy.due.length > 0 ? (
            <View
              style={styles.dueList}
              accessibilityLabel={`Stripe needs: ${copy.due.join(", ")}`}
            >
              {copy.due.map((label) => (
                <Text key={label} style={styles.dueItem}>
                  {`\u2022 ${label}`}
                </Text>
              ))}
            </View>
          ) : null}
          {stale ? (
            <Text style={styles.note} testID={`${testID}-stale`}>
              {stale === "saved"
                ? "This shows the last update Stripe sent to TGP. A change made just now can take a few minutes to show here."
                : "Stripe did not answer just now, so this may be a few seconds behind. Check again in a moment."}
            </Text>
          ) : null}
        </>
      ) : null}
      {error ? (
        <SetupNotice error={error} onRetry={retry} testID={`${testID}-error`} />
      ) : null}
      {copy?.action ? (
        <TouchableOpacity
          style={[styles.primary, opening && styles.disabled]}
          onPress={openStripe}
          disabled={opening}
          accessibilityRole="button"
          accessibilityLabel={copy.action}
          accessibilityHint="Opens a secure Stripe page inside the app"
          accessibilityState={{ busy: opening, disabled: opening }}
          testID={`${testID}-open`}
        >
          {opening ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <Text style={styles.primaryText}>{copy.action}</Text>
          )}
        </TouchableOpacity>
      ) : null}
      {view && view.state === "pending_verification" ? (
        <TouchableOpacity
          style={styles.secondary}
          onPress={checkAgain}
          disabled={checking}
          accessibilityRole="button"
          accessibilityLabel="Check status again"
          accessibilityState={{ busy: checking, disabled: checking }}
          testID={`${testID}-check`}
        >
          <Text style={styles.secondaryText}>Check status again</Text>
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
      marginVertical: 8,
    },
    title: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 17,
      color: colors.textPrimary,
      marginBottom: 6,
    },
    body: {
      fontFamily: "Inter_400Regular",
      fontSize: 14,
      lineHeight: 21,
      color: colors.textPrimary,
    },
    dueList: { marginTop: 10 },
    dueItem: {
      fontFamily: "Inter_400Regular",
      fontSize: 14,
      lineHeight: 22,
      color: colors.textPrimary,
    },
    note: {
      fontFamily: "Inter_400Regular",
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
      marginTop: 8,
    },
    primary: {
      backgroundColor: colors.primary,
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 14,
      paddingHorizontal: 16,
    },
    disabled: { opacity: 0.6 },
    primaryText: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 15,
      color: colors.textOnPrimary,
    },
    secondary: {
      minHeight: 44,
      justifyContent: "center",
      marginTop: 8,
      alignSelf: "flex-start",
    },
    secondaryText: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 14,
      color: colors.primary,
    },
  });
