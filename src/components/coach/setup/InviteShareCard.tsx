/**
 * S-COACH — the coach's permanent invite link (GET /coaches/me/invite-link)
 * with Share, Copy and a scannable QR code. A client who joins with the link
 * is added to this coach's roster.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useTheme, ThemeColors } from "../../../theme/ThemeProvider";
import { coachSetupApi, type InviteLink } from "../../../api/coachSetupApi";
import {
  describeError,
  type FriendlyError,
} from "../../../lib/coachSetup/errors";
import SetupNotice from "./SetupNotice";
import QrCode from "./QrCode";
import { useCurrentUser } from "../../../hooks/useCurrentUser";
import { prefsStorage } from "../../../storage/mmkv";

const INVITE_SHARED_KEY_BASE = "coach.setup.invite_shared";

interface Props {
  /** Called once the coach has shared or copied the link. */
  onShared?: (how: "share" | "copy") => void;
  packageName?: string | null;
  testID?: string;
}

export default function InviteShareCard({
  onShared,
  packageName,
  testID = "invite-share",
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [link, setLink] = useState<InviteLink | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const user = useCurrentUser();
  const coachId = user?.id ?? null;

  const markShared = useCallback(
    (how: "share" | "copy") => {
      // Ticks "Invite your first client" on the Home checklist (this device).
      if (coachId)
        void prefsStorage
          .set(`${INVITE_SHARED_KEY_BASE}:${coachId}`, "true")
          .catch(() => undefined);
      onShared?.(how);
    },
    [coachId, onShared],
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      setLink(await coachSetupApi.inviteLink());
    } catch (err) {
      setError(describeError(err, "load your invite link"));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const share = useCallback(async () => {
    if (!link) return;
    try {
      const result = await Share.share({
        message: packageName
          ? `Join my coaching on The Growth Project. ${packageName} is waiting for you: ${link.url}`
          : `Join my coaching on The Growth Project: ${link.url}`,
      });
      if (result.action === Share.sharedAction) markShared("share");
    } catch (err) {
      setError(describeError(err, "open the share sheet"));
    }
  }, [link, markShared, packageName]);

  const copy = useCallback(async () => {
    if (!link) return;
    try {
      await Clipboard.setStringAsync(link.url);
      setCopied(true);
      markShared("copy");
    } catch (err) {
      setError(describeError(err, "copy the link"));
    }
  }, [link, markShared]);

  if (error && !link)
    return (
      <SetupNotice error={error} onRetry={load} testID={`${testID}-error`} />
    );
  if (!link) {
    return (
      <View style={styles.card}>
        <ActivityIndicator
          color={colors.primary}
          accessibilityLabel="Loading your invite link"
        />
      </View>
    );
  }
  return (
    <View style={styles.card} testID={testID}>
      <Text style={styles.label}>Your invite link</Text>
      <Text style={styles.link} selectable testID={`${testID}-url`}>
        {link.url}
      </Text>
      <Text style={styles.code}>Invite code {link.code}</Text>
      <View style={styles.row}>
        <TouchableOpacity
          style={styles.primary}
          onPress={share}
          accessibilityRole="button"
          accessibilityLabel="Share invite link"
          testID={`${testID}-share`}
        >
          <Text style={styles.primaryText}>Share link</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondary}
          onPress={copy}
          accessibilityRole="button"
          accessibilityLabel={
            copied ? "Invite link copied" : "Copy invite link"
          }
          testID={`${testID}-copy`}
        >
          <Text style={styles.secondaryText}>
            {copied ? "Copied" : "Copy link"}
          </Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        style={styles.toggle}
        onPress={() => setShowQr((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: showQr }}
        accessibilityLabel={showQr ? "Hide QR code" : "Show QR code"}
        testID={`${testID}-qr-toggle`}
      >
        <Text style={styles.secondaryText}>
          {showQr ? "Hide QR code" : "Show QR code"}
        </Text>
      </TouchableOpacity>
      {showQr ? (
        <View style={styles.qr}>
          <QrCode
            value={link.url}
            size={208}
            accessibilityLabel="QR code for your invite link. A client can scan it with their phone camera."
            testID={`${testID}-qr`}
          />
          <Text style={styles.hint}>
            A client can scan this with their phone camera.
          </Text>
        </View>
      ) : null}
      {error ? <SetupNotice error={error} testID={`${testID}-error`} /> : null}
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
    label: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 13,
      color: colors.textSecondary,
      marginBottom: 4,
    },
    link: {
      fontFamily: "Inter_500Medium",
      fontSize: 15,
      color: colors.textPrimary,
    },
    code: {
      fontFamily: "Inter_400Regular",
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 4,
    },
    row: { flexDirection: "row", gap: 12, marginTop: 14, flexWrap: "wrap" },
    primary: {
      backgroundColor: colors.primary,
      minHeight: 48,
      paddingHorizontal: 18,
      justifyContent: "center",
    },
    primaryText: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 15,
      color: colors.textOnPrimary,
    },
    secondary: {
      borderWidth: 1,
      borderColor: colors.primary,
      minHeight: 48,
      paddingHorizontal: 18,
      justifyContent: "center",
    },
    secondaryText: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 15,
      color: colors.primary,
    },
    toggle: {
      minHeight: 44,
      justifyContent: "center",
      marginTop: 8,
      alignSelf: "flex-start",
    },
    qr: {
      alignItems: "center",
      marginTop: 8,
      padding: 12,
      backgroundColor: "#FFFFFF",
    },
    hint: {
      fontFamily: "Inter_400Regular",
      fontSize: 13,
      color: "#1A1A18",
      marginTop: 8,
    },
  });
