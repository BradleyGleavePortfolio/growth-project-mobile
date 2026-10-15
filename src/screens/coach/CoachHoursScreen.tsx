/**
 * COACHTABS — Hours and rules, under the Calendar tab's gear: today's four
 * booking settings, the same rows as Settings > Coach tools, until the K5
 * calendar slices land. The native header above carries Back.
 */
import React, { useMemo } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { CalendarStackParamList } from '../../navigation/CoachNavigator';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useTheme } from '../../theme/ThemeProvider';
import { mediumTap } from '../../utils/haptics';
import { Headline } from '../../ui';
import { makeStyles } from './settings/styles';
import { BookingOptionsEntry } from './settings/BookingOptionsEntry';

export default function CoachHoursScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NativeStackNavigationProp<CalendarStackParamList>>();
  const coachId = useCurrentUser()?.id;

  const row = (icon: keyof typeof Ionicons.glyphMap, label: string, a11y: string, onPress: () => void) => (
    <TouchableOpacity style={styles.row} onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y}>
      <Ionicons name={icon} size={20} color={colors.textSecondary} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} testID="coach-hours">
      <View style={styles.header}>
        <Headline level="h1">Hours and rules</Headline>
      </View>
      <View style={styles.section}>
        {row('time-outline', 'Availability', 'Open availability editor', () => {
          mediumTap();
          if (!coachId) {
            Alert.alert('Not signed in', 'Could not resolve your coach profile.');
            return;
          }
          navigation.navigate('CoachAvailabilityEditor', { coachId });
        })}
        <View style={styles.divider} />
        <BookingOptionsEntry
          styles={styles}
          colors={colors}
          onOpen={() => {
            mediumTap();
            navigation.navigate('CoachBookingOptions');
          }}
        />
        {row('list-outline', 'Appointment types', 'Open appointment types', () => {
          mediumTap();
          navigation.navigate('CoachAppointmentTypes', coachId ? { coachId } : undefined);
        })}
        <View style={styles.divider} />
        {row('airplane-outline', 'Time off', 'Open time off', () => {
          mediumTap();
          navigation.navigate('CoachTimeOff');
        })}
      </View>
    </ScrollView>
  );
}
