export type EntitlementAction = 'OPEN_PLANS' | string;

export interface EntitlementRequiredPayload {
  status: 402;
  code: 'CLIENT_ENTITLEMENT_REQUIRED' | string;
  message: string;
  action?: EntitlementAction;
  requestUrl?: string;
}

const listeners = new Set<(p: EntitlementRequiredPayload) => void>();

export const entitlementEvents = {
  onRequired(fn: (p: EntitlementRequiredPayload) => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
  emitRequired(payload: EntitlementRequiredPayload) {
    listeners.forEach((fn) => fn(payload));
  },
};
