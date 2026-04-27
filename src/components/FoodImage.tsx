import React, { useState } from 'react';
import { Image, View, Text, StyleSheet } from 'react-native';
import { getFoodImageUrl, getRestaurantLogo } from '../utils/foodImages';
import { Colors } from '../constants/colors';
import { colors } from '../theme';

interface Props {
  name: string;
  brand?: string;
  size?: number;
}

export default function FoodImage({ name, brand, size = 48 }: Props) {
  const [failed, setFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);

  const logoUrl = getRestaurantLogo(name, brand);

  if (failed && (!logoUrl || logoFailed)) {
    return (
      <View style={[styles.fallback, { width: size, height: size, borderRadius: size * 0.25 }]}>
        <Text style={[styles.letter, { fontSize: size * 0.4 }]}>{name.charAt(0).toUpperCase()}</Text>
      </View>
    );
  }

  if (logoUrl && !logoFailed) {
    return (
      <View style={{ width: size, height: size }}>
        <Image
          source={{ uri: getFoodImageUrl(name) }}
          style={{ width: size, height: size, borderRadius: size * 0.25, backgroundColor: colors.feedback.successBg }}
          onError={() => setFailed(true)}
        />
        <Image
          source={{ uri: logoUrl }}
          style={[styles.logoOverlay, {
            width: size * 0.45,
            height: size * 0.45,
            borderRadius: size * 0.1,
            right: -2,
            bottom: -2,
          }]}
          onError={() => setLogoFailed(true)}
        />
      </View>
    );
  }

  return (
    <Image
      source={{ uri: getFoodImageUrl(name) }}
      style={{ width: size, height: size, borderRadius: size * 0.25, backgroundColor: colors.feedback.successBg }}
      onError={() => setFailed(true)}
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  letter: {
    color: Colors.textOnPrimary,
    fontWeight: '500',
  },
  logoOverlay: {
    position: 'absolute',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
});
