/**
 * SubCoachInviteModal
 *
 * Single-coach invite flow surfaced from TeamManagementScreen. The
 * head coach enters an email (+ optional display name and seat ceiling)
 * and the backend creates a sub-coach invite record + emails an accept
 * link. We surface the invite URL after creation so the head coach can
 * fall back to a copy/share if email is delayed.
 *
 * Backend contract: `subCoachApi.invite` → POST /sub-coaches/invites.
 * 404 / 501 from that endpoint is treated as "feature not enabled yet"
 * so the modal renders an honest error rather than a silent success.
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { subCoachApi, type SubCoachInviteResult } from '../../api/subCoachApi';
import { errorMessage } from '../../types/common';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  onInvited: () => void;
  /**
   * P0-2 — emails already present on the head coach's roster (active or
   * pending). Used for client-side dedupe before we POST, so a head coach
   * can't double-invite the same person and trigger duplicate Stripe seat
   * billing if the backend dedupe lags. Compared case-insensitively.
   */
  existingEmails?: ReadonlyArray<string>;
  /**
   * P0-3 — remaining seat headroom on the head coach's plan
   * (`client_capacity - clients_assigned`). When provided, the `maxClients`
   * field is bounded by this value so a head coach with 5 seats can't
   * provision a sub-coach with 99999 and break the seat-based pricing
   * model. `undefined` means "unknown" (team profile not yet loaded) — we
   * skip the clamp in that case rather than block the invite, because
   * blocking on an unknown denominator would lock head coaches out on a
   * flaky team-profile fetch.
   */
  remainingSeats?: number;
}

export default function SubCoachInviteModal({
  visible,
  onDismiss,
  onInvited,
  existingEmails,
  remainingSeats,
}: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [maxClients, setMaxClients] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SubCoachInviteResult | null>(null);

  const reset = () => {
    setEmail('');
    setName('');
    setMaxClients('');
    setSubmitting(false);
    setError('');
    setResult(null);
  };

  const handleClose = () => {
    if (result) onInvited();
    reset();
    onDismiss();
  };

  const handleInvite = async () => {
    // P0-2 — re-entrancy guard. The disabled button covers the spinner
    // state, but double-taps that arrive in the same render tick before
    // React commits `submitting=true` still reach the press handler. Bail
    // immediately if a submit is already in flight.
    if (submitting) return;

    setError('');
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail)) {
      setError('Enter a valid email address.');
      return;
    }

    // P0-2 — dedupe against the roster. If the email is already invited or
    // active, refuse client-side rather than letting the backend create a
    // duplicate pending row + double-charge a Stripe seat once accepted.
    if (existingEmails && existingEmails.length > 0) {
      const lowerEmail = trimmedEmail.toLowerCase();
      const isDuplicate = existingEmails.some(
        (e) => e.trim().toLowerCase() === lowerEmail,
      );
      if (isDuplicate) {
        setError(
          'A sub-coach with this email already exists on your team. ' +
            'Revoke them first or invite a different address.',
        );
        return;
      }
    }

    let maxClientsNum: number | undefined;
    if (maxClients.trim()) {
      const n = parseInt(maxClients.trim(), 10);
      if (isNaN(n) || n < 1) {
        setError('Seat ceiling must be a positive number.');
        return;
      }
      // P0-3 — clamp to remaining plan seats. Without this a head coach with
      // 5 seats can type 99999 and provision a sub-coach beyond the billed
      // ceiling. Surface a structured Rule-9 message naming the exact
      // headroom so the head coach knows what to do.
      if (typeof remainingSeats === 'number' && n > remainingSeats) {
        if (remainingSeats <= 0) {
          setError(
            'No seats available on your plan. Upgrade or revoke an existing sub-coach to free a seat.',
          );
        } else {
          setError(
            `Only ${remainingSeats} seat${remainingSeats === 1 ? '' : 's'} available on your plan. ` +
              `Lower the ceiling or upgrade to add more.`,
          );
        }
        return;
      }
      maxClientsNum = n;
    }

    setSubmitting(true);
    try {
      const res = await subCoachApi.invite({
        email: trimmedEmail,
        name: name.trim() || undefined,
        maxClients: maxClientsNum,
      });
      setResult(res.data);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404 || status === 501) {
        setError('Sub-coach invites are not enabled on this account yet.');
      } else if (status === 409) {
        // P0-2 — backend dedupe path. Surface a clear structured message
        // rather than raw axios text so the head coach knows the invite
        // already exists.
        setError(
          'This email already has a pending or active sub-coach invite. ' +
            'Refresh the team list to see the existing entry.',
        );
      } else {
        setError(errorMessage(err, 'Could not send invite. Try again.'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleShare = async () => {
    if (!result) return;
    try {
      await Share.share({
        url: result.inviteUrl,
        message: `You've been invited to join as a sub-coach on The Growth Project: ${result.inviteUrl}`,
      });
    } catch {
      // dismissed
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={styles.content}>
          <Text style={styles.title}>
            {result ? 'Invite sent' : 'Invite sub-coach'}
          </Text>

          {result ? (
            <>
              <Text style={styles.body}>
                We emailed an invite link to{' '}
                <Text style={{ fontWeight: '600' }}>{result.email}</Text>. If they
                don't see it, share the link directly:
              </Text>
              <Text selectable style={styles.urlText}>
                {result.inviteUrl}
              </Text>
              <View style={styles.actions}>
                <TouchableOpacity
                  onPress={handleShare}
                  accessibilityRole="button"
                  accessibilityLabel="Share invite link"
                  style={styles.primaryBtn}
                >
                  <Ionicons name="share-outline" size={16} color={colors.textOnPrimary} />
                  <Text style={styles.primaryBtnText}>Share link</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <Text style={styles.cancelText}>Done</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.label}>Email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="coach@example.com"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                style={styles.input}
                accessibilityLabel="Sub-coach email"
              />

              <Text style={styles.label}>Display name (optional)</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="e.g. Alex Rivera"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                accessibilityLabel="Sub-coach name"
              />

              <Text style={styles.label}>Seat ceiling (optional)</Text>
              <TextInput
                value={maxClients}
                onChangeText={setMaxClients}
                placeholder="e.g. 25"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                style={styles.input}
                accessibilityLabel="Max clients"
              />

              {error ? (
                <Text style={styles.errorText} accessibilityLiveRegion="assertive">
                  {error}
                </Text>
              ) : null}

              <View style={styles.actions}>
                <TouchableOpacity
                  onPress={handleClose}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                >
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleInvite}
                  disabled={submitting}
                  accessibilityRole="button"
                  accessibilityState={{ busy: submitting, disabled: submitting }}
                  accessibilityLabel="Send invite"
                  testID="sub-coach-invite-submit"
                  style={[styles.primaryBtn, submitting && styles.primaryBtnDisabled]}
                >
                  {submitting ? (
                    <ActivityIndicator color={colors.textOnPrimary} />
                  ) : (
                    <Text style={styles.primaryBtnText}>Send invite</Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
    content: { backgroundColor: colors.surface, borderRadius: 16, padding: 20 },
    title: { fontSize: 18, fontWeight: '600', color: colors.textPrimary, marginBottom: 12 },
    body: { fontSize: 14, color: colors.textSecondary, lineHeight: 20, marginBottom: 12 },
    urlText: {
      fontSize: 13,
      color: colors.textPrimary,
      backgroundColor: colors.background,
      padding: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 8,
    },
    label: { fontSize: 12, color: colors.textMuted, marginBottom: 4, marginTop: 10, textTransform: 'uppercase', letterSpacing: 0.4 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.textPrimary,
      backgroundColor: colors.background,
    },
    errorText: { color: colors.error, fontSize: 13, marginTop: 10 },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 16 },
    cancelText: { color: colors.textSecondary, fontWeight: '500', paddingVertical: 10, paddingHorizontal: 12 },
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    primaryBtnDisabled: { opacity: 0.5 },
    primaryBtnText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 14 },
  });
