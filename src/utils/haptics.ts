// Legacy helpers, routed through HapticService so the Settings "Haptics"
// switch is honoured (DESIGN-QA-128 U1, DS-THEME-133).
import { HapticService } from '../ui/haptics/haptics.service';

export function lightTap() {
  void HapticService.softImpact();
}

export function mediumTap() {
  void HapticService.mediumImpact();
}

export function warningTap() {
  void HapticService.warning();
}

export function successTap() {
  void HapticService.success();
}
