/**
 * S-COACH — "Get paid" panel. Opens Stripe-hosted Express onboarding (Stripe
 * collects bank account and ID) in an in-app browser sheet, closes it when
 * Stripe sends the coach back (tgp://connect/onboarding/return|refresh via the
 * backend HTTPS landing), then re-reads the account from Stripe and shows the
 * truthful state, including anything Stripe still needs and its deadline.
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
  const [error, setError] = useState<FriendlyError | null>(null);
  const [stale, setStale] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const apply = useCallback((v: ConnectView) => {
    setView(v);
    onChangeRef.current?.(v);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      apply(await coachSetupApi.connectStatus());
    } catch (err) {
      setError(describeError(err, "load your payout setup"));
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    void load();
  }, [load]);

  const openStripe = useCallback(async () => {
    setOpening(true);
    setError(null);
    try {
      // Stripe links are single use and expire. When Stripe sends the coach to
      // the refresh URL, mint a new link and reopen once.
      for (let attempt = 0; attempt < 2; attempt++) {
        const link = await coachSetupApi.createOnboardingLink();
        assertStripeUrl(link.url, "GetPaidPanel.onboarding");
        const result = await WebBrowser.openAuthSessionAsync(
          link.url,
          CONNECT_RETURN_PREFIX,
        );
        const expired =
          result.type === "success" &&
          typeof result.url === "string" &&
          result.url.includes("/refresh");
        if (!expired) break;
      }
      const fresh = await coachSetupApi.refreshConnectStatus();
      setStale(!fresh.refreshed);
      apply(fresh);
    } catch (err) {
      setError(describeError(err, "open Stripe"));
    } finally {
      setOpening(false);
    }
  }, [apply]);

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
              Stripe did not answer just now, so this may be a few seconds
              behind. Check again in a moment.
            </Text>
          ) : null}
        </>
      ) : null}
      {error ? (
        <SetupNotice
          error={error}
          onRetry={view ? openStripe : load}
          testID={`${testID}-error`}
        />
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
          onPress={async () => {
            try {
              const fresh = await coachSetupApi.refreshConnectStatus();
              setStale(!fresh.refreshed);
              apply(fresh);
            } catch (err) {
              setError(describeError(err, "check with Stripe"));
            }
          }}
          accessibilityRole="button"
          accessibilityLabel="Check status again"
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
