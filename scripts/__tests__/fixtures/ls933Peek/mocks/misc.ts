// Harness-only stand-ins for app services the coach client view touches.
const noop = async () => undefined;
export const HapticService = { softImpact: noop, error: noop, selection: noop, mediumImpact: noop, success: noop, warning: noop, heavyImpact: noop, lightImpact: noop };
export const logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
export const commandCenterApi = { dismissAlert: noop };
const state = { clients: [], loadError: null, fetchClients: noop };
export const useCoachStore = Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(state) : state), { getState: () => state });
export const useFoundingNumber = () => ({ data: null });
