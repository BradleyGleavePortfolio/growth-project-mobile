import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, ThemeColors } from '../../../theme/ThemeProvider';
import type { TimelineEvent } from './types';

export function TimelineTab({ events, onLoad, days }: { events: TimelineEvent[]; onLoad: () => void; days: number }) {
  const { colors } = useTheme();
  const tlStyles = useMemo(() => makeTlStyles(colors), [colors]);
  React.useEffect(() => {
    onLoad();
  }, [days]);

  const formatDate = (dateStr: string): string => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return `${diff} days ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (events.length === 0) {
    return (
      <View style={tlStyles.empty}>
        <Ionicons name="time-outline" size={40} color={colors.textMuted} />
        <Text style={tlStyles.emptyText}>No activity in the last {days} days</Text>
      </View>
    );
  }

  return (
    <View style={tlStyles.container}>
      <Text style={tlStyles.header}>Activity — Last {days} Days</Text>
      {events.map((event, idx) => (
        <View key={event.id} style={tlStyles.eventRow}>
          {/* Left column: icon + line */}
          <View style={tlStyles.leftCol}>
            <View style={[tlStyles.iconCircle, { backgroundColor: event.iconColor + '20' }]}>
              <Ionicons name={event.icon} size={16} color={event.iconColor} />
            </View>
            {idx < events.length - 1 && <View style={tlStyles.line} />}
          </View>
          {/* Right column: content */}
          <View style={tlStyles.content}>
            <Text style={tlStyles.title}>{event.title}</Text>
            <Text style={tlStyles.subtitle}>{event.subtitle}</Text>
            <Text style={tlStyles.date}>{formatDate(event.date)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export const makeTlStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
  },
  header: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: 0.4,
    fontWeight: '500',
    color: colors.textPrimary,
    marginBottom: 16,
  },
  empty: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
  },
  eventRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 0,
  },
  leftCol: {
    alignItems: 'center',
    width: 32,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 4, // radius.lg
    justifyContent: 'center',
    alignItems: 'center',
  },
  line: {
    width: 2,
    flex: 1,
    minHeight: 16,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  content: {
    flex: 1,
    paddingBottom: 16,
  },
  title: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  date: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 3,
    fontWeight: '500',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },

  });
