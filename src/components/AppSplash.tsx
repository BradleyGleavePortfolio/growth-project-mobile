import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, Animated } from 'react-native';
import { Colors } from '../constants/colors';
import { typography } from '../theme/tokens';

// Wave 5b: AppSplash is the only splash component in the app. The earlier
// SplashScreen.tsx duplicate was deleted. The pulsing accent dot has been
// retired; we hold a single static mark while the brand name fades in.

interface Props {
  onFinish: () => void;
}

export default function AppSplash({ onFinish }: Props) {
  const textOpacity = useRef(new Animated.Value(0)).current;
  const containerOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(textOpacity, {
      toValue: 1,
      duration: 600,
      delay: 200,
      useNativeDriver: true,
    }).start();

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
      <View style={styles.mark} />
      <Animated.Text style={[styles.title, { opacity: textOpacity }]}>
        The Growth Project
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
  mark: {
    width: 8,
    height: 8,
    borderRadius: 0,
    backgroundColor: Colors.primary,
    marginBottom: 24,
  },
  title: {
    fontFamily:    typography.h2.fontFamily,
    fontSize:      typography.h2.fontSize,
    lineHeight:    typography.h2.lineHeight,
    fontWeight:    typography.h2.fontWeight,
    letterSpacing: typography.h2.letterSpacing,
    color:         Colors.textPrimary,
  },
});
