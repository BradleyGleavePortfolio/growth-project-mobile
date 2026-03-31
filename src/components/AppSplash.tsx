import React, { useEffect, useRef } from 'react';
import { StyleSheet, Animated } from 'react-native';
import { Colors } from '../constants/colors';

interface Props {
  onFinish: () => void;
}

export default function AppSplash({ onFinish }: Props) {
  const dotScale = useRef(new Animated.Value(0.6)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const containerOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Pulsing green dot
    Animated.loop(
      Animated.sequence([
        Animated.timing(dotScale, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(dotScale, {
          toValue: 0.6,
          duration: 500,
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Fade in title
    Animated.timing(textOpacity, {
      toValue: 1,
      duration: 600,
      delay: 200,
      useNativeDriver: true,
    }).start();

    // Fade out and finish
    const timeout = setTimeout(() => {
      Animated.timing(containerOpacity, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }).start(() => onFinish());
    }, 1800);

    return () => clearTimeout(timeout);
  }, []);

  return (
    <Animated.View style={[styles.container, { opacity: containerOpacity }]}>
      <Animated.View
        style={[
          styles.dot,
          { transform: [{ scale: dotScale }] },
        ]}
      />
      <Animated.Text style={[styles.title, { opacity: textOpacity }]}>
        The Growth Project
      </Animated.Text>
      <Animated.Text style={[styles.subtitle, { opacity: textOpacity }]}>
        Nutrition. Simplified.
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
});
