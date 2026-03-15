// Simple event emitter for auth state changes
// Allows screens inside AuthNavigator to trigger a root-level navigation refresh

type AuthListener = () => void;

let listeners: AuthListener[] = [];

export const authEvents = {
  onAuthChange: (fn: AuthListener) => {
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((l) => l !== fn);
    };
  },
  emit: () => {
    listeners.forEach((fn) => fn());
  },
};
