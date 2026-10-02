/**
 * S-COACH — the wizard's "Get paid" and "Invite your first client" steps,
 * reachable any time from the Home checklist and from Settings, so a coach
 * who skipped them in setup is never stuck.
 */
import React, { useMemo } from "react";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useTheme, ThemeColors } from "../../../theme/ThemeProvider";
import GetPaidPanel from "../../../components/coach/setup/GetPaidPanel";
import InviteShareCard from "../../../components/coach/setup/InviteShareCard";
import type { SettingsStackParamList } from "../../../navigation/CoachNavigator";

type Props = NativeStackScreenProps<SettingsStackParamList, "CoachSetup">;

export default function CoachSetupScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const section = route.params?.section ?? "get_paid";
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.inner}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          testID="coach-setup-back"
        >
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        {section === "get_paid" ? (
          <>
            <Text style={styles.heading} accessibilityRole="header">
              Get paid
            </Text>
            <Text style={styles.body}>
              Stripe, our payments partner, collects your bank account and ID on
              a secure page and sends your earnings to your bank. TGP never sees
              those details.
            </Text>
            <GetPaidPanel testID="setup-get-paid" />
          </>
        ) : (
          <>
            <Text style={styles.heading} accessibilityRole="header">
              Invite a client
            </Text>
            <Text style={styles.body}>
              Send your link, or let them scan the QR code. When they join, they
              appear in your client list.
            </Text>
            <InviteShareCard testID="setup-invite" />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    inner: { padding: 20 },
    back: {
      minHeight: 44,
      justifyContent: "center",
      alignSelf: "flex-start",
      marginBottom: 8,
    },
    backText: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 15,
      color: colors.primary,
    },
    heading: {
      fontFamily: "CormorantGaramond_400Regular",
      fontSize: 30,
      lineHeight: 34,
      color: colors.textPrimary,
      marginBottom: 8,
    },
    body: {
      fontFamily: "Inter_400Regular",
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
      marginBottom: 8,
    },
  });
