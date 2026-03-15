import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, ViewStyle } from 'react-native';
import { Colors } from '../constants/colors';

function useShimmer() {
  const opacity = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);
  return opacity;
}

export function SkeletonLine({ width = '100%', height = 14, style }: { width?: number | string; height?: number; style?: ViewStyle }) {
  const opacity = useShimmer();
  return (
    <Animated.View
      style={[
        styles.line,
        { width: width as any, height, borderRadius: height / 2, opacity },
        style,
      ]}
    />
  );
}

export function SkeletonCircle({ size = 40, style }: { size?: number; style?: ViewStyle }) {
  const opacity = useShimmer();
  return (
    <Animated.View
      style={[
        styles.line,
        { width: size, height: size, borderRadius: size / 2, opacity },
        style,
      ]}
    />
  );
}

export function SkeletonCard({ style }: { style?: ViewStyle }) {
  const opacity = useShimmer();
  return (
    <Animated.View style={[styles.card, { opacity }, style]}>
      <View style={styles.cardRow}>
        <View style={[styles.dot, { width: 40, height: 40, borderRadius: 20 }]} />
        <View style={styles.cardLines}>
          <View style={[styles.linePlaceholder, { width: '60%' }]} />
          <View style={[styles.linePlaceholder, { width: '40%', marginTop: 8 }]} />
        </View>
      </View>
      <View style={[styles.linePlaceholder, { width: '100%', height: 10, marginTop: 16 }]} />
      <View style={[styles.linePlaceholder, { width: '80%', height: 10, marginTop: 8 }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  line: {
    backgroundColor: Colors.surfaceElevated,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dot: {
    backgroundColor: Colors.surfaceElevated,
  },
  cardLines: {
    flex: 1,
  },
  linePlaceholder: {
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.surfaceElevated,
  },
});
