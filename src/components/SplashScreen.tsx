import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { Colors } from '../constants/colors';

interface Props {
  onFinish: () => void;
}

export default function SplashScreen({ onFinish }: Props) {
  const textOpacity = useRef(new Animated.Value(0)).current;
  const dotScale = useRef(new Animated.Value(0.5)).current;
  const dotOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(textOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(dotOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
      Animated.loop(
        Animated.sequence([
          Animated.timing(dotScale, { toValue: 1.3, duration: 500, useNativeDriver: true }),
          Animated.timing(dotScale, { toValue: 0.8, duration: 500, useNativeDriver: true }),
        ]),
        { iterations: 2 }
      ),
    ]).start(() => {
      Animated.timing(textOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(onFinish);
    });
  }, []);

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.dotWrap, { opacity: dotOpacity, transform: [{ scale: dotScale }] }]}>
        <View style={styles.dot} />
      </Animated.View>
      <Animated.Text style={[styles.title, { opacity: textOpacity }]}>
        The Growth Project
      </Animated.Text>
      <Animated.Text style={[styles.subtitle, { opacity: textOpacity }]}>
        Your nutrition journey
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dotWrap: {
    marginBottom: 20,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.primary,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    marginTop: 8,
  },
});
