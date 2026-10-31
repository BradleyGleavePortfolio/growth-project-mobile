/**
 * Settings > Notification categories keeps its switches (the plan renewal offers yes among them, STORE-B2) in raw
 * AsyncStorage under this key, outside the MMKV namespaces. It belongs to the signed-in person, so signOut()
 * (services/authActions) removes it with the other session keys (LS-908R2 B-R2-1, KT-13): a consent value never
 * outlives the account that set it.
 */
export const NOTIF_CATEGORY_PREFS_KEY = 'gp_notif_category_prefs';
