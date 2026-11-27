import React, { useState } from 'react';
import { Image, View, Text, StyleSheet } from 'react-native';
import { getFoodImageUrl } from '../utils/foodImages';
import FoodDrawing, { type FoodDrawingKind } from './FoodDrawing';
import { Colors } from '../constants/colors';
import { colors } from '../theme';
import { colors as palette, radius } from '../theme/tokens';

interface Props {
  name: string;
  brand?: string;
  size?: number;
  /**
   * REFINE-968 (operator ruling 6): the add sheet's rows only. With no photo, the C_add tile (cream, corner 12) with
   * its one drawn bowl in place of the letter. Absent, the tile is exactly as before (the coach's meal picker).
   */
  drawn?: boolean;
  /** FOOD-IMAGES-M (#192-E6): the food group's drawing on that tile; read only with drawn, absent the bowl. */
  drawing?: FoodDrawingKind;
}

// OFF-PHOTO-M: no brand logo overlay; its logo host no longer serves logos (LO-FOOD C12), so the tile is
// the photo or the letter alone, as it always ended up. `brand` stays in the props for its callers.
export default function FoodImage({ name, size = 48, drawn, drawing }: Props) {
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
  ) : drawn ? (
    // C_add.html :120 (.c-li .ph): 48 tile, corner 12, the drawing 30 of 48. Decorative: the row names the food.
    <View testID="food-tile-drawing" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[styles.drawn, { width: size, height: size, borderRadius: radius.input }]}>
      <FoodDrawing kind={drawing ?? 'bowl'} size={size * 0.625} />
    </View>
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
  drawn: { backgroundColor: palette.cream, justifyContent: 'center', alignItems: 'center' },
  letter: {
    color: Colors.textOnPrimary,
    fontWeight: '500',
  },
});
