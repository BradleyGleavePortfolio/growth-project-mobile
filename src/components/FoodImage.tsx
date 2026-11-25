import React, { useState } from 'react';
import { Image, View, Text, StyleSheet } from 'react-native';
import Svg, { Ellipse, Path } from 'react-native-svg';
import { getFoodImageUrl } from '../utils/foodImages';
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
}

/** C_add.html :155 (the Banana row): the bowl, camel at stroke 1.5. It names no food group (none is read);
 *  FOOD-IMAGES-M draws one per group. */
function Bowl({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke={palette.camel} strokeWidth={1.5}
      strokeLinecap="round" strokeLinejoin="round">
      <Ellipse cx="32" cy="30" rx="24" ry="7" />
      <Path d="M8 30c1 13 10 20 24 20s23-7 24-20" />
      <Path d="M20 27c2-5 6-7 10-6M34 22c4-3 9-2 11 2M27 24c1-2 3-3 5-3" />
    </Svg>
  );
}

// OFF-PHOTO-M: no brand logo overlay; its logo host no longer serves logos (LO-FOOD C12), so the tile is
// the photo or the letter alone, as it always ended up. `brand` stays in the props for its callers.
export default function FoodImage({ name, size = 48, drawn }: Props) {
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
      <Bowl size={size * 0.625} />
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
