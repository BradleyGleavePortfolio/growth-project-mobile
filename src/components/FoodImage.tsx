import React, { useState } from 'react';
import { Image, View, Text, StyleSheet } from 'react-native';
import { getFoodImageUrl } from '../utils/foodImages';

interface Props {
  name: string;
  size?: number;
}

export default function FoodImage({ name, size = 48 }: Props) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <View style={[styles.fallback, { width: size, height: size, borderRadius: size * 0.25 }]}>
        <Text style={[styles.letter, { fontSize: size * 0.4 }]}>{name.charAt(0).toUpperCase()}</Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: getFoodImageUrl(name) }}
      style={{ width: size, height: size, borderRadius: size * 0.25, backgroundColor: '#E8F5E9' }}
      onError={() => setFailed(true)}
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: '#2D6A4F',
    justifyContent: 'center',
    alignItems: 'center',
  },
  letter: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
