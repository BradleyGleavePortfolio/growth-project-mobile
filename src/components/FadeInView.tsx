import React, { useEffect, useRef, useState } from 'react';
import { Animated, ViewStyle, AccessibilityInfo } from 'react-native';

interface Props {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  style?: ViewStyle;
}

export default function FadeInView({ children, delay = 0, duration = 400, style }: Props) {
  const [reduceMotion, setReduceMotion] = useState(false);
  // Initial opacity / translateY skip the entrance animation when the
  // user has Reduce Motion enabled — content is rendered at its final
  // state from the first frame.
  const opacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const translateY = useRef(new Animated.Value(reduceMotion ? 0 : 16)).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (cancelled) return;
      setReduceMotion(v);
      if (v) {
        opacity.setValue(1);
        translateY.setValue(0);
        return;
      }
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration,
          delay,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration,
          delay,
          useNativeDriver: true,
        }),
      ]).start();
    });
    return () => {
      cancelled = true;
    };
    // Intentionally empty deps — this runs once per mount, like the
    // original behaviour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View style={[{ opacity, transform: [{ translateY }] }, style]}>
      {children}
    </Animated.View>
  );
}
