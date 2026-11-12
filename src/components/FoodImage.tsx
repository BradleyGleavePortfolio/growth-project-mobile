import React, { useState } from 'react';
import { Image, View, Text, StyleSheet } from 'react-native';
import { getFoodImageUrl } from '../utils/foodImages';
import { Colors } from '../constants/colors';
import { colors } from '../theme';
import { radius } from '../theme/tokens';

interface Props {
  name: string;
  brand?: string;
  size?: number;
}

// OFF-PHOTO-M: no brand logo overlay; its logo host no longer serves logos (LO-FOOD C12), so the tile is
// the photo or the letter alone, as it always ended up. `brand` stays in the props for its callers.
export default function FoodImage({ name, size = 48 }: Props) {
  const [failed, setFailed] = useState(false);

  // STYLEC-916: the C2 image tile corner is 12 at every size.
  // FOOD-1-M R1: a photo only when it is of this food; otherwise (or if it fails) the plain letter placeholder.
  const photoUrl = getFoodImageUrl(name);
  return photoUrl && !failed ? (
    <Image
      source={{ uri: photoUrl }}
      style={{ width: size, height: size, borderRadius: radius.input, backgroundColor: colors.feedback.successBg }}
      onError={() => setFailed(true)}
    />
  ) : (
    <View style={[styles.fallback, { width: size, height: size, borderRadius: radius.input }]}>
      <Text style={[styles.letter, { fontSize: size * 0.4 }]}>{name.charAt(0).toUpperCase()}</Text>
    </View>
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
});
