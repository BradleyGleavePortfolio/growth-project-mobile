import * as Haptics from 'expo-haptics';

export function lightTap() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

export function mediumTap() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

export function warningTap() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
}

export function successTap() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}
