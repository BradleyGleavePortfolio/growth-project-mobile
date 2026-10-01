/**
 * S-SCHED — client Calendar tab stack routes. Registered only when
 * featureFlags.clientCalendar is on (see ClientNavigator).
 */
export type CalendarStackParamList = {
  CalendarHome: undefined;
  /**
   * Pick a time and book (or move an existing session).
   *   - welcome: resolve the coach's welcome appointment type (tutorial end).
   *   - rescheduleSessionId: move that session instead of booking a new one.
   */
  CalendarBook: {
    coachId?: string;
    sessionTypeId?: string;
    rescheduleSessionId?: string;
    welcome?: boolean;
  };
  CalendarSession: { sessionId: string };
};
