// Simple event emitter for auth state changes
// Allows screens inside AuthNavigator to trigger a root-level navigation refresh
// Supports named events (logout, login) and a generic auth change event

type AuthListener = () => void;

let listeners: AuthListener[] = [];
const namedListeners: Record<string, AuthListener[]> = {};

export const authEvents = {
  onAuthChange: (fn: AuthListener) => {
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((l) => l !== fn);
    };
  },
  on: (event: string, fn: AuthListener) => {
    if (!namedListeners[event]) namedListeners[event] = [];
    namedListeners[event].push(fn);
  },
  off: (event: string, fn: AuthListener) => {
    if (!namedListeners[event]) return;
    namedListeners[event] = namedListeners[event].filter((l) => l !== fn);
  },
  emit: (event?: string) => {
    // Always fire generic listeners
    listeners.forEach((fn) => fn());
    // Fire named listeners if event specified
    if (event && namedListeners[event]) {
      namedListeners[event].forEach((fn) => fn());
    }
  },
};
