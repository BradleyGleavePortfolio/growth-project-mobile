/**
 * S-COACH — renders a FriendlyError (src/lib/coachSetup/errors.ts) with a
 * specific title, next step, and the server reference when there is one.
 */
import React, { useMemo } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTheme, ThemeColors } from "../../../theme/ThemeProvider";
import type { FriendlyError } from "../../../lib/coachSetup/errors";

interface Props {
  error: FriendlyError;
  onRetry?: () => void;
  testID?: string;
}

export default function SetupNotice({ error, onRetry, testID }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View
      style={styles.box}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID={testID}
    >
      <Text style={styles.title}>{error.title}</Text>
      <Text style={styles.body}>{error.body}</Text>
      {error.requestId ? (
        <Text style={styles.ref} selectable>
          Reference {error.requestId}
        </Text>
      ) : null}
      {onRetry && error.retryable ? (
        <TouchableOpacity
          onPress={onRetry}
          style={styles.retry}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          testID={testID ? `${testID}-retry` : undefined}
        >
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    box: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingVertical: 14,
      marginVertical: 8,
    },
    title: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 15,
      color: colors.textPrimary,
      marginBottom: 4,
    },
    body: {
      fontFamily: "Inter_400Regular",
      fontSize: 14,
      lineHeight: 20,
      color: colors.textPrimary,
    },
    ref: {
      fontFamily: "Inter_400Regular",
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 6,
    },
    retry: {
      marginTop: 10,
      minHeight: 44,
      justifyContent: "center",
      alignSelf: "flex-start",
    },
    retryText: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 14,
      color: colors.primary,
    },
  });
