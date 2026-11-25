// PEEK-K1-M2 harness: flags (coach_payment_actions on, except the payments-off state) and no saved macro target
// (the Food target comes from the summary's profile, as resolveCoachTargets reads it). Only stubs.
import { PAYMENTS } from './state';
export const useFeatureFlags = () => ({ flags: { coach_payment_actions: PAYMENTS }, isLoading: false });
export const useCurrentMacrosForClient = () => ({ isSuccess: false, data: undefined });
export default {};
