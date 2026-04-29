import React, { useCallback, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';

import FadeInView from '../../components/FadeInView';
import { fastingApi } from '../../services/api';
import { typography, spacing, radius } from '../../theme/tokens';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { errorMessage } from '../../types/common';

// Wave 5b: WidgetsScreen reduced to the actions that actually work today.
// Per the no-placeholder doctrine, "Coming Soon" widgets, wearables and
// barcode-scanner stubs are removed from the shipped surface. They will
// return when there's a real implementation behind them.

type QuickActionId = 'quick-log' | 'start-fast';

interface QuickAction {
  id: QuickActionId;
  title: string;
  description: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'quick-log',
    title: 'Quick log',
    description: 'Open the food log from anywhere',
    icon: 'add-circle-outline',
  },
  {
    id: 'start-fast',
    title: 'Start fast',
    description: 'Begin a 16:8 fasting session',
    icon: 'play-circle-outline',
  },
];

const DEFAULT_FAST_PROTOCOL = '16:8';

export default function WidgetsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const [startingFast, setStartingFast] = useState(false);

  const handleStartFast = useCallback(async () => {
    if (startingFast) return;
    Alert.alert(
      'Start 16:8 fast',
      'Begin a 16-hour fast now? Your fasting timer will start immediately.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start',
          onPress: async () => {
            setStartingFast(true);
            try {
              await fastingApi.start({ protocol: DEFAULT_FAST_PROTOCOL });
              navigation.navigate('Fast');
            } catch (err) {
              const msg =
                errorMessage(err, 'Could not start fast. A fast may already be in progress.');
              Alert.alert('Could not start fast', msg);
            } finally {
              setStartingFast(false);
            }
          },
        },
      ],
    );
  }, [startingFast, navigation]);

  const handlePress = useCallback(
    (id: QuickActionId) => {
      if (id === 'start-fast') {
        handleStartFast();
        return;
      }
      if (id === 'quick-log') {
        navigation.navigate('Log');
      }
    },
    [navigation, handleStartFast],
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Shortcuts</Text>
      </View>

      <FadeInView>
        <View style={styles.section}>
          <Text style={styles.eyebrow}>Quick actions</Text>
          {QUICK_ACTIONS.map((action) => {
            const isStartFast = action.id === 'start-fast';
            const isLoading = isStartFast && startingFast;

            return (
              <TouchableOpacity
                key={action.id}
                style={styles.card}
                activeOpacity={0.7}
                onPress={() => handlePress(action.id)}
                disabled={isLoading}
              >
                <View style={styles.cardIcon}>
                  <Ionicons name={action.icon} size={22} color={colors.primary} />
                </View>
                <View style={styles.cardContent}>
                  <Text style={styles.cardTitle}>{action.title}</Text>
                  <Text style={styles.cardDesc}>{action.description}</Text>
                </View>
                {isLoading ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </FadeInView>
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: spacing['2xl'],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: 60,
    marginBottom: spacing.xl,
    gap: spacing.md,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  title: {
    fontFamily:    typography.h1.fontFamily,
    fontSize:      typography.h1.fontSize,
    lineHeight:    typography.h1.lineHeight,
    fontWeight:    typography.h1.fontWeight,
    letterSpacing: typography.h1.letterSpacing,
    color:         colors.textPrimary,
  },
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  eyebrow: {
    fontFamily:     typography.eyebrow.fontFamily,
    fontSize:       typography.eyebrow.fontSize,
    lineHeight:     typography.eyebrow.lineHeight,
    fontWeight:     typography.eyebrow.fontWeight,
    letterSpacing:  typography.eyebrow.letterSpacing,
    textTransform:  'uppercase',
    color:          colors.textSecondary,
    marginBottom:   spacing.md,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontFamily:    typography.bodyMd.fontFamily,
    fontSize:      typography.bodyMd.fontSize,
    lineHeight:    typography.bodyMd.lineHeight,
    fontWeight:    typography.bodyMd.fontWeight,
    letterSpacing: typography.bodyMd.letterSpacing,
    color:         colors.textPrimary,
    marginBottom:  2,
  },
  cardDesc: {
    fontFamily:    typography.bodySmall.fontFamily,
    fontSize:      typography.bodySmall.fontSize,
    lineHeight:    typography.bodySmall.lineHeight,
    color:         colors.textSecondary,
  },

  });
