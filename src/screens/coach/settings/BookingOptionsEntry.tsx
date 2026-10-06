import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { bookingOptionsUnavailable, useBookingOptions } from '../../../hooks/useCalendar';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { makeStyles } from './styles';

/**
 * S-AVAIL-122 Settings row for coach booking options, next to Availability.
 * Hidden when the backend does not offer the endpoint (bare 404 before
 * backend #735 ships) or the account is not a coach (403).
 */
export function BookingOptionsEntry({
  styles,
  colors,
  onOpen,
}: {
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
  onOpen: () => void;
}) {
  const q = useBookingOptions();
  if (q.isError && bookingOptionsUnavailable(q.error)) return null;
  return (
    <>
      <TouchableOpacity
        style={styles.row}
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel="Open booking options"
        testID="settings-booking-options"
      >
        <Ionicons name="options-outline" size={20} color={colors.textSecondary} />
        <Text style={styles.rowLabel}>Booking Options</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </TouchableOpacity>
      <View style={styles.divider} />
    </>
  );
}
