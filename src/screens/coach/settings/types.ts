export const COACH_SETTINGS_KEY = 'gp_coach_settings';

export interface CoachSettings {
  hapticsEnabled: boolean;
  dailyCheckin: boolean;
  newClientAlerts: boolean;
  weeklySummary: boolean;
}

export const DEFAULT_SETTINGS: CoachSettings = {
  hapticsEnabled: true,
  dailyCheckin: true,
  newClientAlerts: true,
  weeklySummary: true,
};
